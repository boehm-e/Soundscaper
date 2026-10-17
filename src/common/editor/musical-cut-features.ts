/* SPDX-License-Identifier: AGPL-3.0-only */
import { calculateAudioSpectrum } from './audio-spectrum.ts';

export const MUSICAL_CUT_RATE = 8_000;
export const MUSICAL_CUT_MAX_SECONDS = 600;
export const MUSICAL_CUT_HOP_SECONDS = 0.05;
export interface MusicalFrame {
	readonly chroma: Float32Array;
	readonly bands: Float32Array;
	readonly energy: number;
	readonly onset: number;
}

/** Powers are accumulated across channels by the shared FFT, never summed as waveforms. */
export function musicalCutFeatures(channels: readonly Float32Array[], sampleRate: number): MusicalFrame[] {
	const frames: MusicalFrame[] = [];
	const hop = Math.round(sampleRate * MUSICAL_CUT_HOP_SECONDS);
	let previous = new Float32Array(6);
	for (let offset = 0; offset + 2048 <= channels[0].length; offset += hop) {
		const spectrum = calculateAudioSpectrum(channels, sampleRate, { size: 2048, offsetFrame: offset });
		const chroma = new Float32Array(12);
		const bands = new Float32Array(6);
		let energy = 0;
		for (const bin of spectrum.bins) {
			if (bin.frequency < 60 || bin.frequency > 3600) continue;
			const power = bin.amplitude ** 2;
			energy += power;
			const band = Math.min(5, Math.max(0, Math.floor(Math.log2(bin.frequency / 60))));
			bands[band] += power;
			const pitch = Math.round(69 + 12 * Math.log2(bin.frequency / 440));
			chroma[((pitch % 12) + 12) % 12] += power;
		}
		let onset = 0;
		for (let i = 0; i < bands.length; i++) {
			bands[i] = Math.sqrt(bands[i]);
			onset += Math.max(0, bands[i] - previous[i]);
		}
		previous = bands.slice();
		normalize(bands);
		for (let i = 0; i < chroma.length; i++) chroma[i] = Math.sqrt(chroma[i]);
		normalize(chroma);
		frames.push({ chroma, bands, energy: Math.sqrt(energy), onset });
	}
	return frames;
}

function normalize(vector: Float32Array): void {
	const norm = Math.hypot(...vector);
	if (norm > 0) for (let i = 0; i < vector.length; i++) vector[i] /= norm;
}

export function musicalFrameDistance(a: MusicalFrame, b: MusicalFrame): number {
	let chroma = 0, bands = 0;
	for (let i = 0; i < 12; i++) chroma += a.chroma[i] * b.chroma[i];
	for (let i = 0; i < 6; i++) bands += a.bands[i] * b.bands[i];
	const level = Math.min(1, Math.abs(Math.log((a.energy + 1e-8) / (b.energy + 1e-8))) / 2);
	return 0.6 * Math.max(0, 1 - chroma) + 0.25 * Math.max(0, 1 - bands) + 0.15 * level;
}
