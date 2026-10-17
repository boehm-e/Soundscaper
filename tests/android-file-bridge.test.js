/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAndroidFileAccess, createAndroidWindowAccess } from '../android/web/file-bridge.mjs';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';

function harness() {
	const output = new Uint8Array(600_000);
	const writes = [];
	let closed = false;
	let aborted = false;
	return {
		output, writes,
		plugin: {
			async chooseSaveTarget() { return { targetId: 'chosen', name: 'mix.wav' }; },
			async beginWrite() {},
			async writeChunk({ data, position }) {
				const bytes = Buffer.from(data, 'base64');
				writes.push(bytes.length);
				output.set(bytes, position);
				return { position: position + bytes.length };
			},
			async finishWrite() { closed = true; },
			async abortWrite() { aborted = true; },
		},
		get closed() { return closed; },
		get aborted() { return aborted; },
	};
}

test('Android fullscreen forwards both enter and exit to the native window', async () => {
	const calls = [];
	const window = createAndroidWindowAccess({ async setFullscreen(request) { calls.push(request); } });
	await window.setFullscreen(true);
	await window.setFullscreen(false);
	assert.deepEqual(calls, [{ enabled: true }, { enabled: false }]);
});

test('Android save streams bounded chunks and patches the WAV header in place', async () => {
	const native = harness();
	const files = createAndroidFileAccess(native.plugin);
	const target = await files.chooseSaveTarget({ suggestedName: 'mix.wav' });
	const writer = await target.createWritable();
	await writer.write(new Blob([new Uint8Array(500_000).fill(12)]));
	await writer.write({ type: 'write', position: 0, data: new Uint8Array([82, 73, 70, 70]) });
	await writer.close();
	assert.ok(native.writes.length >= 4);
	assert.ok(native.writes.every(size => size <= 192 * 1024));
	assert.deepEqual([...native.output.subarray(0, 5)], [82, 73, 70, 70, 12]);
	assert.equal(native.closed, true);
	await assert.rejects(writer.write(new Uint8Array(1)), /closed/);
});

test('Android picker cancellation is reported as cancellation by the file service', async () => {
	const soundscaperAndroid = createAndroidFileAccess({
		async chooseSaveTarget() { return { cancelled: true }; },
	});
	const files = createAudioEditorFileService({ scope: { soundscaperAndroid } });
	assert.equal((await files.saveFile({ purpose: 'report', text: 'hello', suggestedName: 'test.txt' })).cancelled, true);
});

test('Android buffered exports use the native document writer without a blob download', async () => {
	const native = harness();
	const scope = { soundscaperAndroid: createAndroidFileAccess(native.plugin) };
	const files = createAudioEditorFileService({ scope });
	const result = await files.createDownload({ purpose: 'audio', bytes: new Uint8Array([1, 2, 3]), suggestedName: 'mix.wav' });
	assert.equal(result.method, 'file-system-access');
	assert.equal(native.closed, true);
	assert.deepEqual([...native.output.subarray(0, 3)], [1, 2, 3]);
});

test('Android failed writes abort the native temporary file and propagate the error', async () => {
	const native = harness();
	native.plugin.writeChunk = async () => { throw new Error('Storage full'); };
	const files = createAudioEditorFileService({ scope: { soundscaperAndroid: createAndroidFileAccess(native.plugin) } });
	await assert.rejects(files.saveFile({ purpose: 'audio', text: 'data', suggestedName: 'mix.wav' }), /Storage full/);
	assert.equal(native.aborted, true);
});

test('Android bootstrap uses the plugin proxy injected by Capacitor before the application starts', async () => {
	const previous = globalThis.Capacitor;
	try {
		globalThis.Capacitor = { getPlatform: () => 'android', Plugins: { SoundscaperFiles: harness().plugin } };
		await import('../android/web/file-bridge.mjs?bootstrap-test');
		const target = await globalThis.soundscaperAndroid.chooseSaveTarget({ suggestedName: 'test.wav' });
		assert.equal(target.name, 'mix.wav');
	} finally {
		globalThis.Capacitor = previous;
		delete globalThis.soundscaperAndroid;
	}
});
