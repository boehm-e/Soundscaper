/* SPDX-License-Identifier: AGPL-3.0-only */
import { createStableId } from '../../stable-id.js';
import type { AudioEditorCommand } from '../../commands/protocol.ts';
import type { MusicalCutCandidate, MusicalCutReport, MusicalCutRequest } from '../../musical-cut-analysis.ts';
import { MUSICAL_CUT_RATE, MUSICAL_CUT_MAX_SECONDS } from '../../musical-cut-features.ts';
import { musicalCutCommand, musicalTrackClips, MusicalCutRefusal } from '../../musical-cut-edit.ts';
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
}
export interface MusicalCutsInput {
	readonly trackId: string;
	readonly range?: AnalysisRange;
	readonly removeSeconds?: number;
}
export interface MusicalCutsResult extends MusicalCutReport {
	readonly range: AnalysisRange;
	readonly sampleRate: number;
}
export interface MusicalCutPreview {
	readonly channels: readonly Float32Array[];
	readonly sampleRate: number;
	readonly joinSeconds: number;
}
export type MusicalCutsSession = ReturnType<typeof createMusicalCutsSession>;

/** Dialog-scoped authority, bounded chunk renders, cancellation and exact staged-edit audition. */
export function createMusicalCutsSession<P extends Project>(dependencies: Dependencies<P>) {
	let disposed = false;
	let active: EditorTaskScope | null = null;
	let result: MusicalCutsResult | null = null;
	let owner: { project: P; revision: number; token: EditorProjectToken; input: MusicalCutsInput } | null = null;
	let prepared: { candidate: MusicalCutCandidate; fadeMs: number; command: AudioEditorCommand } | null = null;
	return Object.freeze({ analyze, preview, apply, dispose });

	async function analyze(input: MusicalCutsInput, signal: AbortSignal, progress: (fraction: number) => void = () => undefined): Promise<MusicalCutsResult> {
		assertAlive();
		result = null; owner = null; prepared = null;
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
			const report = await dependencies.analyze({ channels: planes, sampleRate: MUSICAL_CUT_RATE, removeSeconds: input.removeSeconds }, combined);
			assertCurrent(task, project.id, revision, token, combined);
			result = { ...report, range: { startFrame, endFrame }, sampleRate: rate,
				candidates: report.candidates.map(cut => ({ ...cut,
					startSeconds: cut.startSeconds + startFrame / rate, endSeconds: cut.endSeconds + startFrame / rate })),
				sectionSeconds: report.sectionSeconds.map(time => time + startFrame / rate) };
			owner = { project, revision, token, input };
			progress(1);
			return result;
		} finally { finish(task); }
	}

	async function preview(candidate: MusicalCutCandidate, fadeMs: number, signal: AbortSignal): Promise<MusicalCutPreview> {
		const { project, revision, token, input } = assertOwner(candidate);
		const command = prepare(candidate, fadeMs);
		const rate = dependencies.sampleRate();
		const startFrame = Math.max(0, Math.round((candidate.startSeconds - 2) * rate));
		const endFrame = Math.round((candidate.startSeconds + 2) * rate);
		const task = begin();
		const combined = AbortSignal.any([signal, task.signal]);
		try {
			// Audition the actual command on a detached project, including authored effects and fades.
			const staged = dependencies.stageCommand(project, command);
			const buffer = await dependencies.render(staged, { startFrame, endFrame }, combined, input.trackId);
			assertCurrent(task, project.id, revision, token, combined);
			return { sampleRate: buffer.sampleRate, joinSeconds: candidate.startSeconds - startFrame / rate,
				channels: Array.from({ length: buffer.numberOfChannels }, (_, ch) => buffer.getChannelData(ch)) };
		} finally { finish(task); }
	}

	function apply(candidate: MusicalCutCandidate, fadeMs: number, commit: (command: AudioEditorCommand) => unknown): unknown {
		assertOwner(candidate);
		const command = prepare(candidate, fadeMs);
		const value = commit(command);
		result = null; owner = null; prepared = null;
		return value;
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
		dependencies.assertProject(owner.token);
		if (dependencies.getProject().id !== owner.project.id || dependencies.getProject().revision !== owner.revision) throw new MusicalCutRefusal('stale');
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
		if (active) {
			const task = active; active = null;
			try { task.assertCurrent(); dependencies.busy(false); } catch { /* Replaced task. */ }
			task.abort(); task.finish();
		}
		result = null; owner = null; prepared = null;
	}
}
