/* SPDX-License-Identifier: AGPL-3.0-only */
export interface MusicalCutResultWindow {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly sampleRate: number;
	readonly channels: readonly { readonly minimum: Float32Array; readonly maximum: Float32Array; readonly rms: Float32Array }[];
	readonly pcm?: readonly Float32Array[];
}

/** Exact rendered min/max/RMS without retaining an entire long track's PCM. */
export function createMusicalCutResultWindow(startFrame: number, endFrame: number, sampleRate: number, columns: number) {
	if (![startFrame, endFrame, columns].every(Number.isSafeInteger) || startFrame < 0 || endFrame <= startFrame
		|| columns < 1 || columns > 4096 || !Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('Invalid result window.');
	const length = endFrame - startFrame;
	const count = Math.min(length, columns);
	const channels: { minimum: Float32Array; maximum: Float32Array; rms: Float32Array }[] = [];
	const squares: Float64Array[] = [];
	const pcm: Float32Array[] | undefined = length <= columns * 2 ? [] : undefined;
	let written = 0;
	return { append, finish };
	function append(planes: readonly Float32Array[]): void {
		const frames = planes[0]?.length ?? 0;
		if (!planes.length || planes.some(plane => plane.length !== frames) || written + frames > length
			|| (written && planes.length !== channels.length)) throw new RangeError('Invalid rendered channels.');
		if (!channels.length) for (let ch = 0; ch < planes.length; ch++) {
			channels.push({ minimum: new Float32Array(count).fill(Infinity), maximum: new Float32Array(count).fill(-Infinity), rms: new Float32Array(count) });
			squares.push(new Float64Array(count)); pcm?.push(new Float32Array(length));
		}
		planes.forEach((plane, ch) => {
			pcm?.[ch].set(plane, written);
			const output = channels[ch];
			const first = Math.floor(written * count / length), last = Math.ceil((written + frames) * count / length);
			for (let bin = first; bin < last; bin++) {
				const from = Math.max(0, Math.ceil(bin * length / count) - written);
				const to = Math.min(frames, Math.ceil((bin + 1) * length / count) - written);
				for (let i = from; i < to; i++) {
					const value = plane[i];
					output.minimum[bin] = Math.min(output.minimum[bin], value);
					output.maximum[bin] = Math.max(output.maximum[bin], value);
					squares[ch][bin] += value * value;
				}
			}
		});
		written += frames;
	}
	function finish(): MusicalCutResultWindow {
		if (written !== length) throw new RangeError('Incomplete rendered window.');
		channels.forEach((channel, ch) => {
			for (let bin = 0; bin < count; bin++) {
				const samples = Math.ceil((bin + 1) * length / count) - Math.ceil(bin * length / count);
				channel.rms[bin] = Math.sqrt(squares[ch][bin] / samples);
			}
		});
		return { startFrame, endFrame, sampleRate, channels, ...(pcm ? { pcm } : {}) };
	}
}
