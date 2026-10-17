/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
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
		analyze: async () => ({ candidates: [{ startSeconds: 4, endSeconds: 12, cost: 0, matchingSeconds: 4, nearSection: false }], sectionSeconds: [], beatSeconds: 0.5 }),
	});
	const report = await session.analyze({ trackId: 'track', range: { startFrame: rate * 2, endFrame: rate * 22 } }, new AbortController().signal);
	await session.preview(report.candidates[0], 20, new AbortController().signal);
	assert.equal(stagedCount, 1);
	assert.equal(p.clips.length, 2);
	session.dispose();
});

function harness(renderGate?: Promise<void>) {
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
			const channel = new Float32Array(range.endFrame - range.startFrame).fill(0.2);
			return { sampleRate: rate, numberOfChannels: 1, length: channel.length, getChannelData: () => channel };
		},
		analyze: async () => ({ candidates: [{ startSeconds: 4, endSeconds: 12, cost: 0, matchingSeconds: 4, nearSection: false }],
			sectionSeconds: [8], beatSeconds: 0.5 }),
	});
	return { session, lifetime, generation, busy, renders, change: () => { current = { ...current, revision: current.revision + 1 }; }, getProject: () => current };
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
