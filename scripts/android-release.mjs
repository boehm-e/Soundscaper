#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import { cp, mkdir, readFile, rm, writeFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function androidReleaseIdentity({ runNumber, commit, refType, refName }) {
	if (!/^[1-9]\d*$/u.test(runNumber) || Number(runNumber) > 2_100_000_000) throw new Error('Invalid Android version code.');
	if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error('An exact source commit is required.');
	const tag = refType === 'tag' ? refName : `android-build-${runNumber}`;
	if (!/^android-(?:build-[1-9]\d*|v[\w][\w.-]*)$/u.test(tag ?? '')) throw new Error('Invalid Android release tag.');
	return { tag, commit, versionCode: Number(runNumber), title: `Soundscaper Android · ${tag}` };
}

export async function stageAndroidRelease(root, request) {
	const identity = androidReleaseIdentity(request);
	const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
	const stem = `soundscaper-android-${identity.versionCode}-${identity.commit.slice(0, 7)}`;
	const inputs = [
		['apk/release/app-release.apk', `${stem}.apk`],
		['bundle/release/app-release.aab', `${stem}.aab`],
	];
	// Validate every input before replacing an existing staged release.
	const sums = await Promise.all(inputs.map(async ([input, name]) => {
		const bytes = await readFile(resolve(root, 'android/app/build/outputs', input));
		return `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`;
	}));
	const destination = resolve(root, '.android-build/release');
	await rm(destination, { recursive: true, force: true });
	await mkdir(destination, { recursive: true });
	for (const [input, name] of inputs) await cp(resolve(root, 'android/app/build/outputs', input), resolve(destination, name));
	await writeFile(resolve(destination, 'SHA256SUMS'), sums.join(''));
	await writeFile(resolve(destination, 'release-notes.md'), [
		'Android preview build. Download the **APK** to install the application.',
		'', `App version: ${version}`, `Version code: ${identity.versionCode}`,
		`Source commit: ${identity.commit}`, '',
		'Includes the bundled editor and the latest Android touch/stylus fixes.',
		'Android 8.0 or newer; a recent Android System WebView is required.',
		'The AAB is an Android App Bundle, not a directly installable APK.',
		'Checksums are provided in SHA256SUMS. Corresponding source is available under this release tag.',
		'',
	].join('\n'));
	return { ...identity, files: inputs.map(([, name]) => name) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const release = await stageAndroidRelease(resolve(import.meta.dirname, '..'), {
		runNumber: process.env.ANDROID_VERSION_CODE, commit: process.env.GITHUB_SHA,
		refType: process.env.GITHUB_REF_TYPE, refName: process.env.GITHUB_REF_NAME,
	});
	if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `tag=${release.tag}\ntitle=${release.title}\n`);
	console.log(JSON.stringify(release));
}
