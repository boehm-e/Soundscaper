/* SPDX-License-Identifier: AGPL-3.0-only */

export interface MusicalCutWaveform {
	readonly minimum: readonly number[];
	readonly maximum: readonly number[];
	readonly durationSeconds: number;
}

/** Compact signed peaks retain quiet passages, isolated transients and opposite-polarity stereo. */
export function musicalCutWaveform(
	channels: readonly Float32Array[], sampleRate: number, startSeconds = 0,
	endSeconds = (channels[0]?.length ?? 0) / sampleRate, bins = 360,
): MusicalCutWaveform {
	const length = channels[0]?.length ?? 0;
	const start = Math.max(0, Math.min(length, Math.floor(startSeconds * sampleRate)));
	const end = Math.max(start, Math.min(length, Math.ceil(endSeconds * sampleRate)));
	const count = Math.min(Math.max(1, Math.round(bins)), end - start);
	const minimum: number[] = [], maximum: number[] = [];
	for (let bin = 0; bin < count; bin++) {
		const from = start + Math.floor(bin * (end - start) / count);
		const to = start + Math.floor((bin + 1) * (end - start) / count);
		let low = 0, high = 0;
		for (const channel of channels) for (let frame = from; frame < to; frame++) {
			low = Math.min(low, channel[frame]); high = Math.max(high, channel[frame]);
		}
		minimum.push(low); maximum.push(high);
	}
	return { minimum, maximum, durationSeconds: (end - start) / sampleRate };
}
