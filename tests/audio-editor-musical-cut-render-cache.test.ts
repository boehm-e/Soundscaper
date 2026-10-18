/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMusicalCutRenderCache } from '../src/common/editor/controller/analysis/internal/musical-cut-render-cache.ts';

test('PCM uses an LRU byte budget while completed waveform windows have a separate budget', () => {
	const cache = createMusicalCutRenderCache(16, 64);
	const chunk = (sample: number) => ({ startFrame: 0, endFrame: 2, channels: [new Float32Array([sample, sample])] });
	cache.chunks.set('a', chunk(1)); cache.chunks.set('b', chunk(2));
	assert.equal(cache.chunks.get('a')?.channels[0][0], 1);
	cache.chunks.set('c', chunk(3));
	assert.equal(cache.chunks.get('b'), undefined);
	assert.ok(cache.chunks.get('a'));
	const waveform = { startFrame: 0, endFrame: 2, sampleRate: 1, channels: [{ minimum: new Float32Array(2), maximum: new Float32Array(2), rms: new Float32Array(2) }] };
	cache.windows.set('overview', waveform);
	cache.chunks.set('too-large', { startFrame: 0, endFrame: 20, channels: [new Float32Array(20)] });
	assert.equal(cache.chunks.get('too-large'), undefined);
	assert.equal(cache.windows.get('overview'), waveform);
	cache.clear(); cache.clear();
	assert.equal(cache.windows.get('overview'), undefined);
	assert.equal(cache.chunks.get('a'), undefined);
});
