/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMusicalCutResultWindow } from '../src/common/editor/musical-cut-result-window.ts';

test('chunk boundaries preserve exact extrema and RMS in uneven global columns, independently per channel', () => {
	const left = Float32Array.from([0.2, -0.9, 0.4, 0.1, 0.8, -0.3, 0.5, -0.7, 0.6, 0.1, -0.2]);
	const right = left.map(x => -x);
	const a = createMusicalCutResultWindow(100, 111, 48_000, 3);
	a.append([left.slice(0, 5), right.slice(0, 5)]); a.append([left.slice(5), right.slice(5)]);
	const b = createMusicalCutResultWindow(100, 111, 48_000, 3); b.append([left, right]);
	const result = a.finish();
	assert.deepEqual(result, b.finish()); assert.equal(result.pcm, undefined);
	assert.equal(result.channels[0].maximum[1], left[4]);
	assert.equal(result.channels[0].minimum[0], left[1]);
	assert.equal(result.channels[1].maximum[0], -left[1]);
	assert.ok(Math.abs(result.channels[0].rms[0] - Math.sqrt(left.slice(0, 4).reduce((sum, x) => sum + x * x, 0) / 4)) < 1e-7);
});
test('sample zoom retains exact stereo PCM; incomplete and inconsistent renders are rejected', () => {
	const a = createMusicalCutResultWindow(0, 4, 48_000, 10);
	a.append([Float32Array.from([0.1, -0.1]), Float32Array.from([0.3, -0.3])]);
	assert.throws(() => a.finish(), /Incomplete/);
	assert.throws(() => a.append([new Float32Array(2)]), /channels/);
	a.append([Float32Array.from([0.2, -0.2]), Float32Array.from([0.4, -0.4])]);
	assert.deepEqual(a.finish().pcm?.[0], Float32Array.from([0.1, -0.1, 0.2, -0.2]));
	assert.throws(() => createMusicalCutResultWindow(0, 10, 48_000, 5000));
});
