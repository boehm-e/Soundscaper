/* SPDX-License-Identifier: AGPL-3.0-only */
export interface MusicalCutViewport { readonly startFrame: number; readonly endFrame: number }
/** Shared anchor arithmetic for buttons, wheel and two-pointer pinch. */
export function musicalCutViewport(start: number, span: number, total: number, minimum = 1): MusicalCutViewport {
	const length = Math.max(1, Math.min(total, Math.max(minimum, Math.round(span))));
	const startFrame = Math.max(0, Math.min(total - length, Math.round(start)));
	return { startFrame, endFrame: startFrame + length };
}
export function zoomMusicalCutViewport(view: MusicalCutViewport, factor: number, anchor: number, total: number, minimum = 1): MusicalCutViewport {
	const span = view.endFrame - view.startFrame;
	const next = Math.max(minimum, Math.min(total, span / factor));
	return musicalCutViewport(view.startFrame + anchor * (span - next), next, total, minimum);
}
