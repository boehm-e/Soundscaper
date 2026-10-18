/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createMusicalCutResultWindow } from '../src/common/editor/musical-cut-result-window.ts';
import { musicalCutCommand, musicalTrackClips } from '../src/common/editor/musical-cut-edit.ts';
import { createMusicalCutsSession } from '../src/common/editor/controller/analysis/musical-cuts-session.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';

const rate = 48_000;
function clipOf(p: unknown, id: string) {
	const clip = musicalTrackClips(p, 'track').find(item => item.id === id);
	assert.ok(clip);
	return clip;
}
function project() {
	return createAudioEditorProjectV17({ id: 'cuts', title: 'Music', sampleRate: rate,
		sources: [createAudioSource({ id: 'source', storageKey: 'source', name: 'Music', frameCount: rate * 30, channelCount: 1, sampleRate: rate })],
		tracks: [createAudioTrack({ id: 'track', name: 'Music', clipIds: ['clip', 'later'] })],
		clips: [createAudioClip({ id: 'clip', trackId: 'track', sourceId: 'source', timelineStartFrame: rate * 2,
			sourceStartFrame: rate, durationFrames: rate * 20 }),
		createAudioClip({ id: 'later', trackId: 'track', sourceId: 'source', timelineStartFrame: rate * 25, durationFrames: rate })],
		sequences: [{ id: 'main', trackIds: ['track'] }], primarySequenceId: 'main',
	});
}
test('a crossfaded cut removes the exact duration, ripples later clips, and preserves the source', () => {
	const before = project();
	const original = structuredClone(before);
	const command = musicalCutCommand(before, 'track', rate * 6, rate * 14, 960, 'right');
	const after = applyEditorCommand(before, command);
	assert.deepEqual(before, original);
	const left = clipOf(after, 'clip');
	const right = clipOf(after, 'right');
	assert.equal(left.timelineStartFrame + left.durationFrames - right.timelineStartFrame, 960);
	assert.equal(left.sourceStartFrame, rate);
	assert.equal(right.sourceStartFrame, rate * 13 - 480);
	assert.equal(right.timelineStartFrame + right.durationFrames, rate * 14);
	assert.equal(clipOf(after, 'later').timelineStartFrame, rate * 17);
	assert.equal(after.sources.length, 1);
	assert.equal(after.selection.startFrame, rate * 6);
});
test('refuses overlapping, linked, warped or reverse clips rather than moving unrelated media', () => {
	const clips = musicalTrackClips(project(), 'track');
	for (const changes of [{ avLinkId: 'video' }, { reversed: true }, { warpMap: {} }, { groupId: 'group' }, { speedRatio: 2 }]) {
		assert.throws(() => musicalCutCommand({ ...project(), clips: [{ ...clips[0], ...changes }] }, 'track', rate * 6, rate * 14, 960, 'right'), /complex/);
	}
	assert.throws(() => musicalCutCommand({ ...project(), tracks: [createAudioTrack({ id: 'track', clipIds: ['clip', 'overlap'] })], clips: [clips[0], { ...clips[0], id: 'overlap' }] }, 'track', rate * 6, rate * 14, 960, 'right'), /complex/);
});
test('a join may span separate clips and removes intermediate material with the same exact crossfade', () => {
	const before = project();
	const p = createAudioEditorProjectV17({ ...before, tracks: [createAudioTrack({ id: 'track', clipIds: ['left', 'middle', 'right', 'later'] })], clips: [
		createAudioClip({ id: 'left', trackId: 'track', sourceId: 'source', timelineStartFrame: rate * 2, durationFrames: rate * 8 }),
		createAudioClip({ id: 'middle', trackId: 'track', sourceId: 'source', timelineStartFrame: rate * 10, durationFrames: rate * 4 }),
		createAudioClip({ id: 'right', trackId: 'track', sourceId: 'source', timelineStartFrame: rate * 14, durationFrames: rate * 10 }),
		before.clips[1],
	] });
	const after = applyEditorCommand(p, musicalCutCommand(p, 'track', rate * 6, rate * 18, 960, 'unused-split'));
	assert.equal(after.clips.length, 3);
	assert.equal(after.clips.find((clip: { id: string }) => clip.id === 'middle'), undefined);
	const left = clipOf(after, 'left');
	const right = clipOf(after, 'right');
	assert.equal(left.timelineStartFrame + left.durationFrames - right.timelineStartFrame, 960);
	assert.equal(right.timelineStartFrame + right.durationFrames, rate * 12);
	assert.equal(clipOf(after, 'later').timelineStartFrame, rate * 13);
});
test('the production Soundscaper schema uses the injected product runtime for the preview', async () => {
	const { id, title, sources, tracks, clips, sequences, primarySequenceId } = project();
	const p = createSoundscaperProject({ id, title, sources, tracks, clips, sequences, primarySequenceId });
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const generation = new EditorProjectGeneration(); generation.activate(p.id);
	let stagedCount = 0;
	const session = createMusicalCutsSession({ getProject: () => p, sampleRate: () => rate, lifetime,
		captureProject: () => generation.capture(), assertProject: token => generation.assertCurrent(token), busy: () => undefined,
		stageCommand: (before, command) => { stagedCount++; return applySoundscaperProjectCommand(before, command); },
		render: async (before, range) => {
			assert.equal(before.schemaFamily, 'soundscaper');
			const channel = new Float32Array(range.endFrame - range.startFrame).fill(0.2);
			return { sampleRate: rate, numberOfChannels: 1, length: channel.length, getChannelData: () => channel };
		},
		analyze: async () => ({ candidates: [{ startSeconds: 4, endSeconds: 12, cost: 0, musicScore: 100, durationScore: null, matchingSeconds: 4, nearSection: false }], sectionSeconds: [], beatSeconds: 0.5 }),
	});
	const report = await session.analyze({ trackId: 'track', range: { startFrame: rate * 2, endFrame: rate * 22 } }, new AbortController().signal);
	await session.preview(report.candidates[0], 20, new AbortController().signal);
	assert.equal(stagedCount, 1);
	assert.equal(p.clips.length, 2);
	session.dispose();
});

function harness(renderGate?: Promise<void>, sample?: (frame: number) => number) {
	let current = project();
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const generation = new EditorProjectGeneration(); generation.activate(current.id);
	const busy: boolean[] = [];
	const renders: { startFrame: number; endFrame: number; revision: number }[] = [];
	const session = createMusicalCutsSession({ getProject: () => current, sampleRate: () => rate, lifetime,
		stageCommand: (p, command) => applyEditorCommand(p, command),
		captureProject: () => generation.capture(), assertProject: token => generation.assertCurrent(token),
		busy: value => { busy.push(value); },
		render: async (p, range, signal) => {
			await renderGate;
			signal.throwIfAborted(); renders.push({ ...range, revision: p.revision });
			const channel = sample ? Float32Array.from({ length: range.endFrame - range.startFrame }, (_, i) => sample(range.startFrame + i))
				: new Float32Array(range.endFrame - range.startFrame).fill(0.2);
			return { sampleRate: rate, numberOfChannels: 1, length: channel.length, getChannelData: () => channel };
		},
		analyze: async () => ({ candidates: [{ startSeconds: 4, endSeconds: 12, cost: 0, musicScore: 100, durationScore: null, matchingSeconds: 4, nearSection: false }],
			sectionSeconds: [8], beatSeconds: 0.5 }),
	});
	return { session, lifetime, generation, busy, renders, hold: (gate: Promise<void>) => { renderGate = gate; }, change: () => { current = { ...current, revision: current.revision + 1 }; }, getProject: () => current };
}
test('chunked analysis maps a selection to absolute timeline frames and auditions the staged command', async () => {
	const h = harness();
	const result = await h.session.analyze({ trackId: 'track', range: { startFrame: rate * 2, endFrame: rate * 22 } }, new AbortController().signal);
	assert.equal(h.renders.length, 3);
	assert.deepEqual(h.renders.map(range => (range.endFrame - range.startFrame) / rate), [8, 8, 4]);
	assert.equal(result.candidates[0].startSeconds, 6);
	assert.deepEqual(result.sectionSeconds, [10]);
	const preview = await h.session.preview(result.candidates[0], 20, new AbortController().signal);
	assert.equal(preview.joinSeconds, 2);
	assert.equal(preview.channels[0].length, rate * 4);
	let commits = 0;
	h.session.apply(result.candidates[0], 20, command => {
		commits++; assert.equal(command.type, 'batch');
		const after = applyEditorCommand(h.getProject(), command);
		assert.equal(h.renders.at(-1)?.revision, after.revision);
	});
	assert.equal(commits, 1);
	assert.throws(() => h.session.apply(result.candidates[0], 20, () => undefined), /stale/);
	assert.deepEqual(h.busy, [true, false, true, false]);
	h.session.dispose(); h.session.dispose();
});
test('stale results, a changed project generation and closed sessions cannot apply edits', async () => {
	for (const invalidate of ['revision', 'generation', 'dispose']) {
		const h = harness();
		const result = await h.session.analyze({ trackId: 'track' }, new AbortController().signal);
		if (invalidate === 'revision') h.change();
		if (invalidate === 'generation') h.generation.invalidate();
		if (invalidate === 'dispose') h.session.dispose();
		assert.throws(() => h.session.apply(result.candidates[0], 20, () => assert.fail('stale commit')));
		h.session.dispose();
	}
});
test('cancelled analysis resets busy state and cannot publish a result', async () => {
	const h = harness();
	const abort = new AbortController(); abort.abort();
	await assert.rejects(h.session.analyze({ trackId: 'track' }, abort.signal), { name: 'AbortError' });
	assert.deepEqual(h.busy, [true, false]);
	await assert.rejects(h.session.analyze({ trackId: 'track', range: { startFrame: 0, endFrame: rate * 601 } }, new AbortController().signal), /length/);
	h.session.dispose();
});
test('closing during an uncooperative render rejects its late result and cleans up once', async () => {
	let release: () => void = () => undefined;
	const gate = new Promise<void>(resolve => { release = resolve; });
	const h = harness(gate);
	const work = h.session.analyze({ trackId: 'track' }, new AbortController().signal);
	h.session.dispose(); h.session.dispose(); release();
	await assert.rejects(work, { name: 'AbortError' });
	assert.deepEqual(h.busy, [true, false]);
});
test('a superseded analysis cannot clear the newer task busy state', async () => {
	let release: () => void = () => undefined;
	const gate = new Promise<void>(resolve => { release = resolve; });
	const h = harness(gate);
	const work = h.session.analyze({ trackId: 'track' }, new AbortController().signal);
	const newer = h.lifetime.startTask('analysis');
	release(); await assert.rejects(work, { name: 'AbortError' });
	assert.deepEqual(h.busy, [true]);
	h.session.dispose(); newer.finish();
});

test('result navigation renders the exact staged edit in bounded chunks, with exact PCM at sample zoom', async () => {
	const h = harness(), signal = new AbortController().signal;
	const report = await h.session.analyze({ trackId: 'track' }, signal);
	const cut = report.candidates[0];
	assert.equal(report.trackEndFrame, rate * 26);
	const extent = h.session.resultExtent(cut, 20);
	assert.deepEqual(extent, { startFrame: 0, endFrame: rate * 18 });
	const renderedBefore = h.renders.length;
	const window = await h.session.renderResultWindow(cut, 20, extent, 800, signal);
	assert.deepEqual(h.renders.slice(renderedBefore).map(r => r.endFrame - r.startFrame), [rate * 8, rate * 8, rate * 2]);
	assert.ok(h.renders.slice(renderedBefore).every(r => r.revision > h.getProject().revision));
	assert.equal(window.channels[0].maximum.length, 800); assert.equal(window.pcm, undefined);
	const exact = await h.session.renderResultWindow(cut, 20, { startFrame: rate * 6, endFrame: rate * 6 + 100 }, 800, signal);
	assert.equal(exact.pcm?.[0].length, 100);
	assert.equal(exact.pcm?.[0][0], Math.fround(0.2));
	const playback = await h.session.preview(cut, 20, signal, 17);
	assert.equal(playback.startSeconds, 17); assert.equal(playback.channels[0].length, rate);
	assert.equal(h.getProject().clips.length, 2);
	await assert.rejects(h.session.renderResultWindow(cut, 20, { startFrame: 0, endFrame: extent.endFrame + 1 }, 800, signal), /range/);
	h.session.dispose();
});
test('superseded, stale and closed result windows never publish a late render', async () => {
	for (const invalidate of ['supersede', 'revision', 'dispose']) {
		const h = harness(), signal = new AbortController().signal;
		const report = await h.session.analyze({ trackId: 'track' }, signal);
		let release: () => void = () => undefined;
		h.hold(new Promise<void>(resolve => { release = resolve; }));
		const range = { startFrame: 0, endFrame: rate * 4 };
		const pending = h.session.renderResultWindow(report.candidates[0], 20, range, 800, signal);
		const newer = invalidate === 'supersede' ? h.session.renderResultWindow(report.candidates[0], 20, range, 400, signal) : null;
		if (invalidate === 'revision') h.change();
		if (invalidate === 'dispose') h.session.dispose();
		release();
		await assert.rejects(pending);
		if (newer) assert.equal((await newer).channels[0].maximum.length, 400);
		h.session.dispose();
	}
});

test('cached waveform windows and aligned PCM avoid rerenders across zoom, pan and before/after revisits', async () => {
	const h = harness(), signal = new AbortController().signal;
	const report = await h.session.analyze({ trackId: 'track', toleranceSeconds: 5 }, signal), cut = report.candidates[0];
	const range = { startFrame: rate * 4, endFrame: rate * 7 };
	const first = await h.session.renderResultWindow(cut, 20, range, 800, signal);
	const count = h.renders.length;
	assert.equal(await h.session.renderResultWindow(cut, 20, range, 800, signal), first);
	const panned = await h.session.renderResultWindow(cut, 20, { startFrame: rate * 5, endFrame: rate * 8 }, 400, signal);
	assert.equal(panned.channels[0].maximum.length, 400);
	assert.equal(h.renders.length, count);
	await h.session.renderResultWindow(cut, 20, range, 800, signal, true);
	assert.equal(h.renders.length, count + 1);
	await h.session.renderResultWindow(cut, 20, range, 800, signal);
	assert.equal(h.renders.length, count + 1);
	await h.session.renderResultWindow(cut, 50, range, 800, signal);
	assert.equal(h.renders.length, count + 2);
	const aborted = new AbortController(); aborted.abort();
	await assert.rejects(h.session.renderResultWindow(cut, 20, range, 800, aborted.signal), { name: 'AbortError' });
	h.change();
	await assert.rejects(h.session.renderResultWindow(cut, 20, range, 800, signal), /stale/);
	h.session.dispose();
});
test('rerunning analysis clears waveform caches and rejects old candidates', async () => {
	const h = harness(), signal = new AbortController().signal;
	const first = await h.session.analyze({ trackId: 'track' }, signal);
	const range = { startFrame: rate * 4, endFrame: rate * 7 };
	await h.session.renderResultWindow(first.candidates[0], 20, range, 800, signal);
	const second = await h.session.analyze({ trackId: 'track' }, signal), count = h.renders.length;
	await assert.rejects(h.session.renderResultWindow(first.candidates[0], 20, range, 800, signal), /stale/);
	await h.session.renderResultWindow(second.candidates[0], 20, range, 800, signal);
	assert.equal(h.renders.length, count + 1);
	h.session.dispose();
});

test('cached blocks preserve exact sample positions and min/max/RMS when a viewport crops a block', async () => {
	const sample = (frame: number) => Math.sin(frame * 0.03);
	const h = harness(undefined, sample), signal = new AbortController().signal;
	const report = await h.session.analyze({ trackId: 'track' }, signal), cut = report.candidates[0];
	await h.session.renderResultWindow(cut, 20, { startFrame: rate * 4, endFrame: rate * 7 }, 800, signal);
	const count = h.renders.length, from = rate * 5 + 13, to = from + 100;
	const pcm = Float32Array.from({ length: to - from }, (_, i) => sample(from + i));
	const exact = await h.session.renderResultWindow(cut, 20, { startFrame: from, endFrame: to }, 100, signal);
	assert.deepEqual(exact.pcm?.[0], pcm);
	const expected = createMusicalCutResultWindow(from, to, rate, 20); expected.append([pcm]);
	const summary = await h.session.renderResultWindow(cut, 20, { startFrame: from, endFrame: to }, 20, signal);
	assert.deepEqual(summary, expected.finish());
	assert.equal(h.renders.length, count);
	h.session.dispose();
});
