/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MusicalCutRequest, MusicalCutReport } from './musical-cut-analysis.ts';
import type { MusicalCutSearchPlan, MusicalCutSearchBatch } from './musical-cut-search.ts';

export type MusicalCutWorkerTask =
	| Readonly<{ task: 'full'; request: MusicalCutRequest }>
	| Readonly<{ task: 'prepare'; request: MusicalCutRequest; parallelism: number }>
	| Readonly<{ task: 'search'; plan: MusicalCutSearchPlan; lane: number; lanes: number }>
	| Readonly<{ task: 'finish'; plan: MusicalCutSearchPlan; batches: readonly MusicalCutSearchBatch[]; workers: number }>;

export type MusicalCutPreparation = Readonly<{ kind: 'parallel'; plan: MusicalCutSearchPlan }>
	| Readonly<{ kind: 'complete'; report: MusicalCutReport }>;
