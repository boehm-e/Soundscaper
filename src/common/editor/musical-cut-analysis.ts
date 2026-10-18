/* SPDX-License-Identifier: AGPL-3.0-only */
import {
	musicalCutFeatures, musicalFrameDistance, MUSICAL_CUT_HOP_SECONDS as hop,
	MUSICAL_CUT_MAX_SECONDS, type MusicalFrame,
} from './musical-cut-features.ts';
import { musicalCutScores, shortlistMusicalCuts, selectMusicalCuts } from './musical-cut-ranking.ts';
import { musicalCutWaveform, type MusicalCutWaveform } from './musical-cut-waveform.ts';

export interface MusicalCutRequest {
	readonly channels: readonly Float32Array[];
	readonly sampleRate: number;
	readonly removeSeconds?: number;
	readonly toleranceSeconds?: number;
}
export interface MusicalCutCandidate {
	readonly startSeconds: number;
	readonly endSeconds: number;
	readonly cost: number;
	readonly musicScore: number;
	readonly durationScore: number | null;
	readonly matchingSeconds: number;
	readonly nearSection: boolean;
}
export interface MusicalCutReport {
	readonly candidates: readonly MusicalCutCandidate[];
	readonly sectionSeconds: readonly number[];
	readonly beatSeconds: number | null;
	readonly waveform?: MusicalCutWaveform;
}

/** Independent lightweight DSP. See docs/features/musical-cuts.md for method and research references. */
export function analyzeMusicalCuts(request: MusicalCutRequest): MusicalCutReport {
	validate(request);
	const duration = request.channels[0].length / request.sampleRate;
	const waveform = musicalCutWaveform(request.channels, request.sampleRate);
	const empty: MusicalCutReport = { candidates: [], sectionSeconds: [], beatSeconds: null, waveform };
	const tolerance = request.toleranceSeconds ?? 5;
	if (duration < 5 || (request.removeSeconds ?? 0) - tolerance > duration - 2) return empty;
	const features = musicalCutFeatures(request.channels, request.sampleRate);
	const maxEnergy = Math.max(...features.map(frame => frame.energy));
	if (maxEnergy < 1e-5) return empty;
	const beat = beatPeriod(features);
	const sections = sectionBoundaries(features);
	const context = Math.max(20, Math.round((beat ? beat * 4 : 2) / hop));
	const margin = Math.max(context, 20);
	const anchors: number[] = [];
	// Local onsets offer rhythm-aligned anchors; a sparse grid also covers sustained music.
	for (let i = margin; i < features.length - margin; i++) {
		if (features[i].energy < maxEnergy * 0.02) continue;
		const peak = features[i].onset > 0 && features[i].onset >= features[i - 1].onset
			&& features[i].onset > features[i + 1].onset;
		if (peak || i % 10 === 0) anchors.push(i);
	}
	// Bound pair search independently of recording length, without an N² recurrence matrix.
	const stride = Math.max(1, Math.ceil(anchors.length / 900));
	const sampled = anchors.filter((_, index) => index % stride === 0);
	const scored: MusicalCutCandidate[] = [];
	const target = request.removeSeconds;
	for (let a = 0; a < sampled.length; a++) {
		for (let b = a + 1; b < sampled.length; b++) {
			const i = sampled[a], j = sampled[b];
			const removed = (j - i) * hop;
			if (removed < Math.max(1, (beat ?? 0.5) * 2)) continue;
			if (target !== undefined && Math.abs(removed - target) > tolerance + 1e-8) continue;
			if (musicalFrameDistance(features[i], features[j]) > 0.3) continue;
			const rhythm = beat ? Math.abs(removed / beat - Math.round(removed / beat)) : 0;
			if (beat && rhythm > 0.18) continue;
			let distance = 0;
			// Compare a complete sequence on BOTH sides, not just an isolated chord/beat.
			for (let k = -context; k < context; k += 4) {
				distance += musicalFrameDistance(features[i + k], features[j + k]);
			}
			distance /= Math.ceil(context * 2 / 4);
			if (distance > 0.22) continue;
			const nearSection = sections.some(section => Math.abs(section - i) < 20 || Math.abs(section - j) < 20);
			const cost = distance + rhythm * 0.15 + (nearSection ? 0 : 0.025);
			scored.push({ startSeconds: i * hop, endSeconds: j * hop, cost,
				...musicalCutScores(cost, removed, target, tolerance),
				matchingSeconds: context * 2 * hop, nearSection });
			// Repetitive tracks can match almost every pair: retain a bounded shortlist.
			if (scored.length >= 2048) {
				scored.splice(0, scored.length, ...shortlistMusicalCuts(scored, 256));
			}
		}
	}
	const candidates = selectMusicalCuts(scored);
	return { candidates, sectionSeconds: sections.map(i => i * hop), beatSeconds: beat, waveform };
}

function validate({ channels, sampleRate, removeSeconds, toleranceSeconds }: MusicalCutRequest): void {
	if (!Number.isFinite(sampleRate) || sampleRate < 4000 || sampleRate > 48000) throw new RangeError('Invalid analysis sample rate.');
	if (!channels.length || channels.length > 2 || channels.some(channel => !(channel instanceof Float32Array)
		|| channel.length !== channels[0].length || channel.length > sampleRate * MUSICAL_CUT_MAX_SECONDS)) {
		throw new RangeError('Analyze up to 10 minutes of mono or stereo audio at a time.');
	}
	if (removeSeconds !== undefined && (!Number.isFinite(removeSeconds) || removeSeconds <= 0)) throw new RangeError('Invalid removal duration.');
	if (toleranceSeconds !== undefined && (!Number.isFinite(toleranceSeconds) || toleranceSeconds < 0 || toleranceSeconds > MUSICAL_CUT_MAX_SECONDS)) throw new RangeError('Invalid duration tolerance.');
	for (const channel of channels) for (const sample of channel) {
		if (!Number.isFinite(sample)) throw new RangeError('Audio contains non-finite samples.');
	}
}

function beatPeriod(frames: readonly MusicalFrame[]): number | null {
	const mean = frames.reduce((sum, frame) => sum + frame.onset, 0) / frames.length;
	const variance = frames.reduce((sum, frame) => sum + (frame.onset - mean) ** 2, 0);
	if (variance < 1e-8) return null;
	let best = 0, lagBest = 0;
	for (let lag = 6; lag <= 24; lag++) {
		let score = 0;
		for (let i = lag; i < frames.length; i++) score += (frames[i].onset - mean) * (frames[i - lag].onset - mean);
		score /= variance;
		if (score > best) { best = score; lagBest = lag; }
	}
	return best > 0.18 ? lagBest * hop : null;
}

function sectionBoundaries(frames: readonly MusicalFrame[]): number[] {
	const values: { index: number; novelty: number }[] = [];
	for (let i = 40; i < frames.length - 40; i += 10) {
		let novelty = 0;
		for (let k = 5; k <= 35; k += 10) novelty += musicalFrameDistance(frames[i - k], frames[i + k]);
		values.push({ index: i, novelty: novelty / 4 });
	}
	const boundaries: number[] = [];
	for (const value of values.sort((a, b) => b.novelty - a.novelty)) {
		if (value.novelty > 0.2 && !boundaries.some(i => Math.abs(i - value.index) < 60)) boundaries.push(value.index);
		if (boundaries.length === 24) break;
	}
	return boundaries.sort((a, b) => a - b);
}
