/* SPDX-License-Identifier: AGPL-3.0-only */
import {
	musicalCutFeatures, musicalFrameDistance, MUSICAL_CUT_HOP_SECONDS as hop,
	MUSICAL_CUT_MAX_SECONDS, type MusicalFrame,
} from './musical-cut-features.ts';
import { finishMusicalCutSearch, searchMusicalCutPlan, type MusicalCutSearchPlan } from './musical-cut-search.ts';
import { musicalCutWaveform, type MusicalCutWaveform } from './musical-cut-waveform.ts';
import { analyzeMusicalPhrases } from './musical-cut-phrases.ts';

export interface MusicalCutRequest {
	readonly channels: readonly Float32Array[];
	readonly sampleRate: number;
	readonly removeSeconds?: number;
	readonly toleranceSeconds?: number;
	readonly deepSearch?: boolean;
	readonly respectPhrases?: boolean;
}
export interface MusicalCutCandidate {
	readonly startSeconds: number;
	readonly endSeconds: number;
	readonly cost: number;
	readonly musicScore: number;
	readonly durationScore: number | null;
	readonly matchingSeconds: number;
	readonly nearSection: boolean;
	readonly phraseScore?: number | null;
}
export interface MusicalCutReport {
	readonly candidates: readonly MusicalCutCandidate[];
	readonly sectionSeconds: readonly number[];
	readonly beatSeconds: number | null;
	readonly waveform?: MusicalCutWaveform;
	readonly search?: Readonly<{ points: number; pairs: number; distances: number; workers: number; deep: boolean }>;
	readonly phrases?: Readonly<{
		confidence: number; beatConfidence: number; meter: number | null; meterConfidence: number;
		boundaries: readonly Readonly<{ seconds: number; strength: number }>[];
	}>;
}

/** Synchronous reference entry; browser orchestration can partition the same search plan. */
export function analyzeMusicalCuts(request: MusicalCutRequest): MusicalCutReport {
	const plan = prepareMusicalCutSearch(request);
	return finishMusicalCutSearch(plan, [searchMusicalCutPlan(plan)], 1);
}

/** FFT/features run once; workers receive this compact representation, never copies of track PCM. */
export function prepareMusicalCutSearch(request: MusicalCutRequest): MusicalCutSearchPlan {
	validate(request);
	const duration = request.channels[0].length / request.sampleRate;
	const waveform = musicalCutWaveform(request.channels, request.sampleRate);
	const tolerance = request.toleranceSeconds ?? 5;
	const features = duration < 5 || (request.removeSeconds ?? 0) - tolerance > duration - 2 ? []
		: musicalCutFeatures(request.channels, request.sampleRate);
	const peak = Math.max(0, ...features.map(frame => frame.energy));
	const frames = peak < 1e-5 ? [] : features;
	const beat = frames.length ? beatPeriod(frames) : null;
	const phrases = request.respectPhrases ? analyzeMusicalPhrases(frames, beat) : undefined;
	const sections = frames.length ? sectionBoundaries(frames) : [];
	const context = Math.max(20, Math.round((beat ? beat * 4 : 2) / hop));
	const margin = Math.max(context, 20);
	const anchors: number[] = [], dense: number[] = [];
	for (let i = margin; i < frames.length - margin; i++) {
		if (frames[i].energy < peak * 0.02) continue;
		const onset = frames[i].onset > 0 && frames[i].onset >= frames[i - 1].onset && frames[i].onset > frames[i + 1].onset;
		if (onset || i % 10 === 0) anchors.push(i);
		if (request.deepSearch) dense.push(i);
	}
	const stride = Math.max(1, Math.ceil(anchors.length / 900));
	const structural = phrases?.confidence && phrases.confidence >= 0.2 ? phrases.boundaries.map(point => point.frame)
		.filter(i => i >= margin && i < frames.length - margin && frames[i].energy >= peak * 0.02) : [];
	const sparse = [...new Set([...structural, ...sample(anchors.filter((_, index) => index % stride === 0), 900 - structural.length)])].sort((a, b) => a - b);
	const points = request.deepSearch ? [...new Set([...sparse, ...sample(dense, 6000 - sparse.length)])].sort((a, b) => a - b) : sparse;
	// Float64 retains the existing normalized features and precomputed log-level precision.
	const packed = new Float64Array(frames.length * 19);
	frames.forEach((frame, i) => { packed.set(frame.chroma, i * 19); packed.set(frame.bands, i * 19 + 12); packed[i * 19 + 18] = Math.log(frame.energy + 1e-8); });
	return { packed, points, sections, context, beat, tolerance, target: request.removeSeconds, minimumLogEnergy: Math.log(peak * 0.02 + 1e-8), deep: request.deepSearch === true, waveform, phrases };
}
function sample(values: readonly number[], maximum: number): number[] {
	if (values.length <= maximum) return [...values];
	return Array.from({ length: maximum }, (_, i) => values[Math.floor(i * values.length / maximum)]);
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
