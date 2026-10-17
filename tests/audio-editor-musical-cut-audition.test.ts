/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMusicalCutAudition } from '../src/common/editor/controller/analysis/musical-cut-audition.ts';

function audioHost() {
	const events: string[] = [];
	const sources: { onended: (() => void) | null; buffer: unknown; stop(): void; disconnect(): void }[] = [];
	const planes: Float32Array[][] = [];
	const context = {
		state: 'running', destination: {},
		resume: async () => { events.push('resume'); },
		close: async () => { events.push('close'); },
		createBuffer(channels: number, frames: number) {
			const data = Array.from({ length: channels }, () => new Float32Array(frames)); planes.push(data);
			return { copyToChannel: (plane: Float32Array, index: number) => data[index].set(plane) };
		},
		createBufferSource() {
			const source = { onended: null as (() => void) | null, buffer: null as unknown,
				connect: () => { events.push('connect'); }, start: () => { events.push('start'); },
				stop: () => { events.push('stop'); }, disconnect: () => { events.push('disconnect'); } };
			sources.push(source); return source;
		},
	};
	return { context: context as unknown as AudioContext, events, sources, planes };
}
test('tap unlock precedes playback, a new preview stops the previous audio, closing releases the context once', async () => {
	const host = audioHost();
	let ended = 0;
	const player = createMusicalCutAudition({ createContext: () => host.context, onEnded: () => { ended++; } });
	const unlock = player.unlock();
	assert.deepEqual(host.events, ['resume']);
	await unlock;
	const channels = [new Float32Array([0.1, -0.1]), new Float32Array([0.2, -0.2])];
	player.play({ channels, sampleRate: 48000, joinSeconds: 0 });
	assert.deepEqual(host.planes[0], channels);
	player.play({ channels, sampleRate: 48000, joinSeconds: 0 });
	assert.equal(host.sources[0].onended, null);
	assert.equal(host.events.filter(event => event === 'stop').length, 1);
	player.dispose(); player.dispose();
	assert.equal(host.events.filter(event => event === 'stop').length, 2);
	assert.equal(host.events.filter(event => event === 'close').length, 1);
	assert.equal(ended, 0);
	await assert.rejects(player.unlock(), { name: 'AbortError' });
});
test('natural end releases the source, while closing before first playback creates no context', async () => {
	const host = audioHost(); let ended = 0;
	const player = createMusicalCutAudition({ createContext: () => host.context, onEnded: () => { ended++; } });
	await player.unlock(); player.play({ channels: [new Float32Array(10)], sampleRate: 48000, joinSeconds: 0 });
	host.sources[0].onended?.(); player.stop(); player.dispose();
	assert.equal(ended, 1);
	assert.equal(host.events.filter(event => event === 'stop').length, 0);
	const unopened = createMusicalCutAudition({ createContext: () => assert.fail('unneeded context'), onEnded: () => undefined });
	unopened.dispose(); unopened.dispose();
});
