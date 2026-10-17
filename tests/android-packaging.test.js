/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareAndroidWeb } from '../scripts/android-prepare.mjs';

test('Android assets preserve the web build, load the native bridge first, and carry policy headers', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-android-'));
	try {
		await mkdir(join(root, 'dist/embed/en'), { recursive: true });
		await mkdir(join(root, 'android/web'), { recursive: true });
		await mkdir(join(root, 'LICENSES'), { recursive: true });
		await writeFile(join(root, 'LICENSES/Capacitor-MIT.txt'), 'MIT notice');
		const html = '<html><head><script type="module" crossorigin src="/assets/main.js"></script></head></html>';
		await writeFile(join(root, 'dist/index.html'), html);
		await writeFile(join(root, 'dist/embed/en/index.html'), html);
		await writeFile(join(root, 'dist/effect.wasm'), new Uint8Array([0, 97, 115, 109]));
		await writeFile(join(root, 'android/web/file-bridge.mjs'), '/* native bridge */');
		await cp(new URL('../LICENSE', import.meta.url), join(root, 'LICENSE'));
		await cp(new URL('../THIRD_PARTY_LICENSES.md', import.meta.url), join(root, 'THIRD_PARTY_LICENSES.md'));
		await prepareAndroidWeb(root);
		const bundled = await readFile(join(root, '.android-build/web/embed/en/index.html'), 'utf8');
		assert.ok(bundled.indexOf('android-file-bridge.mjs') < bundled.indexOf('/assets/main.js'));
		assert.match(bundled, /crossorigin src="\/assets\/main.js"/);
		assert.equal(await readFile(join(root, 'dist/index.html'), 'utf8'), html);
		assert.match(await readFile(join(root, '.android-build/web/android-smoke.html'), 'utf8'), /rel="icon" href="data:,"/u);
		const headers = JSON.parse(await readFile(join(root, '.android-build/web/soundscaper-headers.json')));
		assert.equal(headers['Cross-Origin-Opener-Policy'], 'same-origin');
		assert.equal(headers['Cross-Origin-Embedder-Policy'], 'credentialless');
		assert.match(headers['Content-Security-Policy'], /wasm-unsafe-eval/);
		assert.equal(headers['Cache-Control'], 'no-store');
		assert.deepEqual([...await readFile(join(root, '.android-build/web/effect.wasm'))], [0, 97, 115, 109]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
