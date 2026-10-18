/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MusicalCutCandidate } from './musical-cut-analysis.ts';
export function musicalCutFrames(cut: MusicalCutCandidate, sampleRate: number) {
	const start = Math.round(cut.startSeconds * sampleRate), end = Math.round(cut.endSeconds * sampleRate);
	return { start, end, removed: end - start };
}
export function musicalCutOriginalFrame(frame: number, start: number, removed: number): number {
	return frame < start ? frame : frame + removed;
}
export function musicalCutResultFrame(frame: number, start: number, end: number): number {
	return frame < start ? frame : frame < end ? start : frame - (end - start);
}
export interface MusicalCutComparisonPart {
	readonly startFrame: number; readonly endFrame: number;
	readonly renderStart: number; readonly renderEnd: number;
	readonly original: boolean; readonly removed: boolean;
}
/** Display can keep the removed material on the original axis while retained audio comes from the exact edit. */
export function musicalCutComparisonParts(startFrame: number, endFrame: number, cutStart: number, cutEnd: number,
	showRemoved: boolean, original: boolean): readonly MusicalCutComparisonPart[] {
	if (!showRemoved || original) return [{ startFrame, endFrame, renderStart: startFrame, renderEnd: endFrame, original, removed: false }];
	const removed = cutEnd - cutStart;
	const regions = [
		{ start: startFrame, end: Math.min(endFrame, cutStart), offset: 0, original: false, removed: false },
		{ start: Math.max(startFrame, cutStart), end: Math.min(endFrame, cutEnd), offset: 0, original: true, removed: true },
		{ start: Math.max(startFrame, cutEnd), end: endFrame, offset: removed, original: false, removed: false },
	];
	return regions.filter(part => part.end > part.start).map(part => ({ startFrame: part.start, endFrame: part.end,
		renderStart: part.start - part.offset, renderEnd: part.end - part.offset, original: part.original, removed: part.removed }));
}
/** Vertical display magnification only; playback gain is never normalized for the comparison. */
export function musicalCutFitAmplitude(peak: number): number {
	return peak > 0 ? Math.max(0, Math.min(10, Math.floor(Math.log2(0.85 / peak)))) : 0;
}
