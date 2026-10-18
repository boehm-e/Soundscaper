/* SPDX-License-Identifier: AGPL-3.0-only */
import { analyzeMusicalCuts, prepareMusicalCutSearch } from './musical-cut-analysis.ts';
import { searchMusicalCutPlan, finishMusicalCutSearch, musicalCutParallelSearchUseful } from './musical-cut-search.ts';
import type { MusicalCutWorkerTask } from './musical-cut-worker-protocol.ts';
const scope = globalThis as unknown as {
	onmessage: ((event: { data: MusicalCutWorkerTask & { requestId: string } }) => void) | null;
	postMessage(message: unknown, transfer?: readonly Transferable[]): void;
};
scope.onmessage = ({ data }) => {
	try {
		if (data.task === 'prepare') {
			const plan = prepareMusicalCutSearch(data.request);
			if (data.parallelism > 1 && musicalCutParallelSearchUseful(plan)) {
				scope.postMessage({ requestId: data.requestId, type: 'result', result: { kind: 'parallel', plan } }, [plan.packed.buffer]);
			} else {
				const report = finishMusicalCutSearch(plan, [searchMusicalCutPlan(plan)], 1);
				scope.postMessage({ requestId: data.requestId, type: 'result', result: { kind: 'complete', report } });
			}
		} else {
			const result = data.task === 'full' ? analyzeMusicalCuts(data.request)
				: data.task === 'search' ? searchMusicalCutPlan(data.plan, data.lane, data.lanes)
					: finishMusicalCutSearch(data.plan, data.batches, data.workers);
			scope.postMessage({ requestId: data.requestId, type: 'result', result });
		}
	}
	catch (cause) {
		const error = cause instanceof Error ? cause : new Error(String(cause));
		scope.postMessage({ requestId: data.requestId, type: 'error', error: { name: error.name, message: error.message } });
	}
};
