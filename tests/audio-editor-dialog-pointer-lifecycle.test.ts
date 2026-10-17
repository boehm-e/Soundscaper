/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { retainDialogMoveLifecycle } from '../src/common/editor/ui/dialog-move-lifecycle.ts';
import { retainResizableSurfaceMouseLifecycle } from '../src/common/editor/ui/resizable-surface-mouse-lifecycle.ts';

for (const mode of ['move', 'resize']) void test(`${mode} owns its pointer and rolls back cancellation`, () => {
	const document = new EventTarget() as unknown as Document;
	const target = mode === 'move' ? new EventTarget() : document;
	let moved = 0, committed = 0, canceled = 0, active = true;
	const callbacks = { move: () => { if (active) moved++; }, finish: () => { if (active) { committed++; active = false; } }, cancel: () => { if (active) { canceled++; active = false; } } };
	const retain = () => mode === 'move' ? retainDialogMoveLifecycle(document, target as Window, callbacks, 7)
		: retainResizableSurfaceMouseLifecycle(document, callbacks, 7);
	const send = (type: string, pointerId: number) => target.dispatchEvent(Object.assign(new Event(type), { pointerId, button: 0 }));
	let release = retain();
	send('pointermove', 8); send('pointerup', 8); send('pointercancel', 8);
	assert.deepEqual([moved, committed, canceled], [0, 0, 0]);
	send('pointermove', 7); send('pointerup', 7);
	assert.deepEqual([moved, committed, canceled], [1, 1, 0]);
	release(); active = true; release = retain();
	send('pointermove', 7); send('pointercancel', 7); send('pointerup', 7);
	assert.deepEqual([moved, committed, canceled], [2, 1, 1]);
	release(); send('pointermove', 7);
	assert.equal(moved, 2);
});
