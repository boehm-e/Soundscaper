/* SPDX-License-Identifier: AGPL-3.0-only */

import { retainAudioEditorDialogEscapeOwner } from './dialog-escape-ownership.ts';

/** A title move owns dismissal until it completes or restores its starting offset. */
export function retainDialogMoveLifecycle(
	document: Document,
	window: Window,
	callbacks: Readonly<{
		move(event: MouseEvent): void;
		finish(): void;
		cancel(): void;
	}>,
	pointerId?: number,
): () => void {
	let active = true;
	const owns = (event: MouseEvent) => pointerId === undefined || ('pointerId' in event && event.pointerId === pointerId);
	const move = (event: MouseEvent) => { if (active && owns(event)) callbacks.move(event); };
	const moveType = pointerId === undefined ? 'mousemove' : 'pointermove';
	const upType = pointerId === undefined ? 'mouseup' : 'pointerup';
	const cancel = (event: PointerEvent) => {
		if (!active || event.pointerId !== pointerId) return;
		release(); callbacks.cancel();
	};
	const release = () => {
		if (!active) return;
		active = false;
		releaseEscape();
		window.removeEventListener(moveType, move);
		window.removeEventListener(upType, finish);
		window.removeEventListener('pointercancel', cancel);
		window.removeEventListener('lostpointercapture', cancel);
	};
	const finish = (event: MouseEvent) => {
		if (!active || !owns(event) || event.button !== 0) return;
		release();
		callbacks.finish();
	};
	const releaseEscape = retainAudioEditorDialogEscapeOwner(document, () => {
		release();
		callbacks.cancel();
	});
	window.addEventListener(moveType, move);
	window.addEventListener(upType, finish);
	if (pointerId !== undefined) {
		window.addEventListener('pointercancel', cancel);
		window.addEventListener('lostpointercapture', cancel);
	}
	return release;
}
