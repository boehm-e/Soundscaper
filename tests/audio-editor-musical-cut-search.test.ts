/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { musicalFrameDistance, type MusicalFrame } from '../src/common/editor/musical-cut-features.ts';
import { musicalCutPackedDistance, musicalCutParallelSearchUseful, createMusicalCutContextDistance, searchMusicalCutPlan, finishMusicalCutSearch, type MusicalCutSearchPlan } from '../src/common/editor/musical-cut-search.ts';
import { analyzeMusicalCuts, prepareMusicalCutSearch } from '../src/common/editor/musical-cut-analysis.ts';

function frames(count: number): MusicalFrame[] {
	return Array.from({ length: count }, (_, i) => ({ chroma: Float32Array.from({ length: 12 }, (_, k) => k === Math.floor(i / 10) % 4 ? 1 : 0),
		bands: Float32Array.from([0, 1, 0, 0, 0, 0]), energy: 0.2 + (i % 10) / 20, onset: i % 10 === 0 ? 0.5 : 0 }));
}
function plan(): MusicalCutSearchPlan {
	const data = frames(600), packed = new Float64Array(data.length * 19);
	data.forEach((frame, i) => { packed.set(frame.chroma, i * 19); packed.set(frame.bands, i * 19 + 12); packed[i * 19 + 18] = Math.log(frame.energy + 1e-8); });
	return { packed, points: Array.from({ length: 560 }, (_, i) => i + 20), context: 20, beat: 0.5, target: 8, tolerance: 5,
		sections: [80, 160], minimumLogEnergy: -10, deep: true, waveform: { minimum: [], maximum: [], durationSeconds: 30 } };
}
test('packed comparisons retain chroma, timbre and logarithmic-level distances', () => {
	const p = plan(), data = frames(600);
	for (const [a, b] of [[20, 40], [13, 27], [58, 579]]) assert.ok(Math.abs(musicalCutPackedDistance(p.packed, a, b) - musicalFrameDistance(data[a], data[b])) < 1e-12);
});
test('rolling context matches brute-force sequences across residues and gaps with fewer distance evaluations', () => {
	let calls = 0;
	const p = plan(), distance = (a: number, b: number) => musicalCutPackedDistance(p.packed, a, b);
	const optimized = createMusicalCutContextDistance((a, b) => { calls++; return distance(a, b); }, 80, 23);
	const points = [...Array.from({ length: 200 }, (_, i) => i + 23), 350, 401];
	for (const i of points) {
		let mean = 0;
		for (let k = -23; k < 23; k += 4) mean += distance(i + k, i + 80 + k);
		assert.ok(Math.abs(optimized(i) - mean / 12) < 1e-12);
	}
	assert.ok(calls < points.length * 12 / 3, `${calls} comparisons versus ${points.length * 12}`);
});
test('parallel lag partitions preserve the complete result and bounded pair-work statistics', () => {
	const p = plan(), serial = finishMusicalCutSearch(p, [searchMusicalCutPlan(p)], 1);
	const parallel = finishMusicalCutSearch(p, [searchMusicalCutPlan(p, 0, 2), searchMusicalCutPlan(p, 1, 2)], 2);
	assert.deepEqual(parallel.candidates, serial.candidates);
	assert.equal(parallel.search?.pairs, serial.search?.pairs);
	assert.equal(parallel.search?.distances, serial.search?.distances);
	assert.equal(parallel.search?.workers, 2);
	assert.throws(() => searchMusicalCutPlan(p, 2, 2), /partition/);
});
test('deep search includes fast anchors and never worsens the best musical match', () => {
	const rate = 8000, channels = [Float32Array.from({ length: rate * 24 }, (_, i) => {
		const t = i / rate, note = [220, 277.18, 329.63, 277.18][Math.floor(t * 2) % 4];
		return (0.1 + 0.4 * Math.exp(-(t % 0.5) * 18)) * Math.sin(2 * Math.PI * note * t);
	})];
	const request = { channels, sampleRate: rate, removeSeconds: 8, toleranceSeconds: 1 };
	const fastPlan = prepareMusicalCutSearch(request), deepPlan = prepareMusicalCutSearch({ ...request, deepSearch: true });
	assert.ok(fastPlan.points.every(point => deepPlan.points.includes(point)));
	assert.ok(deepPlan.points.length > fastPlan.points.length);
	assert.ok(deepPlan.points.length <= 6000);
	const fast = analyzeMusicalCuts(request), deep = analyzeMusicalCuts({ ...request, deepSearch: true });
	assert.ok(deep.candidates[0].musicScore >= fast.candidates[0].musicScore);
	assert.ok(deep.candidates.every(cut => Math.abs(cut.endSeconds - cut.startSeconds - 8) <= 1 + 1e-8));
});

test('only sufficiently large searches use parallel dispatch', () => {
	const p = plan();
	assert.equal(musicalCutParallelSearchUseful(p), false);
	const large = { ...p, points: Array.from({ length: 5500 }, (_, i) => i * 2), target: undefined };
	assert.equal(musicalCutParallelSearchUseful(large), true);
	assert.equal(musicalCutParallelSearchUseful({ ...large, target: 20, tolerance: 5 }), false);
});

test('phrase analysis survives worker partitioning, respects duration bounds and remains opt-in', () => {
	const rate = 8000, channels = [Float32Array.from({ length: rate * 64 }, (_, i) => {
		const t = i / rate, beat = Math.floor(t * 2), note = [220, 277.18, 329.63, 246.94][Math.floor(beat / 4) % 4];
		return (0.05 + (beat % 4 === 0 ? 0.5 : 0.2) * Math.exp(-(t % 0.5) * 24)) * Math.sin(2 * Math.PI * note * t);
	})];
	const input = { channels, sampleRate: rate, removeSeconds: 8, toleranceSeconds: 0.5 };
	const plain = analyzeMusicalCuts(input);
	assert.deepEqual(analyzeMusicalCuts({ ...input, respectPhrases: false }), plain);
	assert.equal(plain.phrases, undefined);
	const p = prepareMusicalCutSearch({ ...input, deepSearch: true, respectPhrases: true });
	assert.ok(p.phrases && p.phrases.beats.length > 40);
	const serial = finishMusicalCutSearch(p, [searchMusicalCutPlan(p)], 1);
	const clone = structuredClone(p);
	const parallel = finishMusicalCutSearch(clone, [searchMusicalCutPlan(clone, 0, 2), searchMusicalCutPlan(clone, 1, 2)], 2);
	assert.deepEqual(parallel.candidates, serial.candidates);
	assert.deepEqual(parallel.phrases, serial.phrases);
	assert.ok(serial.phrases && serial.phrases.confidence >= 0.2);
	assert.ok(serial.phrases.boundaries.length > 0);
	assert.ok(serial.candidates.length > 0);
	assert.ok(serial.candidates.every(cut => cut.phraseScore !== null && cut.phraseScore !== undefined && Math.abs(cut.endSeconds - cut.startSeconds - 8) <= 0.5 + 1e-8));
	const texture = { ...input, channels: [new Float32Array(rate * 10)], respectPhrases: true };
	assert.equal(analyzeMusicalCuts(texture).phrases?.confidence, 0);
});
