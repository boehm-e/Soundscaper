/* SPDX-License-Identifier: AGPL-3.0-only */
import type { AudioEditorCommand } from './commands/protocol.ts';
import { prepareRangeDeleteCommand } from './commands/range-runtime.js';
import { projectForCommandConsumers, projectForRuntimeConsumers } from './project-current-runtime.ts';
import type { RuntimeClipProject } from './runtime-clip-projection.ts';

export interface MusicalCutClip {
	readonly id: string;
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames?: number;
	readonly kind?: string;
	readonly speedRatio?: number;
	readonly reversed?: boolean;
	readonly warpMap?: unknown;
	readonly loop?: unknown;
	readonly stretchToTempo?: boolean;
	readonly avLinkId?: string | null;
	readonly groupId?: string | null;
}
export class MusicalCutRefusal extends Error {
	constructor(readonly code: 'track' | 'range' | 'length' | 'stale' | 'complex' | 'empty') {
		super(`Musical cut: ${code}`);
	}
}

/** One undo entry, original source preserved; the existing ripple command owns later clips/labels. */
export function musicalCutCommand(
	project: unknown, trackId: string, startFrame: number, endFrame: number,
	fadeFrames: number, rightClipId: string,
): AudioEditorCommand {
	if (![startFrame, endFrame, fadeFrames].every(Number.isSafeInteger)
		|| startFrame < 0 || endFrame <= startFrame || fadeFrames < 0 || fadeFrames > endFrame - startFrame) {
		throw new MusicalCutRefusal('range');
	}
	const half = Math.floor(fadeFrames / 2);
	const clips = musicalTrackClips(project, trackId);
	const left = clips.filter(item => item.timelineStartFrame < startFrame - half
		&& item.timelineStartFrame + item.durationFrames >= startFrame + half);
	const right = clips.filter(item => item.timelineStartFrame <= endFrame - half
		&& item.timelineStartFrame + item.durationFrames > endFrame + half);
	const clip = left[0], resume = right[0];
	if (left.length !== 1 || right.length !== 1 || clips.some(item => item.avLinkId || item.groupId)
		|| [clip, resume].some(item => item.kind === 'video' || item.reversed || item.warpMap || item.loop || item.stretchToTempo
			|| (item.speedRatio ?? 1) !== 1 || (item.sourceDurationFrames ?? item.durationFrames) !== item.durationFrames)
		|| clips.some(item => item.id !== clip.id && intersects(item, startFrame - half, startFrame + half)
			|| item.id !== resume.id && intersects(item, endFrame - half, endFrame + half))) {
		throw new MusicalCutRefusal('complex');
	}
	const deletion = prepareRangeDeleteCommand(projectForCommandConsumers(project as Record<string, unknown>), {
		trackIds: [trackId], startFrame, endFrame, rippleMode: 'track',
	}, () => rightClipId) as AudioEditorCommand;
	const commands: AudioEditorCommand[] = [deletion];
	if (half > 0) {
		const leftFrames = startFrame - clip.timelineStartFrame + half;
		const rightFrames = resume.timelineStartFrame + resume.durationFrames - endFrame + half;
		commands.push(
			{ type: 'clip/trim', clipId: clip.id, sourceRange: true,
				durationFrames: leftFrames, sourceDurationFrames: leftFrames, fadeOutFrames: half * 2, fadeOutShape: 1 },
			{ type: 'clip/trim', clipId: clip.id === resume.id ? rightClipId : resume.id, sourceRange: true,
				timelineStartFrame: startFrame - half,
				sourceStartFrame: resume.sourceStartFrame + endFrame - resume.timelineStartFrame - half,
				sourceDurationFrames: rightFrames, durationFrames: rightFrames, fadeInFrames: half * 2, fadeInShape: 1 },
		);
	}
	commands.push({ type: 'selection/set', startFrame, endFrame: startFrame, trackIds: [trackId], clipIds: [] });
	return { type: 'batch', commands };
}
function intersects(clip: MusicalCutClip, start: number, end: number): boolean {
	return clip.timelineStartFrame < end && clip.timelineStartFrame + clip.durationFrames > start;
}

/** Narrow the runtime projection at the boundary; audio geometry stays in timeline sample frames. */
export function musicalTrackClips(value: unknown, trackId: string): MusicalCutClip[] {
	const project = projectForRuntimeConsumers(value as RuntimeClipProject);
	const track = project.tracks?.find(item => record(item)?.id === trackId);
	const row = record(track);
	if (row?.type !== 'audio' || !Array.isArray(row.clipIds)) throw new MusicalCutRefusal('track');
	const ids = new Set(row.clipIds as unknown[]);
	return project.clips.filter(item => ids.has(record(item)?.id)).map(item => {
		const clip = record(item);
		if (!clip || typeof clip.id !== 'string' || !['timelineStartFrame', 'durationFrames', 'sourceStartFrame']
			.every(key => Number.isSafeInteger(clip[key]))) throw new MusicalCutRefusal('complex');
		return clip as unknown as MusicalCutClip;
	});
}
function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}
