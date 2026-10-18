/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MusicalCutCandidate } from './musical-cut-analysis.ts';

export type MusicalCutSort = 'music' | 'duration' | 'average';
const sorts: readonly MusicalCutSort[] = ['music', 'duration', 'average'];
const clamp = (value: number) => Math.max(0, Math.min(100, value));

/** Fixed heuristic indices, not probabilities. Duration never changes musical compatibility. */
export function musicalCutScores(cost: number, removed: number, target: number | undefined, tolerance: number) {
	const error = target === undefined ? 0 : Math.abs(removed - target);
	return { musicScore: clamp(100 * (1 - cost)), durationScore: target === undefined ? null
		: tolerance === 0 ? (error <= 1e-8 ? 100 : 0) : clamp(100 - 20 * (error / tolerance) ** 2) };
}

export function musicalCutRank(candidate: MusicalCutCandidate, sort: MusicalCutSort): number {
	if (candidate.durationScore === null || sort === 'music') return candidate.musicScore;
	return sort === 'duration' ? candidate.durationScore : (candidate.musicScore + candidate.durationScore) / 2;
}

export function sortMusicalCuts(candidates: readonly MusicalCutCandidate[], sort: MusicalCutSort): MusicalCutCandidate[] {
	return [...candidates].sort((a, b) => musicalCutRank(b, sort) - musicalCutRank(a, sort)
		|| b.musicScore - a.musicScore || (b.durationScore ?? 0) - (a.durationScore ?? 0)
		|| a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds);
}

/** Retain contenders for every UI sort, including during bounded intermediate pruning. */
export function shortlistMusicalCuts(candidates: readonly MusicalCutCandidate[], count: number): MusicalCutCandidate[] {
	return [...new Set(sorts.flatMap(sort => sortMusicalCuts(candidates, sort).slice(0, count)))];
}

export function selectMusicalCuts(candidates: readonly MusicalCutCandidate[]): MusicalCutCandidate[] {
	const retained = sorts.flatMap(sort => {
		const selected: MusicalCutCandidate[] = [];
		for (const candidate of sortMusicalCuts(candidates, sort)) {
			if (selected.some(other => Math.abs(other.startSeconds - candidate.startSeconds) < 1.5
				&& Math.abs(other.endSeconds - candidate.endSeconds) < 1.5)) continue;
			selected.push(candidate); if (selected.length === 12) break;
		}
		return selected;
	});
	return sortMusicalCuts([...new Set(retained)], 'music');
}
