/* SPDX-License-Identifier: AGPL-3.0-only */
import { runOneShotWorkerTask, type OneShotWorkerPort } from '../../one-shot-worker-task.ts';
import type { MusicalCutRequest, MusicalCutReport } from '../../musical-cut-analysis.ts';
import type { MusicalCutSearchBatch } from '../../musical-cut-search.ts';
import type { MusicalCutWorkerTask, MusicalCutPreparation } from '../../musical-cut-worker-protocol.ts';

interface Resources { availableCores(): number; createWorker(): OneShotWorkerPort }

/** At most two searches at once; shared features are computed once and PCM is transferred once. */
export async function runMusicalCutAnalysis(request: MusicalCutRequest, signal: AbortSignal, resources: Resources): Promise<MusicalCutReport> {
	const failed = new AbortController();
	const combined = AbortSignal.any([signal, failed.signal]);
	const run = <T>(task: MusicalCutWorkerTask, transfer: readonly Transferable[] = []) =>
		runOneShotWorkerTask<T>({ ...task }, () => resources.createWorker(), { signal: combined, transfer });
	try {
		if (!request.deepSearch) return await run<MusicalCutReport>({ task: 'full', request }, request.channels.map(channel => channel.buffer));
		const cores = resources.availableCores();
		const lanes = Number.isFinite(cores) && cores >= 4 ? 2 : 1;
		const prepared = await run<MusicalCutPreparation>({ task: 'prepare', request, parallelism: lanes }, request.channels.map(channel => channel.buffer));
		combined.throwIfAborted();
		if (prepared.kind === 'complete') return prepared.report;
		const plan = prepared.plan;
		const batches = await Promise.all(Array.from({ length: lanes }, async (_, lane) => {
			const packed = plan.packed.slice();
			return await run<MusicalCutSearchBatch>({ task: 'search', plan: { ...plan, packed }, lane, lanes }, [packed.buffer]);
		}));
		combined.throwIfAborted();
		return await run<MusicalCutReport>({ task: 'finish', plan, batches, workers: lanes }, [plan.packed.buffer]);
	} catch (cause) { failed.abort(); throw cause; }
}
