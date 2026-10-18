/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MusicalFrame } from './musical-cut-features.ts';
import { trackMusicalBeats, type MusicalBeatTrack } from './musical-cut-beats.ts';

export interface MusicalPhraseBoundary {
	readonly frame: number;
	readonly strength: number;
	readonly scaleBeats: number;
}
export interface MusicalPhraseAnalysis extends MusicalBeatTrack {
	readonly boundaries: readonly MusicalPhraseBoundary[];
	readonly confidence: number;
	readonly positions: Float32Array;
	readonly support: Float32Array;
	readonly context: Float32Array;
}
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const dimensions = 19;
const contextDimensions = 72;

/** Beat-synchronous multiscale novelty plus repeated boundary support.
 * Linear storage: prefix sums, short beat contexts and frame lookup tables; no dense recurrence matrix.
 * The 4/8/16-bar hypotheses only reinforce observed boundaries, never manufacture a rigid phrase grid. */
export function analyzeMusicalPhrases(frames: readonly MusicalFrame[], period: number | null): MusicalPhraseAnalysis {
	const track = trackMusicalBeats(frames, period), count = track.beats.length;
	const positions = new Float32Array(frames.length), support = new Float32Array(frames.length);
	const context = new Float32Array(count * contextDimensions);
	const empty = { ...track, positions, support, context, confidence: 0, boundaries: [] };
	if (count < 12) return empty;
	const data = new Float64Array(count * dimensions), prefix = new Float64Array((count + 1) * dimensions);
	track.beats.forEach((start, beat) => {
		const end = track.beats[beat + 1] ?? frames.length;
		for (let frame = start; frame < end; frame++) {
			positions[frame] = beat + (frame - start) / Math.max(1, end - start);
			for (let k = 0; k < 12; k++) data[beat * dimensions + k] += frames[frame].chroma[k];
			for (let k = 0; k < 6; k++) data[beat * dimensions + 12 + k] += frames[frame].bands[k];
			data[beat * dimensions + 18] += Math.log(frames[frame].energy + 1e-8);
		}
		for (let k = 0; k < dimensions; k++) {
			data[beat * dimensions + k] /= Math.max(1, end - start);
			prefix[(beat + 1) * dimensions + k] = prefix[beat * dimensions + k] + data[beat * dimensions + k];
		}
	});
	for (let i = 0; i < track.beats[0]; i++) positions[i] = (i - track.beats[0]) / Math.max(1, track.beats[1] - track.beats[0]);
	const average = (from: number, to: number) => {
		const a = Math.max(0, Math.min(count, from)), b = Math.max(0, Math.min(count, to));
		return Array.from({ length: dimensions }, (_, k) => (prefix[b * dimensions + k] - prefix[a * dimensions + k]) / Math.max(1, b - a));
	};
	const bar = track.meter ?? 4, novelty = new Float64Array(count), scale = new Uint16Array(count);
	for (let beat = 1; beat < count - 1; beat++) {
		// Two bars on either side distinguish a repeated chord from a matching musical continuation.
		for (let part = 0; part < 4; part++) {
			const values = average(beat + (part - 2) * bar, beat + (part - 1) * bar);
			context.set([...unit(values.slice(0, 12)), ...unit(values.slice(12, 18))], beat * contextDimensions + part * 18);
		}
		for (const window of [bar, bar * 2, bar * 4, bar * 8]) {
			if (beat < window || beat + window >= count) continue;
			const value = descriptorDistance(average(beat - window, beat), average(beat, beat + window));
			if (value > novelty[beat]) { novelty[beat] = value; scale[beat] = window; }
		}
	}
	const maximum = Math.max(...novelty), threshold = Math.max(0.08, maximum * 0.3);
	const peaks: { beat: number; strength: number }[] = [];
	for (let beat = bar; beat < count - bar; beat++) {
		if (novelty[beat] < threshold || novelty[beat] < novelty[beat - 1] || novelty[beat] <= novelty[beat + 1]) continue;
		let recurrence = 0;
		for (const length of [bar * 4, bar * 8, bar * 16]) for (const direction of [-1, 1]) {
			const other = beat + length * direction;
			if (other < bar || other + bar >= count) continue;
			let distance = 0;
			for (let k = -bar; k < bar; k++) distance += descriptorDistance(
				Array.from(data.subarray((beat + k) * dimensions, (beat + k + 1) * dimensions)),
				Array.from(data.subarray((other + k) * dimensions, (other + k + 1) * dimensions)));
			recurrence = Math.max(recurrence, clamp(1 - distance / (2 * bar * 0.25)) * clamp(novelty[other] / maximum));
		}
		const metrical = track.meter ? circular((beat - track.downbeatOffset) / bar) : 0;
		peaks.push({ beat, strength: clamp(novelty[beat] / maximum) * (0.75 + recurrence * 0.25) * (1 - metrical * track.meterConfidence) });
	}
	let boundaries: MusicalPhraseBoundary[] = [];
	for (const peak of peaks.sort((a, b) => b.strength - a.strength)) {
		const frame = track.beats[peak.beat];
		if (boundaries.some(other => Math.abs(positions[other.frame] - peak.beat) < bar)) continue;
		boundaries.push({ frame, strength: peak.strength, scaleBeats: scale[peak.beat] });
	}
	if (boundaries.length > 96) {
		// Keep coverage throughout long tracks rather than spending the whole marker budget on one loud section.
		const regions = new Map<number, MusicalPhraseBoundary>();
		for (const point of boundaries) {
			const region = Math.floor(point.frame / frames.length * 96);
			if (!regions.has(region)) regions.set(region, point);
		}
		const selected = new Set(regions.values());
		for (const point of boundaries) { if (selected.size >= 96) break; selected.add(point); }
		boundaries = [...selected];
	}
	boundaries.sort((a, b) => a.frame - b.frame);
	for (const boundary of boundaries) {
		const beat = positions[boundary.frame], radius = Math.ceil((period ?? 0.5) / 0.05);
		for (let i = Math.max(0, boundary.frame - radius); i < Math.min(frames.length, boundary.frame + radius + 1); i++) {
			support[i] = Math.max(support[i], boundary.strength * Math.exp(-(((positions[i] - beat) / 0.5) ** 2)));
		}
	}
	const confidence = track.beatConfidence * clamp(maximum / 0.25) * (boundaries.length >= 2 ? 1 : 0);
	return { ...track, boundaries, confidence, positions, support, context };
}

/** Soft structural preference; uncertain or non-rhythmic material retains acoustic ranking. */
export function musicalPhrasePairScore(model: MusicalPhraseAnalysis, a: number, b: number): number | null {
	if (model.confidence < 0.2 || a < 0 || b >= model.positions.length) return null;
	const left = Math.max(1, Math.min(model.beats.length - 2, Math.round(model.positions[a]))) * contextDimensions;
	const right = Math.max(1, Math.min(model.beats.length - 2, Math.round(model.positions[b]))) * contextDimensions;
	let harmony = 0, timbre = 0;
	for (let part = 0; part < 4; part++) {
		for (let k = 0; k < 18; k++) {
			const product = model.context[left + part * 18 + k] * model.context[right + part * 18 + k];
			if (k < 12) harmony += product; else timbre += product;
		}
	}
	const continuation = clamp(0.7 * harmony / 4 + 0.3 * timbre / 4);
	const boundaries = Math.sqrt(model.support[a] * model.support[b]);
	const delta = model.positions[b] - model.positions[a];
	const beatPhase = 1 - 2 * circular(delta);
	const barPhase = model.meter ? 1 - 2 * circular(delta / model.meter) : 1;
	return Math.round(1000 * clamp(0.45 * continuation + 0.35 * boundaries + 0.1 * beatPhase
		+ 0.1 * (1 - model.meterConfidence + barPhase * model.meterConfidence))) / 10;
}

function circular(value: number): number { return Math.abs(value - Math.round(value)); }
function unit(values: readonly number[]): number[] {
	const norm = Math.hypot(...values);
	return values.map(value => norm > 1e-10 ? value / norm : 0);
}
function descriptorDistance(a: readonly number[], b: readonly number[]): number {
	const dot = (from: number, to: number) => {
		let product = 0, aa = 0, bb = 0;
		for (let k = from; k < to; k++) { product += a[k] * b[k]; aa += a[k] ** 2; bb += b[k] ** 2; }
		return aa * bb > 1e-16 ? clamp(1 - product / Math.sqrt(aa * bb)) : 0;
	};
	return 0.6 * dot(0, 12) + 0.25 * dot(12, 18) + 0.15 * Math.min(1, Math.abs(a[18] - b[18]) / 2);
}
