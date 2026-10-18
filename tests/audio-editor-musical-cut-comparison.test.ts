/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { musicalCutComparisonParts, musicalCutFitAmplitude, musicalCutOriginalFrame, musicalCutResultFrame } from '../src/common/editor/musical-cut-comparison.ts';
test('comparison keeps the removed original audio grey while retained regions map to the edited audio', () => {
	assert.deepEqual(musicalCutComparisonParts(40, 180, 60, 140, true, false), [
		{ startFrame: 40, endFrame: 60, renderStart: 40, renderEnd: 60, original: false, removed: false },
		{ startFrame: 60, endFrame: 140, renderStart: 60, renderEnd: 140, original: true, removed: true },
		{ startFrame: 140, endFrame: 180, renderStart: 60, renderEnd: 100, original: false, removed: false },
	]);
	assert.deepEqual(musicalCutComparisonParts(150, 180, 60, 140, true, false), [
		{ startFrame: 150, endFrame: 180, renderStart: 70, renderEnd: 100, original: false, removed: false },
	]);
	assert.equal(musicalCutComparisonParts(40, 180, 60, 140, true, true).length, 1);
});
test('before/after cursor conversion skips the removed interval and amplitude fit changes only display scale', () => {
	assert.equal(musicalCutResultFrame(100, 60, 140), 60);
	assert.equal(musicalCutResultFrame(160, 60, 140), 80);
	assert.equal(musicalCutOriginalFrame(80, 60, 80), 160);
	assert.equal(musicalCutOriginalFrame(40, 60, 80), 40);
	assert.equal(musicalCutFitAmplitude(0.025), 5);
	assert.equal(musicalCutFitAmplitude(0), 0);
	assert.equal(musicalCutFitAmplitude(1.1), 0);
});
