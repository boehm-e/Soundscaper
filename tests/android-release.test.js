/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { androidReleaseIdentity, stageAndroidRelease } from '../scripts/android-release.mjs';

const commit = 'a'.repeat(40);
test('Android release identities bind branch builds and explicit tags to their exact source', () => {
	const branch = androidReleaseIdentity({ runNumber: '12', commit, refType: 'branch', refName: 'feat/android' });
	assert.equal(branch.tag, 'android-build-12');
	assert.equal(branch.commit, commit);
	assert.equal(androidReleaseIdentity({ runNumber: '13', commit, refType: 'tag', refName: 'android-v0.2' }).tag, 'android-v0.2');
	for (const runNumber of ['0', '-1', '1\nother=value', '2147483648']) {
		assert.throws(() => androidReleaseIdentity({ runNumber, commit }), /version code/u);
	}
	assert.throws(() => androidReleaseIdentity({ runNumber: '1', commit: 'main' }), /commit/u);
	assert.throws(() => androidReleaseIdentity({ runNumber: '1', commit, refType: 'tag', refName: '../wrong' }), /tag/u);
});

test('Android release staging carries installable bytes, checksums and exact source notes', async () => {
	const root = await mkdtemp(join(tmpdir(), 'android-release-'));
	try {
		const apk = Buffer.from('apk artifact'), aab = Buffer.from('bundle artifact');
		for (const [path, bytes] of [['apk/release/app-release.apk', apk], ['bundle/release/app-release.aab', aab]]) {
			const target = join(root, 'android/app/build/outputs', path);
			await mkdir(join(target, '..'), { recursive: true });
			await writeFile(target, bytes);
		}
		await writeFile(join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }));
		const result = await stageAndroidRelease(root, { runNumber: '12', commit, refType: 'branch' });
		const directory = join(root, '.android-build/release');
		assert.deepEqual(await readFile(join(directory, result.files[0])), apk);
		const checksums = await readFile(join(directory, 'SHA256SUMS'), 'utf8');
		assert.ok(checksums.includes(`${createHash('sha256').update(apk).digest('hex')}  ${result.files[0]}`));
		assert.match(await readFile(join(directory, 'release-notes.md'), 'utf8'), /Version code: 12/u);
		assert.ok((await readFile(join(directory, 'release-notes.md'), 'utf8')).includes(commit));
		await rm(join(root, 'android/app/build/outputs/apk/release/app-release.apk'));
		await assert.rejects(stageAndroidRelease(root, { runNumber: '13', commit }), /ENOENT/u);
	} finally { await rm(root, { recursive: true, force: true }); }
});
