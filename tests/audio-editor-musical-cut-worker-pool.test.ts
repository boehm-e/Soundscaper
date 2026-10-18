/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runMusicalCutAnalysis } from '../src/common/editor/controller/analysis/musical-cut-worker-pool.ts';
import { analyzeMusicalCuts, prepareMusicalCutSearch } from '../src/common/editor/musical-cut-analysis.ts';
import { searchMusicalCutPlan, finishMusicalCutSearch } from '../src/common/editor/musical-cut-search.ts';
import type { OneShotWorkerPort } from '../src/common/editor/one-shot-worker-task.ts';
import type { MusicalCutWorkerTask } from '../src/common/editor/musical-cut-worker-protocol.ts';

type Listener = Parameters<OneShotWorkerPort['addEventListener']>[1];
function request() {
	return { channels: [Float32Array.from({ length: 8000 * 12 }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 220 * i / 8000))], sampleRate: 8000, removeSeconds: 4, deepSearch: true };
}
function harness(cores = 8, hold = false, fail = false) {
	const tasks: string[] = [], workers: Port[] = [];
	let active = 0, maximum = 0;
	class Port implements OneShotWorkerPort {
		terminated = false;
		listeners = new Map<string, Set<Listener>>();
		constructor() { active++; maximum = Math.max(maximum, active); workers.push(this); }
		addEventListener(type: string, listener: Listener) { const group = this.listeners.get(type) ?? new Set(); group.add(listener); this.listeners.set(type, group); }
		removeEventListener(type: string, listener: Listener) { this.listeners.get(type)?.delete(listener); }
		terminate() { if (!this.terminated) { this.terminated = true; active--; } }
		postMessage(message: unknown, transfer: readonly Transferable[] = []) {
			const data = structuredClone(message, { transfer: [...transfer] }) as MusicalCutWorkerTask & { requestId: string };
			tasks.push(data.task);
			if (data.task === 'search' && hold && (!fail || data.lane !== 0)) return;
			queueMicrotask(() => {
				if (this.terminated) return;
				if (fail && data.task === 'search') { for (const fn of this.listeners.get('error') ?? []) fn({ message: 'Search failed' }); return; }
				const result = data.task === 'prepare' ? (data.parallelism > 1 ? { kind: 'parallel', plan: prepareMusicalCutSearch(data.request) }
					: { kind: 'complete', report: analyzeMusicalCuts(data.request) }) : data.task === 'full' ? analyzeMusicalCuts(data.request)
					: data.task === 'search' ? searchMusicalCutPlan(data.plan, data.lane, data.lanes) : finishMusicalCutSearch(data.plan, data.batches, data.workers);
				for (const fn of this.listeners.get('message') ?? []) fn({ data: { requestId: data.requestId, type: 'result', result } });
			});
		}
	}
	return { tasks, workers, resources: { availableCores: () => cores, createWorker: () => new Port() }, maximum: () => maximum };
}
test('deep analysis computes features once, transfers PCM once and bounds parallel searches', async () => {
	const h = harness(), input = request(), expected = analyzeMusicalCuts(structuredClone(input));
	const result = await runMusicalCutAnalysis(input, new AbortController().signal, h.resources);
	assert.equal(input.channels[0].byteLength, 0);
	assert.deepEqual(result.candidates, expected.candidates);
	assert.deepEqual(h.tasks, ['prepare', 'search', 'search', 'finish']);
	assert.equal(result.search?.workers, 2); assert.equal(h.maximum(), 2);
	assert.ok(h.workers.every(worker => worker.terminated));
});
test('small devices keep one search worker and fast mode retains its one-shot path', async () => {
	const small = harness(2);
	assert.equal((await runMusicalCutAnalysis(request(), new AbortController().signal, small.resources)).search?.workers, 1);
	assert.equal(small.maximum(), 1);
	const fast = harness();
	await runMusicalCutAnalysis({ ...request(), deepSearch: false }, new AbortController().signal, fast.resources);
	assert.deepEqual(fast.tasks, ['full']);
});
test('cancellation and a failed shard terminate every peer without starting reduction', async () => {
	const cancelled = harness(8, true), abort = new AbortController();
	const work = runMusicalCutAnalysis(request(), abort.signal, cancelled.resources);
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(cancelled.tasks.filter(task => task === 'search').length, 2);
	abort.abort(); await assert.rejects(work, { name: 'AbortError' });
	assert.ok(cancelled.workers.every(worker => worker.terminated));
	assert.ok(!cancelled.tasks.includes('finish'));
	const failed = harness(8, true, true);
	await assert.rejects(runMusicalCutAnalysis(request(), new AbortController().signal, failed.resources), /Search failed/);
	assert.ok(failed.workers.every(worker => worker.terminated));
	assert.ok(!failed.tasks.includes('finish'));
});

test('a synchronous worker creation failure retires an already-started peer', async () => {
	const h = harness(8, true); let created = 0;
	const resources = { ...h.resources, createWorker: () => {
		if (++created === 3) throw new Error('Cannot create worker');
		return h.resources.createWorker();
	} };
	await assert.rejects(runMusicalCutAnalysis(request(), new AbortController().signal, resources), /Cannot create worker/);
	assert.ok(h.workers.every(worker => worker.terminated));
});
