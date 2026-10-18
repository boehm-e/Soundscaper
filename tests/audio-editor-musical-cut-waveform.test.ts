/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { musicalCutWaveform } from '../src/common/editor/musical-cut-waveform.ts';

test('waveform peaks retain a transient and opposite polarity without averaging them away', () => {
	const left = new Float32Array(100), right = new Float32Array(100);
	left[31] = 0.9; right[31] = -0.9;
	const wave = musicalCutWaveform([left, right], 10, 2, 6, 4);
	assert.equal(wave.durationSeconds, 4);
	assert.equal(wave.maximum.length, 4);
	assert.ok(wave.maximum[1] > 0.89);
	assert.ok(wave.minimum[1] < -0.89);
	assert.equal(wave.maximum[0], 0);
});
test('empty and shorter-than-bin inputs keep exact bounds and finite peaks', () => {
	assert.deepEqual(musicalCutWaveform([], 8000), { minimum: [], maximum: [], durationSeconds: 0 });
	const wave = musicalCutWaveform([new Float32Array([0.2, -0.3])], 8000, 0, 99);
	assert.equal(wave.maximum.length, 2);
	assert.equal(wave.durationSeconds, 2 / 8000);
});
