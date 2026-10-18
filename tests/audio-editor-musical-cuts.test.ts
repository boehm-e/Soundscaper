/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeMusicalCuts } from '../src/common/editor/musical-cut-analysis.ts';

const rate = 8_000;
function music(seconds = 24, inverted = false) {
	return Float32Array.from({ length: seconds * rate }, (_, i) => {
		const t = i / rate;
		const note = [220, 277.18, 329.63, 277.18][Math.floor(t * 2) % 4];
		const phase = t % 0.5;
		return (inverted ? -1 : 1) * (0.1 + 0.4 * Math.exp(-phase * 18))
			* (Math.sin(2 * Math.PI * note * t) + 0.3 * Math.sin(4 * Math.PI * note * t));
	});
}
test('finds repeated musical sequences at the requested duration, with room to audition both sides', () => {
	const result = analyzeMusicalCuts({ channels: [music()], sampleRate: rate, removeSeconds: 8, toleranceSeconds: 0.32 });
	assert.ok(result.candidates.length > 0);
	assert.equal(result.waveform?.durationSeconds, 24);
	for (const cut of result.candidates) {
		assert.ok(Math.abs(cut.endSeconds - cut.startSeconds - 8) < 0.35);
		assert.ok(cut.startSeconds >= 1 && cut.endSeconds <= 23);
		assert.ok(Number.isFinite(cut.cost));
	}
});
test('stereo polarity does not cancel the musical analysis', () => {
	assert.ok(analyzeMusicalCuts({ channels: [music(), music(24, true)], sampleRate: rate }).candidates.length > 0);
});
test('matching isolated tones cannot override incompatible surrounding musical phrases', () => {
	assert.deepEqual(analyzeMusicalCuts({ channels: [music()], sampleRate: rate, removeSeconds: 3, toleranceSeconds: 0.2 }).candidates, []);
});
test('silence, very short audio and impossible target durations return no fabricated matches', () => {
	for (const channels of [[new Float32Array(rate * 10)], [music(2)]]) {
		assert.deepEqual(analyzeMusicalCuts({ channels, sampleRate: rate }).candidates, []);
	}
	assert.deepEqual(analyzeMusicalCuts({ channels: [music()], sampleRate: rate, removeSeconds: 40 }).candidates, []);
});
test('rejects malformed or excessive input before allocating feature matrices', () => {
	assert.throws(() => analyzeMusicalCuts({ channels: [], sampleRate: rate }), /audio/i);
	assert.throws(() => analyzeMusicalCuts({ channels: [music()], sampleRate: NaN }), /rate/i);
	assert.throws(() => analyzeMusicalCuts({ channels: [music()], sampleRate: rate, removeSeconds: -1 }), /duration/i);
});

test('a flexible duration recovers musical transitions that a narrow target excludes', () => {
	const narrow = analyzeMusicalCuts({ channels: [music()], sampleRate: rate, removeSeconds: 3, toleranceSeconds: 0.2 });
	const flexible = analyzeMusicalCuts({ channels: [music()], sampleRate: rate, removeSeconds: 3, toleranceSeconds: 1.1 });
	assert.equal(narrow.candidates.length, 0);
	assert.ok(flexible.candidates.length > 0);
	for (const cut of flexible.candidates) {
	 assert.ok(Math.abs(cut.endSeconds - cut.startSeconds - 3) <= 1.1 + 1e-8);
	 assert.ok(cut.musicScore >= 0 && cut.musicScore <= 100);
	 assert.ok(cut.durationScore !== null && cut.durationScore >= 0 && cut.durationScore <= 100);
	}
	assert.throws(() => analyzeMusicalCuts({ channels: [music()], sampleRate: rate, toleranceSeconds: -1 }), /tolerance/);
	assert.throws(() => analyzeMusicalCuts({ channels: [music()], sampleRate: rate, toleranceSeconds: Infinity }), /tolerance/);
});
