/* SPDX-License-Identifier: AGPL-3.0-only */
import { runOneShotWorkerTask, type OneShotWorkerPort } from './one-shot-worker-task.ts';
import type { MusicalCutRequest, MusicalCutReport } from './musical-cut-analysis.ts';

/** Owns these downsampled planes: transfer them, rather than duplicating track PCM on Android. */
export function analyzeMusicalCutsInWorker(request: MusicalCutRequest, signal: AbortSignal): Promise<MusicalCutReport> {
	return runOneShotWorkerTask<MusicalCutReport>({ ...request }, () => new Worker(
		new URL('./musical-cut-worker-entry.ts', import.meta.url),
		{ type: 'module', name: 'soundscaper-musical-cuts' },
	) as unknown as OneShotWorkerPort, { signal, transfer: request.channels.map(channel => channel.buffer) });
}
