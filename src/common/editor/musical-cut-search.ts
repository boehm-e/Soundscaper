/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MusicalCutCandidate, MusicalCutReport } from './musical-cut-analysis.ts';
import type { MusicalCutWaveform } from './musical-cut-waveform.ts';
import { MUSICAL_CUT_HOP_SECONDS as hop } from './musical-cut-features.ts';
import { musicalCutScores, shortlistMusicalCuts, selectMusicalCuts } from './musical-cut-ranking.ts';
import { musicalPhrasePairScore, type MusicalPhraseAnalysis } from './musical-cut-phrases.ts';

export interface MusicalCutSearchPlan {
	readonly packed: Float64Array;
	readonly points: readonly number[];
	readonly sections: readonly number[];
	readonly context: number;
	readonly beat: number | null;
	readonly target?: number;
	readonly tolerance: number;
	readonly deep: boolean;
	readonly minimumLogEnergy: number;
	readonly waveform: MusicalCutWaveform;
	readonly phrases?: MusicalPhraseAnalysis;
}
export interface MusicalCutSearchBatch {
	readonly candidates: readonly MusicalCutCandidate[];
	readonly pairs: number;
	readonly distances: number;
}

/** Precomputed log-level avoids a logarithm for every frame comparison. */
export function musicalCutPackedDistance(packed: Float64Array, a: number, b: number): number {
	const left = a * 19, right = b * 19;
	let chroma = 0, bands = 0;
	for (let k = 0; k < 12; k++) chroma += packed[left + k] * packed[right + k];
	for (let k = 12; k < 18; k++) bands += packed[left + k] * packed[right + k];
	return 0.6 * Math.max(0, 1 - chroma) + 0.25 * Math.max(0, 1 - bands)
		+ 0.15 * Math.min(1, Math.abs(packed[left + 18] - packed[right + 18]) / 2);
}

/** Four rolling diagonals preserve the existing stride-four sequence comparison exactly.
 * A frame pair is evaluated at most once per diagonal, without an N² matrix. */
export function createMusicalCutContextDistance(distance: (a: number, b: number) => number, lag: number, context: number) {
	const count = Math.ceil(context * 2 / 4);
	const states: ({ first: number; head: number; sum: number; values: Float64Array } | undefined)[] = [];
	return (point: number): number => {
		const first = point - context, residue = first % 4;
		let state = states[residue];
		if (!state || first < state.first || first >= state.first + count * 4) {
			state = { first, head: 0, sum: 0, values: new Float64Array(count) };
			for (let k = 0; k < count; k++) { const frame = first + k * 4; state.values[k] = distance(frame, frame + lag); state.sum += state.values[k]; }
			states[residue] = state;
		} else while (state.first < first) {
			const next = state.first + count * 4;
			const value = distance(next, next + lag);
			state.sum += value - state.values[state.head]; state.values[state.head] = value;
			state.first += 4; state.head = (state.head + 1) % count;
		}
		return state.sum / count;
	};
}

function rhythmAt(plan: MusicalCutSearchPlan, lag: number): number {
	// Local beat positions replace a single global-period gate when phrasing has reliable evidence.
	if (plan.phrases && plan.phrases.confidence >= 0.2) return 0;
	return plan.beat ? Math.abs(lag * hop / plan.beat - Math.round(lag * hop / plan.beat)) : 0;
}
function durationAllowed(plan: MusicalCutSearchPlan, lag: number): boolean {
	return lag * hop >= Math.max(1, (plan.beat ?? 0.5) * 2) - 1e-8
		&& (plan.target === undefined || Math.abs(lag * hop - plan.target) <= plan.tolerance + 1e-8);
}
function candidateAt(plan: MusicalCutSearchPlan, i: number, j: number, distance: number, rhythm: number): MusicalCutCandidate | null {
	if (distance > 0.22) return null;
	const nearSection = plan.sections.some(section => Math.abs(section - i) < 20 || Math.abs(section - j) < 20);
	const phraseScore = plan.phrases ? musicalPhrasePairScore(plan.phrases, i, j) : undefined;
	const phrasePenalty = phraseScore === null || phraseScore === undefined ? 0 : (plan.phrases?.confidence ?? 0) * 0.16 * (1 - phraseScore / 100);
	// Rolling arithmetic can differ in its last bits between worker partitions and point densities.
	const cost = Math.round((distance + rhythm * 0.15 + (nearSection ? 0 : 0.025) + phrasePenalty) * 1e12) / 1e12;
	return { startSeconds: i * hop, endSeconds: j * hop, cost, matchingSeconds: plan.context * 2 * hop, nearSection,
		...musicalCutScores(cost, (j - i) * hop, plan.target, plan.tolerance), ...(plan.phrases ? { phraseScore } : {}) };
}
function bound(candidates: MusicalCutCandidate[]): void {
	if (candidates.length >= 2048) candidates.splice(0, candidates.length, ...shortlistMusicalCuts(candidates, 256));
}

/** Small constrained searches finish in their preparation worker, avoiding worker/copy overhead. */
export function musicalCutParallelSearchUseful(plan: MusicalCutSearchPlan): boolean {
	const extent = (plan.points.at(-1) ?? 0) - (plan.points[0] ?? 0);
	const span = plan.target === undefined ? extent : Math.min(extent, 2 * plan.tolerance / hop + 1);
	return plan.points.length * span > 3_000_000;
}

/** Partition by eligible lag, interleaving long and short diagonals across workers. */
export function searchMusicalCutPlan(plan: MusicalCutSearchPlan, lane = 0, lanes = 1): MusicalCutSearchBatch {
	if (!Number.isInteger(lane) || !Number.isInteger(lanes) || lanes < 1 || lanes > 2 || lane < 0 || lane >= lanes) throw new RangeError('Invalid musical search partition.');
	const frames = plan.packed.length / 19, flags = new Uint8Array(frames);
	for (const point of plan.points) flags[point] = 1;
	const candidates: MusicalCutCandidate[] = [];
	let pairs = 0, distances = 0, ordinal = 0;
	const distance = (a: number, b: number) => { distances++; return musicalCutPackedDistance(plan.packed, a, b); };
	const minimum = Math.max(1, Math.ceil(Math.max(Math.max(1, (plan.beat ?? 0.5) * 2), (plan.target ?? 0) - plan.tolerance) / hop - 1e-8));
	const maximum = Math.min((plan.points.at(-1) ?? 0) - (plan.points[0] ?? 0),
		plan.target === undefined ? frames : Math.floor((plan.target + plan.tolerance) / hop + 1e-8));
	for (let lag = minimum; lag <= maximum; lag++) {
		const rhythm = rhythmAt(plan, lag);
		if (!durationAllowed(plan, lag) || (plan.beat && rhythm > 0.18)) continue;
		if (ordinal++ % lanes !== lane) continue;
		let contextDistance: ReturnType<typeof createMusicalCutContextDistance> | undefined;
		for (const i of plan.points) {
			const j = i + lag;
			if (j >= frames - plan.context) break;
			if (!flags[j]) continue;
			pairs++;
			if (distance(i, j) > 0.3) continue;
			contextDistance ??= createMusicalCutContextDistance(distance, lag, plan.context);
			const candidate = candidateAt(plan, i, j, contextDistance(i), rhythm);
			if (candidate) { candidates.push(candidate); bound(candidates); }
		}
	}
	return { candidates: shortlistMusicalCuts(candidates, 256), pairs, distances };
}

/** Refine only promising endpoints at the native 50 ms feature resolution. */
export function finishMusicalCutSearch(plan: MusicalCutSearchPlan, batches: readonly MusicalCutSearchBatch[], workers: number): MusicalCutReport {
	const candidates = shortlistMusicalCuts(batches.flatMap(batch => batch.candidates), 256);
	let pairs = batches.reduce((sum, batch) => sum + batch.pairs, 0), distances = batches.reduce((sum, batch) => sum + batch.distances, 0);
	const distance = (a: number, b: number) => { distances++; return musicalCutPackedDistance(plan.packed, a, b); };
	if (plan.deep) {
		const seen = new Set(candidates.map(cut => `${Math.round(cut.startSeconds / hop)}:${Math.round(cut.endSeconds / hop)}`));
		for (const seed of selectMusicalCuts(candidates)) for (let a = -5; a <= 5; a++) for (let b = -5; b <= 5; b++) {
			const i = Math.round(seed.startSeconds / hop) + a, j = Math.round(seed.endSeconds / hop) + b, key = `${i}:${j}`;
			if (i < plan.context || j >= plan.packed.length / 19 - plan.context || seen.has(key) || !durationAllowed(plan, j - i)) continue;
			seen.add(key); const rhythm = rhythmAt(plan, j - i);
			if ((plan.beat && rhythm > 0.18) || plan.packed[i * 19 + 18] < plan.minimumLogEnergy || plan.packed[j * 19 + 18] < plan.minimumLogEnergy) continue;
			pairs++; if (distance(i, j) > 0.3) continue;
			let mean = 0;
			for (let k = -plan.context; k < plan.context; k += 4) mean += distance(i + k, j + k);
			const candidate = candidateAt(plan, i, j, mean / Math.ceil(plan.context * 2 / 4), rhythm);
			if (candidate) { candidates.push(candidate); bound(candidates); }
		}
	}
	return { candidates: selectMusicalCuts(candidates), sectionSeconds: plan.sections.map(i => i * hop), beatSeconds: plan.beat, waveform: plan.waveform,
		search: { points: plan.points.length, pairs, distances, workers, deep: plan.deep },
		...(plan.phrases ? { phrases: { confidence: plan.phrases.confidence, beatConfidence: plan.phrases.beatConfidence,
			meter: plan.phrases.meter, meterConfidence: plan.phrases.meterConfidence,
			boundaries: plan.phrases.boundaries.map(point => ({ seconds: point.frame * hop, strength: point.strength })) } } : {}) };
}
