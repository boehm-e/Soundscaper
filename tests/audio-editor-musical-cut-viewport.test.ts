/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { musicalCutViewport, zoomMusicalCutViewport } from '../src/common/editor/ui/dialogs/musical-cut-viewport.ts';
test('zoom preserves the time under the pointer and panning does not change the visible span', () => {
	const v = { startFrame: 100, endFrame: 900 };
	const z = zoomMusicalCutViewport(v, 2, 0.25, 2000);
	assert.deepEqual(z, { startFrame: 200, endFrame: 600 });
	assert.equal(v.startFrame + 0.25 * 800, z.startFrame + 0.25 * 400);
	assert.deepEqual(musicalCutViewport(-50, 400, 2000), { startFrame: 0, endFrame: 400 });
	assert.deepEqual(musicalCutViewport(1900, 400, 2000), { startFrame: 1600, endFrame: 2000 });
	assert.deepEqual(zoomMusicalCutViewport(v, 0.01, 0.5, 2000), { startFrame: 0, endFrame: 2000 });
	assert.equal(zoomMusicalCutViewport(v, 1e9, 0.5, 2000, 64).endFrame - zoomMusicalCutViewport(v, 1e9, 0.5, 2000, 64).startFrame, 64);
});
