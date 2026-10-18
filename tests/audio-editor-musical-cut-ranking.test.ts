/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { musicalCutScores, sortMusicalCuts, shortlistMusicalCuts, selectMusicalCuts } from '../src/common/editor/musical-cut-ranking.ts';
import type { MusicalCutCandidate } from '../src/common/editor/musical-cut-analysis.ts';

const cut = (start: number, cost: number, removed: number): MusicalCutCandidate => ({ startSeconds: start,
	endSeconds: start + removed, cost, ...musicalCutScores(cost, removed, 60, 5), matchingSeconds: 4, nearSection: false });
test('musical compatibility is independent from target fit; exact tolerance and absent targets stay finite', () => {
	assert.equal(musicalCutScores(0.1, 64, 60, 5).musicScore, 90);
	assert.equal(musicalCutScores(0.1, 60, 60, 5).musicScore, 90);
	assert.ok(Math.abs(musicalCutScores(0.1, 64, 60, 5).durationScore! - 87.2) < 1e-8);
	assert.equal(musicalCutScores(0.1, 62.5, 60, 5).durationScore, 95);
	assert.equal(musicalCutScores(0.1, 65, 60, 5).durationScore, 80);
	assert.equal(musicalCutScores(0.1, 60, 60, 0).durationScore, 100);
	assert.equal(musicalCutScores(0.1, 60, undefined, 5).durationScore, null);
});
test('all three sorts retain the best contenders and do not mutate the selected candidate', () => {
	const musical = cut(2, 0.01, 64), duration = cut(8, 0.2, 60), balanced = cut(14, 0.05, 60.1);
	const candidates = [duration, musical, balanced];
	assert.equal(sortMusicalCuts(candidates, 'music')[0], musical);
	assert.equal(sortMusicalCuts(candidates, 'duration')[0], duration);
	assert.equal(sortMusicalCuts(candidates, 'average')[0], balanced);
	assert.deepEqual(new Set(shortlistMusicalCuts(candidates, 1)), new Set(candidates));
	assert.ok(selectMusicalCuts(candidates).includes(duration));
	assert.deepEqual(candidates, [duration, musical, balanced]);
});
