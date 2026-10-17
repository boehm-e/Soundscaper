/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { isPrimaryPointer } from '../vendor/audacity-design-system/components/src/utils/pointerInput.ts';

void test('pointer controls accept a non-primary pen while rejecting secondary fingers', () => {
	assert.equal(isPrimaryPointer({ pointerType: 'pen', isPrimary: false }), true);
	assert.equal(isPrimaryPointer({ pointerType: 'touch', isPrimary: false }), false);
	assert.equal(isPrimaryPointer({ pointerType: 'mouse', isPrimary: false }), false);
	for (const pointerType of ['pen', 'touch', 'mouse']) assert.equal(isPrimaryPointer({ pointerType, isPrimary: true }), true);
	assert.equal(isPrimaryPointer({}), true);
});
