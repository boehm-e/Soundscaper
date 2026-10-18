/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MusicalFrame } from './musical-cut-features.ts';
import { MUSICAL_CUT_HOP_SECONDS as hop } from './musical-cut-features.ts';

export interface MusicalBeatTrack {
	readonly beats: readonly number[];
	readonly beatConfidence: number;
	readonly meter: number | null;
	readonly meterConfidence: number;
	readonly downbeatOffset: number;
}

/** Onset-driven dynamic programming: a tempo prior, not a fixed grid anchored at time zero.
 * Frames may move around the prior to follow a pickup or gradual tempo changes. */
export function trackMusicalBeats(frames: readonly MusicalFrame[], periodSeconds: number | null): MusicalBeatTrack {
	const empty: MusicalBeatTrack = { beats: [], beatConfidence: 0, meter: null, meterConfidence: 0, downbeatOffset: 0 };
	if (!periodSeconds || frames.length < 80) return empty;
	const peak = Math.max(...frames.map(frame => frame.onset));
	if (peak < 1e-8) return empty;
	const period = periodSeconds / hop, minimum = Math.max(3, Math.floor(period * 0.65)), maximum = Math.ceil(period * 1.4);
	const scores = new Float64Array(frames.length), previous = new Int32Array(frames.length).fill(-1);
	let end = 0;
	for (let i = 0; i < frames.length; i++) {
		let best = 0;
		for (let lag = minimum; lag <= maximum && lag <= i; lag++) {
			const score = scores[i - lag] - 5 * Math.log(lag / period) ** 2 - 0.15;
			if (score > best) { best = score; previous[i] = i - lag; }
		}
		scores[i] = best + 2 * frames[i].onset / peak;
		if (scores[i] > scores[end]) end = i;
	}
	const beats: number[] = [];
	for (let i = end; i >= 0; i = previous[i]) beats.push(i);
	beats.reverse();
	if (beats.length < 8) return empty;
	const supported = beats.filter(i => frames[i].onset > peak * 0.12).length / beats.length;
	const coverage = (beats.at(-1)! - beats[0]) / frames.length;
	const beatConfidence = Math.max(0, Math.min(1, supported * coverage));
	if (beatConfidence < 0.35) return empty;
	const accents = beats.map(i => frames[i].onset / peak);
	const hypotheses = [3, 4].map(meter => {
		const means = Array.from({ length: meter }, (_, phase) => {
			let sum = 0, count = 0;
			for (let i = phase; i < accents.length; i += meter) { sum += accents[i]; count++; }
			return count ? sum / count : 0;
		});
		const offset = means.indexOf(Math.max(...means)), other = (means.reduce((a, b) => a + b, 0) - means[offset]) / (meter - 1);
		return { meter, offset, strength: Math.max(0, means[offset] - other) };
	}).sort((a, b) => b.strength - a.strength);
	const best = hypotheses[0], confidence = Math.min(1, (best.strength - hypotheses[1].strength) * 2) * beatConfidence;
	return { beats, beatConfidence, meter: confidence >= 0.25 ? best.meter : null,
		meterConfidence: confidence, downbeatOffset: best.offset };
}
