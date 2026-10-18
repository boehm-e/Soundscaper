/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMusicalCutTransport, type MusicalCutPlaybackEngine } from '../src/common/editor/controller/analysis/musical-cut-transport.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
const cut = { startSeconds: 6, endSeconds: 14, cost: 0, musicScore: 100, durationScore: null, matchingSeconds: 4, nearSection: false };
function host(gate?: Promise<void>) {
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const events: string[] = [], original = {}, edited = {};
	let stale = false, frame = 0;
	let listener: (frame: number) => void = () => undefined;
	let state: (value: string) => void = () => undefined;
	const engine = {
		getAudioContext: async () => { events.push('unlock'); return {}; },
		loadProject: () => engine, setSourceResolver: () => engine,
		play: async () => { events.push('play'); state('playing'); },
		pause: () => { events.push('pause'); state('paused'); },
		stop: () => { events.push('stop'); frame = 0; listener(frame); state('stopped'); },
		seek: (value: number) => { frame = value; listener(frame); return frame; },
		setLoop: () => undefined, setPlayRange: () => undefined,
		subscribePosition: (value: (frame: number) => void) => { listener = value; return () => { listener = () => undefined; }; },
		dispose: async () => { events.push('dispose'); },
	};
	const transport = createMusicalCutTransport({ lifetime,
		assertCurrent: () => { if (stale) throw new DOMException('Stale project', 'AbortError'); },
		resolve: request => ({ project: request.original ? original : edited, identity: request.original ? original : edited, endFrame: request.original ? 3000 : 2200 }),
		resources: {
			createEngine: options => { state = options.onState; return engine as unknown as MusicalCutPlaybackEngine; },
			loadProject: (_, project) => { events.push(project === original ? 'load-original' : 'load-edited'); },
			prepare: async (_, signal) => { events.push('prepare'); await gate; signal.throwIfAborted(); },
			retirePlayback: () => { events.push('retire-other'); },
		},
	});
	return { transport, events, lifetime, tick: (position: number) => listener(position), stale: () => { stale = true; } };
}
test('uses the ordinary engine with Android activation before preparation, reusable loads, pause and stop', async () => {
	const h = host(); let changes = 0; const unlisten = h.transport.subscribe(() => { changes++; });
	const start = h.transport.play(cut, 20, false, 400);
	assert.ok(h.events.includes('unlock')); assert.ok(!h.events.includes('prepare'));
	await start;
	assert.ok(h.events.indexOf('unlock') < h.events.indexOf('prepare'));
	assert.equal(h.transport.snapshot().state, 'playing');
	h.tick(800); assert.equal(h.transport.snapshot().positionFrame, 800);
	h.transport.pause(); assert.equal(h.transport.snapshot().state, 'paused');
	await h.transport.play(cut, 20, false, 800);
	assert.equal(h.events.filter(e => e === 'load-edited').length, 1);
	h.transport.stop(); assert.equal(h.transport.snapshot().positionFrame, 800);
	await h.transport.play(cut, 20, true, 1200);
	assert.equal(h.transport.snapshot().original, true); assert.ok(h.events.includes('load-original'));
	h.stale(); h.tick(1400);
	assert.equal(h.transport.snapshot().state, 'stopped');
	assert.ok(changes > 0); unlisten();
	await h.transport.dispose(); await h.transport.dispose();
	assert.equal(h.events.filter(e => e === 'dispose').length, 1);
});
test('closing or replacing a loading comparison cannot start a late engine run', async () => {
	let release: () => void = () => undefined;
	const gate = new Promise<void>(resolve => { release = resolve; });
	const h = host(gate);
	const first = h.transport.play(cut, 20, false, 400);
	const second = h.transport.play(cut, 20, true, 400);
	release(); assert.deepEqual(await Promise.all([first, second]), [false, true]);
	assert.deepEqual(h.events.filter(e => e.startsWith('load-')), ['load-original']);
	await h.transport.dispose();
	const j = host(gate); const pending = j.transport.play(cut, 20, false, 400);
	await j.transport.dispose(); assert.equal(await pending, false);
	assert.equal(j.events.includes('play'), false);
	await assert.rejects(j.transport.play(cut, 20, false), { name: 'AbortError' });
});
