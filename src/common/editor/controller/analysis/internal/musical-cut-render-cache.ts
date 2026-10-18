/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MusicalCutResultWindow } from '../../../musical-cut-result-window.ts';

interface Chunk { readonly channels: readonly Float32Array[]; readonly startFrame: number; readonly endFrame: number }

function boundedCache<T>(maximumBytes: number, maximumEntries: number, size: (value: T) => number) {
	const entries = new Map<string, { value: T; bytes: number }>();
	let bytes = 0;
	return { get, set, clear };
	function get(key: string): T | undefined {
		const entry = entries.get(key);
		if (!entry) return undefined;
		entries.delete(key); entries.set(key, entry); return entry.value;
	}
	function set(key: string, value: T): void {
		const previous = entries.get(key);
		if (previous) { bytes -= previous.bytes; entries.delete(key); }
		const weight = size(value);
		if (weight > maximumBytes) return;
		entries.set(key, { value, bytes: weight }); bytes += weight;
		while (bytes > maximumBytes || entries.size > maximumEntries) {
			const first = entries.entries().next().value;
			if (!first) break;
			bytes -= first[1].bytes; entries.delete(first[0]);
		}
	}
	function clear(): void { entries.clear(); bytes = 0; }
}

/** Dialog-local LRU: retain small finished overviews separately from full-rate PCM. */
export function createMusicalCutRenderCache(chunkBytes = 24 * 1024 * 1024, windowBytes = 4 * 1024 * 1024) {
	const planesSize = (planes: readonly Float32Array[]) => planes.reduce((sum, plane) => sum + plane.byteLength, 0);
	const chunks = boundedCache<Chunk>(chunkBytes, 64, value => planesSize(value.channels));
	const windows = boundedCache<MusicalCutResultWindow>(windowBytes, 128, value => planesSize(value.pcm ?? [])
		+ value.channels.reduce((sum, ch) => sum + ch.minimum.byteLength + ch.maximum.byteLength + ch.rms.byteLength, 0));
	return { chunks, windows, clear: () => { chunks.clear(); windows.clear(); } };
}
