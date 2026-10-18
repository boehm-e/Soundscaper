/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeMusicalPhrases, musicalPhrasePairScore } from '../src/common/editor/musical-cut-phrases.ts';
import type { MusicalFrame } from '../src/common/editor/musical-cut-features.ts';

/** A pickup, accented measures and repeating four-measure harmonic phrases. */
function fixture(meter = 4, drifting = false, count = 160) {
	const beats: number[] = [], frames: MusicalFrame[] = [];
	let next = 7;
	for (let beat = 0; beat < count; beat++) { beats.push(Math.round(next)); next += drifting ? 9 + beat / count : 10; }
	let beat = -1;
	for (let i = 0; i <= next; i++) {
		if (i >= (beats[beat + 1] ?? Infinity)) beat++;
		const position = Math.max(0, beat), note = Math.floor(position / meter) % 4;
		frames.push({ chroma: Float32Array.from({ length: 12 }, (_, k) => k === note ? 1 : 0),
			bands: Float32Array.from([1, 0, 0, 0, 0, 0]), energy: 0.5,
			onset: i === beats[beat] ? (beat % meter === 0 ? 1 : 0.35) : 0 });
	}
	return { frames, beats };
}

test('tracks beat positions with a pickup, infers triple/quadruple accents and tolerates gradual tempo drift', () => {
	for (const meter of [3, 4]) for (const drifting of [false, true]) {
		const input = fixture(meter, drifting), result = analyzeMusicalPhrases(input.frames, 0.5);
		assert.ok(result.beatConfidence > 0.5);
		assert.equal(result.meter, meter);
		const matched = input.beats.slice(4, -4).filter(beat => result.beats.some(point => Math.abs(point - beat) <= 1));
		assert.ok(matched.length / (input.beats.length - 8) > 0.9);
	}
});

test('repeated phrases produce boundaries and favor matching phrase positions over a mid-phrase splice', () => {
	const input = fixture(), result = analyzeMusicalPhrases(input.frames, 0.5);
	const boundary = input.beats[32], next = input.beats[48];
	assert.ok(result.boundaries.some(point => Math.abs(point.frame - boundary) <= 1));
	const aligned = musicalPhrasePairScore(result, boundary, next);
	const interrupted = musicalPhrasePairScore(result, boundary + 20, next);
	assert.ok(aligned !== null && interrupted !== null && aligned > interrupted + 10, `${aligned} versus ${interrupted}`);
	assert.ok(result.boundaries.length <= 96);
});

test('silence and a stationary texture do not invent beat, measure or phrase certainty', () => {
	const frames = fixture().frames.map(frame => ({ ...frame, onset: 0 }));
	for (const source of [[], frames.map(frame => ({ ...frame, chroma: frames[0].chroma }))]) {
		const result = analyzeMusicalPhrases(source, null);
		assert.equal(result.meter, null);
		assert.equal(result.beatConfidence, 0);
		assert.equal(result.boundaries.length, 0);
		assert.equal(musicalPhrasePairScore(result, 10, 20), null);
	}
});

test('uniform accents cannot assert a time signature, and all pair scores are finite bounded indices', () => {
	const input = fixture(), frames = input.frames.map(frame => ({ ...frame, onset: frame.onset > 0 ? 1 : 0 }));
	const result = analyzeMusicalPhrases(frames, 0.5);
	assert.equal(result.meter, null);
	for (let i = 40; i < 300; i += 13) {
		const score = musicalPhrasePairScore(result, i, i + 160);
		assert.ok(score === null || Number.isFinite(score) && score >= 0 && score <= 100);
	}
});

test('bounded phrase markers retain coverage near both ends of a long track', () => {
	const input = fixture(4, false, 1200), result = analyzeMusicalPhrases(input.frames, 0.5);
	assert.ok(result.boundaries.length <= 96);
	assert.ok(result.boundaries.some(point => point.frame < input.frames.length * 0.1));
	assert.ok(result.boundaries.some(point => point.frame > input.frames.length * 0.9));
});

test('the wider context distinguishes reversed bar order even when averaged harmony is identical', () => {
	const input = fixture(), baseline = analyzeMusicalPhrases(input.frames, 0.5);
	const altered = input.frames.map((frame, i) => i >= input.beats[56] && i < input.beats[64]
		? { ...frame, chroma: Float32Array.from({ length: 12 }, (_, k) => k === (i < input.beats[60] ? 3 : 2) ? 1 : 0) } : frame);
	const reversed = analyzeMusicalPhrases(altered, 0.5);
	// Equal boundary support isolates the order of the context, rather than novelty or meter.
	const equalSupport = new Float32Array(input.frames.length).fill(1);
	const good = musicalPhrasePairScore({ ...baseline, support: equalSupport }, input.beats[32], input.beats[64]);
	const bad = musicalPhrasePairScore({ ...reversed, support: equalSupport }, input.beats[32], input.beats[64]);
	assert.ok(good !== null && bad !== null && good > bad + 10, `${good} versus ${bad}`);
});
