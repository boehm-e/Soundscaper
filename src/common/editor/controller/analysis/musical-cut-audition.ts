/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MusicalCutPreview } from './musical-cuts-session.ts';

interface AuditionOptions {
	readonly createContext: () => AudioContext;
	readonly onEnded: () => void;
}

/** Call unlock directly from the user's tap, before waiting for the offline preview render. */
export function createMusicalCutAudition({ createContext, onEnded }: AuditionOptions) {
	let context: AudioContext | null = null;
	let source: AudioBufferSourceNode | null = null;
	let disposed = false;
	let startedAt = 0;
	return Object.freeze({ unlock, play, stop, dispose, positionSeconds });
	function positionSeconds(): number { return source && context ? Math.max(0, context.currentTime - startedAt) : 0; }
	async function unlock(): Promise<void> {
		if (disposed) throw new DOMException('Audition closed.', 'AbortError');
		context ??= createContext();
		await context.resume();
	}
	function play(preview: MusicalCutPreview): void {
		if (disposed || !context) throw new DOMException('Audition closed.', 'AbortError');
		stop();
		const buffer = context.createBuffer(preview.channels.length, preview.channels[0].length, preview.sampleRate);
		preview.channels.forEach((channel, index) => buffer.copyToChannel(new Float32Array(channel), index));
		const next = context.createBufferSource();
		next.buffer = buffer;
		next.connect(context.destination);
		next.onended = () => {
			if (source !== next) return;
			next.disconnect(); source = null; onEnded();
		};
		source = next;
		startedAt = context.currentTime;
		next.start();
	}
	function stop(): void {
		if (!source) return;
		const previous = source; source = null;
		previous.onended = null; previous.stop(); previous.disconnect();
	}
	function dispose(): void {
		if (disposed) return;
		disposed = true; stop();
		const previous = context; context = null;
		if (previous && previous.state !== 'closed') void previous.close().catch(() => undefined);
	}
}
