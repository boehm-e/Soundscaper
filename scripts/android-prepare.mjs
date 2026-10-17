#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authoredWildcardResponseHeaders } from './lib/static-response-headers.mjs';

export async function prepareAndroidWeb(repositoryRoot) {
	const source = resolve(repositoryRoot, 'dist');
	const destination = resolve(repositoryRoot, '.android-build/web');
	// Read before removing anything so a missing web build is a useful failure.
	const html = await readFile(resolve(source, 'index.html'), 'utf8');
	if (!html.includes('</head>')) throw new Error('The web build has no HTML head.');
	await rm(destination, { recursive: true, force: true });
	await mkdir(destination, { recursive: true });
	await cp(source, destination, { recursive: true });
	const bridgeTag = '<script type="module" src="/android-file-bridge.mjs"></script>';
	// Put the bridge before the Vite entry module, including on every locale route.
	const inject = text => text.replace(/<script\b[^>]*\btype="module"/u, `${bridgeTag}\n<script type="module"`);
	const { readdir } = await import('node:fs/promises');
	async function patchDocuments(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = resolve(directory, entry.name);
			if (entry.isDirectory()) await patchDocuments(path);
			else if (entry.name.endsWith('.html')) await writeFile(path, inject(await readFile(path, 'utf8')));
		}
	}
	await patchDocuments(destination);
	await writeFile(resolve(destination, 'android-smoke.html'), '<!doctype html><html><head><title>Android test bootstrap</title></head><body></body></html>');
	await cp(resolve(repositoryRoot, 'android/web/file-bridge.mjs'), resolve(destination, 'android-file-bridge.mjs'));
	await writeFile(resolve(destination, 'soundscaper-headers.json'), JSON.stringify({
		...authoredWildcardResponseHeaders(),
		'Cache-Control': 'no-store',
	}));
	await cp(resolve(repositoryRoot, 'LICENSE'), resolve(destination, 'LICENSE.txt'));
	await cp(resolve(repositoryRoot, 'LICENSES'), resolve(destination, 'LICENSES'), { recursive: true });
	await cp(resolve(repositoryRoot, 'THIRD_PARTY_LICENSES.md'), resolve(destination, 'THIRD_PARTY_LICENSES.md'));
	console.log(`Prepared bundled Android application at ${destination}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await prepareAndroidWeb(resolve(import.meta.dirname, '..'));
}
