/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { beginEnvelopePointerDrag, bindEnvelopePointerDrag, ENVELOPE_POINTER_COMMIT, ENVELOPE_POINTER_CANCEL } from '../vendor/audacity-design-system/components/src/EnvelopeInteractionLayer/envelope-pointer-input.ts';

void test('finger and pen strokes retain ownership, publish once, and cancel without committing', () => {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
	const document = new EventTarget();
	Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
	try {
		for (const [pointerType, isPrimary] of [['touch', true], ['pen', true], ['pen', false]] as const) {
			const owner = { current: null as number | null };
			let active = false, moves = 0, releases = 0, rollbacks = 0, commits = 0, cancellations = 0;
			const commit = () => { commits++; }, cancel = () => { cancellations++; };
			document.addEventListener(ENVELOPE_POINTER_COMMIT, commit);
			document.addEventListener(ENVELOPE_POINTER_CANCEL, cancel);
			const unbind = bindEnvelopePointerDrag(owner, () => active, () => { moves++; },
				() => { active = false; releases++; }, () => { active = false; rollbacks++; });
			const start = (id: number) => beginEnvelopePointerDrag({ pointerId: id, pointerType, button: 0, isPrimary,
				preventDefault() {}, stopPropagation() {}, currentTarget: { setPointerCapture() {} },
			} as unknown as ReactPointerEvent<HTMLDivElement>, owner, () => active, () => { active = true; });
			const send = (type: string, pointerId: number, button = 0) => document.dispatchEvent(
				Object.assign(new Event(type, { cancelable: true }), { pointerId, button }));
			start(1); start(2);
			send('pointermove', 2); send('pointerup', 2); send('pointerup', 1, 1);
			assert.equal(moves, 0); assert.equal(commits, 0); assert.equal(owner.current, 1);
			send('pointermove', 1); send('pointerup', 1); send('pointerup', 1);
			assert.equal(moves, 1); assert.equal(releases, 1); assert.equal(commits, 1);
			start(3); send('pointermove', 3); send('pointercancel', 3); send('pointerup', 3);
			assert.equal(rollbacks, 1); assert.equal(cancellations, 1); assert.equal(commits, 1);
			start(4); send('lostpointercapture', 4); send('pointerup', 4);
			assert.equal(rollbacks, 2); assert.equal(cancellations, 2); assert.equal(commits, 1);
			unbind(); start(5); send('pointermove', 5); send('pointerup', 5);
			assert.equal(moves, 2); assert.equal(commits, 1, 'disposed listeners cannot publish');
			document.removeEventListener(ENVELOPE_POINTER_COMMIT, commit);
			document.removeEventListener(ENVELOPE_POINTER_CANCEL, cancel);
		}
	} finally {
		if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
		else Reflect.deleteProperty(globalThis, 'document');
	}
});

void test('a secondary touch cannot start a clip gain edit', () => {
	const owner = { current: null as number | null };
	let started = false;
	beginEnvelopePointerDrag({ pointerId: 2, pointerType: 'touch', button: 0, isPrimary: false,
		preventDefault() {}, stopPropagation() {},
	} as unknown as ReactPointerEvent<HTMLDivElement>, owner, () => started, () => { started = true; });
	assert.equal(started, false); assert.equal(owner.current, null);
});
