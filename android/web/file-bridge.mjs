/* SPDX-License-Identifier: AGPL-3.0-only */
const CHUNK_BYTES = 192 * 1024;

export function createAndroidWindowAccess(plugin) {
	return Object.freeze({ setFullscreen: enabled => plugin.setFullscreen({ enabled }) });
}

/** File System Access shaped adapter backed by Android's document picker. */
export function createAndroidFileAccess(plugin) {
	return Object.freeze({
		async chooseSaveTarget(request = {}) {
			const target = await plugin.chooseSaveTarget({
				name: request.suggestedName || request.fileName || 'export.wav',
				mimeType: request.mimeType || 'application/octet-stream',
			});
			if (target.cancelled) throw new DOMException('Save cancelled.', 'AbortError');
			let opened = false;
			return Object.freeze({
				name: target.name,
				async createWritable() {
					if (opened) throw new Error('This Android save target has already been opened.');
					opened = true;
					await plugin.beginWrite({ targetId: target.targetId });
					return createWriter(plugin, target.targetId);
				},
			});
		},
	});
}

function createWriter(plugin, targetId) {
	let position = 0;
	let closed = false;
	return {
		async write(value) {
			if (closed) throw new Error('The Android save stream is closed.');
			const command = value?.type === 'write' ? value : null;
			if (command) {
				if (!Number.isSafeInteger(command.position) || command.position < 0) throw new RangeError('Invalid file position.');
				position = command.position;
			}
			const data = command ? command.data : value;
			const blob = data instanceof Blob ? data : new Blob([data]);
			for (let offset = 0; offset < blob.size; offset += CHUNK_BYTES) {
				const bytes = new Uint8Array(await blob.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
				let binary = '';
				for (let start = 0; start < bytes.length; start += 8192) {
					binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
				}
				const result = await plugin.writeChunk({ targetId, position, data: btoa(binary) });
				if (result.position !== position + bytes.length) throw new Error('Android save lost synchronization.');
				position = result.position;
			}
		},
		async close() {
			if (closed) throw new Error('The Android save stream is closed.');
			await plugin.finishWrite({ targetId });
			closed = true;
		},
		async abort() {
			if (closed) return;
			closed = true;
			await plugin.abortWrite({ targetId });
		},
	};
}

if (globalThis.Capacitor?.getPlatform?.() === 'android') {
	const plugins = globalThis.Capacitor.Plugins;
	globalThis.soundscaperAndroid = Object.freeze({
		...createAndroidFileAccess(plugins.SoundscaperFiles),
		...(plugins.SoundscaperWindow ? createAndroidWindowAccess(plugins.SoundscaperWindow) : {}),
	});
}
