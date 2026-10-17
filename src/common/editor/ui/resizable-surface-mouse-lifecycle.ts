/* SPDX-License-Identifier: AGPL-3.0-only */

import { retainAudioEditorDialogEscapeOwner } from './dialog-escape-ownership.ts';

export function retainResizableSurfaceMouseLifecycle(
	document: Document,
	callbacks: Readonly<{
		move(event: MouseEvent): void;
		finish(): void;
		cancel(): void;
	}>,
	pointerId?: number,
): () => void {
	const owns = (event: MouseEvent) => pointerId === undefined || ('pointerId' in event && event.pointerId === pointerId);
	const move = (event: MouseEvent) => { if (owns(event)) callbacks.move(event); };
	const finish = (event: MouseEvent) => { if (owns(event) && event.button === 0) callbacks.finish(); };
	const cancel = (event: PointerEvent) => { if (event.pointerId === pointerId) callbacks.cancel(); };
	const moveType = pointerId === undefined ? 'mousemove' : 'pointermove';
	const upType = pointerId === undefined ? 'mouseup' : 'pointerup';
	const releaseEscape = retainAudioEditorDialogEscapeOwner(document, callbacks.cancel);
	document.addEventListener(moveType, move);
	document.addEventListener(upType, finish);
	if (pointerId !== undefined) {
		document.addEventListener('pointercancel', cancel);
		document.addEventListener('lostpointercapture', cancel);
	}
	return () => {
		releaseEscape();
		document.removeEventListener(moveType, move);
		document.removeEventListener(upType, finish);
		document.removeEventListener('pointercancel', cancel);
		document.removeEventListener('lostpointercapture', cancel);
		callbacks.cancel();
	};
}
