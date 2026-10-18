/* SPDX-License-Identifier: AGPL-3.0-only */
import type { EnginePublicApi } from '../../engine/public-api.ts';
import type { MusicalCutCandidate } from '../../musical-cut-analysis.ts';
import type { EditorControllerLifetime, EditorTaskScope } from '../shared/lifecycle.ts';
import { EDITOR_PROJECT_TASK_SCOPE } from '../shared/lifecycle.ts';

export type MusicalCutPlaybackEngine = Pick<EnginePublicApi,
	'getAudioContext' | 'loadProject' | 'setSourceResolver' | 'play' | 'pause' | 'stop' | 'seek' | 'setLoop' | 'setPlayRange' | 'subscribePosition' | 'dispose'>;
export interface MusicalCutPlaybackResources {
	createEngine(options: Readonly<{ onState(state: string): void }>): MusicalCutPlaybackEngine;
	loadProject(engine: MusicalCutPlaybackEngine, project: Readonly<Record<string, unknown>>): void;
	prepare(project: unknown, signal: AbortSignal): Promise<unknown>;
	retirePlayback(): void;
}
export interface MusicalCutTransportSnapshot {
	readonly state: 'stopped' | 'loading' | 'playing' | 'paused';
	readonly positionFrame: number;
	readonly original: boolean;
}
interface Request { readonly candidate: MusicalCutCandidate; readonly fadeMs: number; readonly original: boolean }
interface Dependencies {
	readonly lifetime: EditorControllerLifetime;
	readonly resources: MusicalCutPlaybackResources;
	resolve(request: Request): Readonly<{ project: Readonly<Record<string, unknown>>; identity: object; endFrame: number }>;
	assertCurrent(candidate: MusicalCutCandidate): void;
}

/** The editor's normal streaming engine, owned by the dialog rather than the document transport. */
export function createMusicalCutTransport(dependencies: Dependencies) {
	let snapshot: MusicalCutTransportSnapshot = Object.freeze({ state: 'stopped', positionFrame: 0, original: false });
	const listeners = new Set<() => void>();
	let engine: MusicalCutPlaybackEngine | null = null;
	let loaded: object | null = null;
	let task: EditorTaskScope | null = null;
	let request: Request | null = null;
	let unsubscribe: (() => unknown) | null = null;
	let disposed = false;
	let disposal: Promise<void> | null = null;
	let startFrame = 0;
	const abort = () => { void dispose().catch(() => undefined); };
	dependencies.lifetime.signal.addEventListener('abort', abort, { once: true });
	return Object.freeze({ snapshot: () => snapshot, subscribe, play, pause, stop, seek, dispose });
	function update(changes: Partial<MusicalCutTransportSnapshot>): void {
		snapshot = Object.freeze({ ...snapshot, ...changes }); for (const listener of listeners) listener();
	}
	function subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
	function assertAlive(): void {
		dependencies.lifetime.assertActive();
		if (disposed) throw new DOMException('Musical cut transport closed.', 'AbortError');
	}
	async function play(candidate: MusicalCutCandidate, fadeMs: number, original: boolean, fromFrame = snapshot.positionFrame): Promise<boolean> {
		assertAlive(); dependencies.assertCurrent(candidate);
		const resolved = dependencies.resolve({ candidate, fadeMs, original });
		if (!Number.isSafeInteger(fromFrame) || fromFrame < 0 || fromFrame >= resolved.endFrame) throw new RangeError('Invalid playback start.');
		task?.abort(); task?.finish();
		const current = dependencies.lifetime.startTask('musical-cut-playback', { scope: EDITOR_PROJECT_TASK_SCOPE }); task = current;
		engine ??= ownedEngine();
		engine.pause();
		// Claim Android's user activation before awaiting cache preparation or output routing.
		const unlock = engine.getAudioContext();
		request = { candidate, fadeMs, original }; startFrame = fromFrame;
		update({ state: 'loading', positionFrame: fromFrame, original });
		try {
			dependencies.resources.retirePlayback();
			await unlock;
			assertAlive(); current.assertCurrent();
			await dependencies.resources.prepare(resolved.project, current.signal);
			assertAlive(); current.assertCurrent(); dependencies.assertCurrent(candidate);
			if (loaded !== resolved.identity) { dependencies.resources.loadProject(engine, resolved.project); loaded = resolved.identity; }
			engine.setLoop(false); engine.setPlayRange(null); engine.seek(fromFrame);
			update({ state: 'playing' });
			await engine.play();
			assertAlive(); current.assertCurrent(); dependencies.assertCurrent(candidate);
			return true;
		} catch (cause) {
			if (task !== current || current.signal.aborted || disposed) return false;
			engine.pause(); update({ state: 'paused' }); throw cause;
		} finally { if (task === current) task = null; current.finish(); }
	}
	function ownedEngine(): MusicalCutPlaybackEngine {
		const owned = dependencies.resources.createEngine({ onState: state => {
			if (disposed || snapshot.state === 'loading') return;
			if (state === 'playing' || state === 'paused' || state === 'stopped') update({ state });
		} });
		unsubscribe = owned.subscribePosition(positionFrame => {
			if (disposed || !request) return;
			try { dependencies.assertCurrent(request.candidate); } catch { stop(); return; }
			update({ positionFrame });
		});
		return owned;
	}
	function pause(): void {
		task?.abort(); task?.finish(); task = null; engine?.pause();
		if (!disposed) update({ state: 'paused' });
	}
	function stop(): void {
		task?.abort(); task?.finish(); task = null;
		request = null;
		engine?.stop(); engine?.seek(startFrame);
		if (!disposed) update({ state: 'stopped', positionFrame: startFrame });
	}
	function seek(frame: number): void {
		assertAlive();
		if (!Number.isSafeInteger(frame) || frame < 0) throw new RangeError('Invalid seek.');
		engine?.seek(frame); update({ positionFrame: frame });
	}
	function dispose(): Promise<void> {
		if (disposal) return disposal;
		disposed = true; stop();
		dependencies.lifetime.signal.removeEventListener('abort', abort);
		unsubscribe?.(); unsubscribe = null; listeners.clear();
		const owned = engine; engine = null; loaded = null;
		disposal = Promise.resolve().then(() => owned?.dispose()).then(() => undefined);
		return disposal;
	}
}
