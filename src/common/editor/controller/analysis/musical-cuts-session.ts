/* SPDX-License-Identifier: AGPL-3.0-only */
import { createStableId } from '../../stable-id.js';
import type { AudioEditorCommand } from '../../commands/protocol.ts';
import type { MusicalCutCandidate, MusicalCutReport, MusicalCutRequest } from '../../musical-cut-analysis.ts';
import { MUSICAL_CUT_RATE, MUSICAL_CUT_MAX_SECONDS } from '../../musical-cut-features.ts';
import { musicalCutCommand, musicalTrackClips, MusicalCutRefusal } from '../../musical-cut-edit.ts';
import { createMusicalCutResultWindow, type MusicalCutResultWindow } from '../../musical-cut-result-window.ts';
import { createMusicalCutRenderCache } from './internal/musical-cut-render-cache.ts';
import { createMusicalCutTransport, type MusicalCutPlaybackResources } from './musical-cut-transport.ts';
import type { AnalysisAudioBuffer, AnalysisRange } from './analysis-service.ts';
import {
	EDITOR_PROJECT_TASK_SCOPE, type EditorControllerLifetime, type EditorProjectToken, type EditorTaskScope,
} from '../shared/lifecycle.ts';

interface Project {
	readonly id: string;
	readonly revision: number;
	readonly clips: readonly unknown[];
	readonly tracks?: readonly unknown[];
}
interface Dependencies<P extends Project> {
	readonly getProject: () => P;
	readonly sampleRate: () => number;
	readonly lifetime: EditorControllerLifetime;
	readonly captureProject: () => EditorProjectToken;
	readonly assertProject: (token: EditorProjectToken) => void;
	readonly render: (project: P, range: AnalysisRange, signal: AbortSignal, trackId: string) => Promise<AnalysisAudioBuffer>;
	readonly stageCommand: (project: P, command: AudioEditorCommand) => P;
	readonly analyze: (request: MusicalCutRequest, signal: AbortSignal) => Promise<MusicalCutReport>;
	readonly busy: (value: boolean) => void;
	readonly playback?: MusicalCutPlaybackResources;
	readonly playbackProject?: (project: P, trackId: string) => Readonly<Record<string, unknown>>;
}
export interface MusicalCutsInput {
	readonly trackId: string;
	readonly range?: AnalysisRange;
	readonly removeSeconds?: number;
	readonly toleranceSeconds?: number;
	readonly deepSearch?: boolean;
	readonly respectPhrases?: boolean;
}
export interface MusicalCutsResult extends MusicalCutReport {
	readonly range: AnalysisRange;
	readonly sampleRate: number;
	readonly trackEndFrame: number;
}
export interface MusicalCutPreview {
	readonly channels: readonly Float32Array[];
	readonly sampleRate: number;
	readonly joinSeconds: number;
	readonly startSeconds?: number;
}
export type MusicalCutsSession = ReturnType<typeof createMusicalCutsSession>;

/** Dialog-scoped authority, bounded chunk renders, cancellation and exact staged-edit audition. */
export function createMusicalCutsSession<P extends Project>(dependencies: Dependencies<P>) {
	let disposed = false;
	let active: EditorTaskScope | null = null;
	let windowTask: EditorTaskScope | null = null;
	let result: MusicalCutsResult | null = null;
	let owner: { project: P; revision: number; token: EditorProjectToken; input: MusicalCutsInput } | null = null;
	let prepared: { candidate: MusicalCutCandidate; fadeMs: number; command: AudioEditorCommand; staged?: P } | null = null;
	const cache = createMusicalCutRenderCache();
	const transports = new Set<ReturnType<typeof createMusicalCutTransport>>();
	return Object.freeze({ analyze, preview, resultExtent, renderResultWindow, createTransport, apply, dispose });

	function createTransport() {
		assertAlive();
		if (!dependencies.playback || !dependencies.playbackProject) throw new Error('Musical cut playback is unavailable.');
		const projectForPlayback = dependencies.playbackProject;
		const transport = createMusicalCutTransport({ lifetime: dependencies.lifetime, resources: dependencies.playback,
			assertCurrent: candidate => { assertOwner(candidate); },
			resolve: ({ candidate, fadeMs, original }) => {
				const { project, input } = assertOwner(candidate);
				const source = original ? project : stagedResult(candidate, fadeMs);
				return { project: projectForPlayback(source, input.trackId), identity: source,
					endFrame: Math.max(...musicalTrackClips(source, input.trackId).map(clip => clip.timelineStartFrame + clip.durationFrames)) };
			},
		});
		transports.add(transport); return transport;
	}

	async function analyze(input: MusicalCutsInput, signal: AbortSignal, progress: (fraction: number) => void = () => undefined): Promise<MusicalCutsResult> {
		assertAlive();
		for (const transport of transports) transport.stop();
		windowTask?.abort();
		result = null; owner = null; prepared = null; cache.clear();
		const project = dependencies.getProject();
		const revision = project.revision;
		const token = dependencies.captureProject();
		const clips = musicalTrackClips(project, input.trackId);
		if (!clips.length) throw new MusicalCutRefusal('empty');
		const rate = dependencies.sampleRate();
		const startFrame = input.range?.startFrame ?? Math.min(...clips.map(clip => clip.timelineStartFrame));
		const endFrame = input.range?.endFrame ?? Math.max(...clips.map(clip => clip.timelineStartFrame + clip.durationFrames));
		if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame) || startFrame < 0 || endFrame <= startFrame) throw new MusicalCutRefusal('range');
		const seconds = (endFrame - startFrame) / rate;
		if (seconds > MUSICAL_CUT_MAX_SECONDS || seconds < 5) throw new MusicalCutRefusal('length');
		if (input.removeSeconds !== undefined && (!Number.isFinite(input.removeSeconds) || input.removeSeconds <= 0)) throw new MusicalCutRefusal('range');
		if (input.toleranceSeconds !== undefined && (!Number.isFinite(input.toleranceSeconds) || input.toleranceSeconds < 0 || input.toleranceSeconds > MUSICAL_CUT_MAX_SECONDS)) throw new MusicalCutRefusal('range');
		const task = begin();
		const combined = AbortSignal.any([signal, task.signal]);
		try {
			const planes = [new Float32Array(Math.ceil(seconds * MUSICAL_CUT_RATE)), new Float32Array(Math.ceil(seconds * MUSICAL_CUT_RATE))];
			const chunkFrames = Math.round(rate * 8);
			for (let from = startFrame; from < endFrame; from += chunkFrames) {
				const to = Math.min(endFrame, from + chunkFrames);
				const buffer = await dependencies.render(project, { startFrame: from, endFrame: to }, combined, input.trackId);
				assertCurrent(task, project.id, revision, token, combined);
				if (buffer.sampleRate !== rate || !buffer.numberOfChannels || buffer.length !== to - from) throw new MusicalCutRefusal('range');
				const outputStart = Math.ceil((from - startFrame) * MUSICAL_CUT_RATE / rate);
				const outputEnd = Math.min(planes[0].length, Math.ceil((to - startFrame) * MUSICAL_CUT_RATE / rate));
				for (let ch = 0; ch < 2; ch++) {
					const source = buffer.getChannelData(Math.min(ch, buffer.numberOfChannels - 1));
					for (let i = outputStart; i < outputEnd; i++) {
						// Box low-pass before decimation; absolute positions prevent chunk drift.
						const a = Math.max(0, Math.floor(i * rate / MUSICAL_CUT_RATE - (from - startFrame)));
						const b = Math.min(source.length, Math.max(a + 1, Math.floor((i + 1) * rate / MUSICAL_CUT_RATE - (from - startFrame))));
						let sum = 0;
						for (let j = a; j < b; j++) sum += source[j];
						planes[ch][i] = sum / Math.max(1, b - a);
					}
				}
				progress((to - startFrame) / (endFrame - startFrame) * 0.8);
			}
			const report = await dependencies.analyze({ channels: planes, sampleRate: MUSICAL_CUT_RATE, removeSeconds: input.removeSeconds, toleranceSeconds: input.toleranceSeconds, deepSearch: input.deepSearch, respectPhrases: input.respectPhrases }, combined);
			assertCurrent(task, project.id, revision, token, combined);
			result = { ...report, range: { startFrame, endFrame }, sampleRate: rate, trackEndFrame: Math.max(...clips.map(clip => clip.timelineStartFrame + clip.durationFrames)),
				candidates: report.candidates.map(cut => ({ ...cut,
					startSeconds: cut.startSeconds + startFrame / rate, endSeconds: cut.endSeconds + startFrame / rate })),
				sectionSeconds: report.sectionSeconds.map(time => time + startFrame / rate),
				...(report.phrases ? { phrases: { ...report.phrases, boundaries: report.phrases.boundaries.map(point => ({ ...point, seconds: point.seconds + startFrame / rate })) } } : {}) };
			owner = { project, revision, token, input };
			progress(1);
			return result;
		} finally { finish(task); }
	}

	async function preview(candidate: MusicalCutCandidate, fadeMs: number, signal: AbortSignal, fromSeconds?: number): Promise<MusicalCutPreview> {
		const { project, revision, token, input } = assertOwner(candidate);
		const rate = dependencies.sampleRate();
		const extent = resultExtent(candidate, fadeMs);
		if (fromSeconds !== undefined && (!Number.isFinite(fromSeconds) || fromSeconds < 0 || fromSeconds * rate >= extent.endFrame)) throw new MusicalCutRefusal('range');
		const startFrame = Math.max(0, Math.round((fromSeconds ?? candidate.startSeconds - 2) * rate));
		const endFrame = Math.min(extent.endFrame, startFrame + rate * 4);
		const task = begin();
		const combined = AbortSignal.any([signal, task.signal]);
		try {
			// Audition the actual command on a detached project, including authored effects and fades.
			const staged = stagedResult(candidate, fadeMs);
			const buffer = await dependencies.render(staged, { startFrame, endFrame }, combined, input.trackId);
			assertCurrent(task, project.id, revision, token, combined);
			return { sampleRate: buffer.sampleRate, joinSeconds: candidate.startSeconds - startFrame / rate, startSeconds: startFrame / rate,
				channels: Array.from({ length: buffer.numberOfChannels }, (_, ch) => buffer.getChannelData(ch)) };
		} finally { finish(task); }
	}

	function resultExtent(candidate: MusicalCutCandidate, fadeMs: number): AnalysisRange {
		const { input } = assertOwner(candidate);
		const staged = stagedResult(candidate, fadeMs);
		const clips = musicalTrackClips(staged, input.trackId);
		return { startFrame: 0, endFrame: Math.max(...clips.map(clip => clip.timelineStartFrame + clip.durationFrames)) };
	}

	/** Render only the visible window, keeping at most eight seconds of full-rate PCM at once. */
	async function renderResultWindow(candidate: MusicalCutCandidate, fadeMs: number, range: AnalysisRange, columns: number, signal: AbortSignal, original = false): Promise<MusicalCutResultWindow> {
		const { project, revision, token, input } = assertOwner(candidate);
		const extent = original ? { endFrame: Math.max(...musicalTrackClips(project, input.trackId).map(clip => clip.timelineStartFrame + clip.durationFrames)) } : resultExtent(candidate, fadeMs);
		if (!Number.isSafeInteger(range.startFrame) || !Number.isSafeInteger(range.endFrame)
			|| range.startFrame < 0 || range.endFrame > extent.endFrame || range.endFrame <= range.startFrame) throw new MusicalCutRefusal('range');
		const rate = dependencies.sampleRate();
		// Validate columns before any cache access, including exact-window hits.
		const output = createMusicalCutResultWindow(range.startFrame, range.endFrame, rate, columns);
		windowTask?.abort(); signal.throwIfAborted();
		const variant = original ? 'original' : `${candidate.startSeconds}:${candidate.endSeconds}:${fadeMs}`;
		const key = `${variant}:${range.startFrame}:${range.endFrame}:${columns}`;
		const cached = cache.windows.get(key);
		if (cached) return cached;
		const staged = original ? project : stagedResult(candidate, fadeMs);
		const task = dependencies.lifetime.startTask('musical-cut-waveform', { scope: EDITOR_PROJECT_TASK_SCOPE });
		windowTask = task;
		const combined = AbortSignal.any([signal, task.signal]);
		try {
			combined.throwIfAborted();
			const block = rate * 8;
			for (let from = Math.floor(range.startFrame / block) * block; from < range.endFrame; from += block) {
				const to = Math.min(extent.endFrame, from + block);
				const chunkKey = `${variant}:${from}:${to}`;
				let chunk = cache.chunks.get(chunkKey);
				if (!chunk) {
					// Keep sample-level navigation small when no reusable full block exists.
					const small = range.endFrame - range.startFrame < rate;
					const startFrame = small ? Math.max(from, range.startFrame) : from;
					const endFrame = small ? Math.min(to, range.endFrame) : to;
					const buffer = await dependencies.render(staged, { startFrame, endFrame }, combined, input.trackId);
					assertCurrent(task, project.id, revision, token, combined);
					if (buffer.sampleRate !== rate || buffer.length !== endFrame - startFrame || buffer.numberOfChannels < 1 || buffer.numberOfChannels > 2) throw new MusicalCutRefusal('range');
					chunk = { startFrame, endFrame, channels: Array.from({ length: buffer.numberOfChannels }, (_, ch) => buffer.getChannelData(ch)) };
					if (!small) cache.chunks.set(chunkKey, chunk);
				}
				assertCurrent(task, project.id, revision, token, combined);
				const first = Math.max(range.startFrame, chunk.startFrame) - chunk.startFrame;
				const last = Math.min(range.endFrame, chunk.endFrame) - chunk.startFrame;
				output.append(chunk.channels.map(plane => plane.subarray(first, last)));
			}
			const window = output.finish(); cache.windows.set(key, window); return window;
		} finally {
			if (windowTask === task) windowTask = null;
			task.finish();
		}
	}

	function apply(candidate: MusicalCutCandidate, fadeMs: number, commit: (command: AudioEditorCommand) => unknown): unknown {
		assertOwner(candidate);
		for (const transport of transports) transport.stop();
		const command = prepare(candidate, fadeMs);
		const value = commit(command);
		windowTask?.abort();
		result = null; owner = null; prepared = null; cache.clear();
		return value;
	}
	function stagedResult(candidate: MusicalCutCandidate, fadeMs: number): P {
		const { project } = assertOwner(candidate);
		const command = prepare(candidate, fadeMs);
		return prepared!.staged ??= dependencies.stageCommand(project, command);
	}
	function prepare(candidate: MusicalCutCandidate, fadeMs: number): AudioEditorCommand {
		const { project, input } = assertOwner(candidate);
		if (!Number.isFinite(fadeMs) || fadeMs < 0 || fadeMs > 100) throw new MusicalCutRefusal('range');
		if (prepared?.candidate === candidate && prepared.fadeMs === fadeMs) return prepared.command;
		const rate = dependencies.sampleRate();
		const command = musicalCutCommand(project, input.trackId,
			Math.round(candidate.startSeconds * rate), Math.round(candidate.endSeconds * rate),
			Math.round(fadeMs / 1000 * rate), createStableId('clip'));
		prepared = { candidate, fadeMs, command };
		return command;
	}
	function assertOwner(candidate: MusicalCutCandidate) {
		assertAlive();
		if (!owner || !result?.candidates.includes(candidate)) throw new MusicalCutRefusal('stale');
		try {
			dependencies.assertProject(owner.token);
			if (dependencies.getProject().id !== owner.project.id || dependencies.getProject().revision !== owner.revision) throw new MusicalCutRefusal('stale');
		} catch (cause) { cache.clear(); throw cause; }
		return owner;
	}
	function assertAlive(): void {
		if (disposed) throw new DOMException('Musical cut dialog closed.', 'AbortError');
		dependencies.lifetime.assertActive();
	}
	function assertCurrent(task: EditorTaskScope, projectId: string, revision: number, token: EditorProjectToken, signal: AbortSignal): void {
		assertAlive(); signal.throwIfAborted(); task.assertCurrent(); dependencies.assertProject(token);
		if (dependencies.getProject().id !== projectId || dependencies.getProject().revision !== revision) throw new MusicalCutRefusal('stale');
	}
	function begin(): EditorTaskScope {
		active?.abort();
		const task = dependencies.lifetime.startTask('analysis', { scope: EDITOR_PROJECT_TASK_SCOPE });
		active = task;
		dependencies.busy(true);
		return task;
	}
	function finish(task: EditorTaskScope): void {
		if (active === task) {
			active = null;
			try { task.assertCurrent(); dependencies.busy(false); } catch { /* A newer analysis owns busy state. */ }
		}
		task.finish();
	}
	function dispose(): void {
		if (disposed) return;
		disposed = true;
		for (const transport of transports) void transport.dispose().catch(() => undefined);
		transports.clear();
		windowTask?.abort(); windowTask = null;
		if (active) {
			const task = active; active = null;
			try { task.assertCurrent(); dependencies.busy(false); } catch { /* Replaced task. */ }
			task.abort(); task.finish();
		}
		result = null; owner = null; prepared = null; cache.clear();
	}
}
