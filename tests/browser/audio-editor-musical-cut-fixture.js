/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture } from './audio-editor-test-fixtures.js';

export function musicalCutFixture(duration = 24, { phrased = false } = {}) {
	const sampleRate = 48_000;
	const fixture = createWavFixture({ name: 'repeating-music.wav', frequency: 220, duration, channelCount: 1 });
	for (let i = 0; i < duration * sampleRate; i++) {
		const t = i / sampleRate;
		const beat = Math.floor(t * 2);
		const note = (phrased ? [220, 277.18, 329.63, 246.94] : [220, 277.18, 329.63, 277.18])[Math.floor(beat / (phrased ? 4 : 1)) % 4];
		const accent = phrased ? (beat % 4 === 0 ? 0.5 : 0.2) : 0.4;
		const value = (0.1 + accent * Math.exp(-(t % 0.5) * 18))
			* (Math.sin(2 * Math.PI * note * t) + 0.3 * Math.sin(4 * Math.PI * note * t));
		fixture.buffer.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
	}
	return fixture;
}
