/* SPDX-License-Identifier: AGPL-3.0-only */
import { analyzeMusicalCuts, type MusicalCutRequest } from './musical-cut-analysis.ts';
const scope = globalThis as unknown as {
	onmessage: ((event: { data: MusicalCutRequest & { requestId: string } }) => void) | null;
	postMessage(message: unknown): void;
};
scope.onmessage = ({ data }) => {
	try { scope.postMessage({ requestId: data.requestId, type: 'result', result: analyzeMusicalCuts(data) }); }
	catch (cause) {
		const error = cause instanceof Error ? cause : new Error(String(cause));
		scope.postMessage({ requestId: data.requestId, type: 'error', error: { name: error.name, message: error.message } });
	}
};
