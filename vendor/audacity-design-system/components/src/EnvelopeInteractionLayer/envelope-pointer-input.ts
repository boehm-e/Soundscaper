/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

export const ENVELOPE_POINTER_COMMIT = 'scape:envelope-pointer-commit';
export const ENVELOPE_POINTER_CANCEL = 'scape:envelope-pointer-cancel';

/** Keep the existing mouse editing math, but give a finger or pen its own owner. */
export function beginEnvelopePointerDrag(
	event: ReactPointerEvent<HTMLDivElement>, owner: RefObject<number | null>,
	hasDrag: () => boolean, begin: () => void,
) {
	if (event.pointerType === 'mouse' || event.button !== 0) return;
	if (hasDrag() || event.isPrimary === false) { event.preventDefault(); event.stopPropagation(); return; }
	owner.current = null;
	begin();
	if (!hasDrag()) return;
	owner.current = event.pointerId;
	event.preventDefault(); // Suppress compatibility mouse events, which would edit twice.
	event.currentTarget.setPointerCapture?.(event.pointerId);
}

export function bindEnvelopePointerDrag(
	owner: RefObject<number | null>, hasDrag: () => boolean,
	move: (event: MouseEvent) => void, finish: (event: MouseEvent) => void, cancel: () => void,
) {
	const owned = (event: PointerEvent) => event.pointerId === owner.current && hasDrag();
	const stop = (event: PointerEvent) => { event.preventDefault(); event.stopPropagation(); };
	const pointerMove = (event: PointerEvent) => { if (owned(event)) { stop(event); move(event); } };
	const pointerUp = (event: PointerEvent) => {
		if (!owned(event) || event.button !== 0) return;
		stop(event); owner.current = null; finish(event);
		// The consumer publishes only after the final point update, and only
		// for the owning pointer (an unrelated palm release cannot commit).
		document.dispatchEvent(new Event(ENVELOPE_POINTER_COMMIT));
	};
	const pointerCancel = (event: PointerEvent) => {
		if (!owned(event)) return;
		stop(event); owner.current = null; cancel();
		document.dispatchEvent(new Event(ENVELOPE_POINTER_CANCEL));
	};
	const capture = { capture: true, passive: false };
	document.addEventListener('pointermove', pointerMove, capture);
	document.addEventListener('pointerup', pointerUp, capture);
	document.addEventListener('pointercancel', pointerCancel, capture);
	document.addEventListener('lostpointercapture', pointerCancel, capture);
	return () => {
		document.removeEventListener('pointermove', pointerMove, capture);
		document.removeEventListener('pointerup', pointerUp, capture);
		document.removeEventListener('pointercancel', pointerCancel, capture);
		document.removeEventListener('lostpointercapture', pointerCancel, capture);
	};
}
