/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readWorkflow, extractJob } from './helpers/workflow-jobs.js';

test('Android publishing requires successful emulator validation and grants write access only to the publisher', async () => {
	const workflow = await readWorkflow('android.yml');
	const build = extractJob(workflow, 'build'), publish = extractJob(workflow, 'publish');
	assert.match(workflow, /permissions:\n {2}contents: read/u);
	assert.doesNotMatch(build, /contents: write/u);
	assert.match(build, /github\.event_name != 'pull_request'/u);
	const emulator = build.indexOf('name: Verify editor in Android WebView');
	assert.ok(emulator > 0 && build.indexOf('name: Prepare release signing key') > emulator);
	assert.match(publish, /needs: build/u);
	assert.match(publish, /if: needs\.build\.outputs\.release_tag != ''/u);
	assert.match(publish, /permissions:\n {6}contents: write/u);
	assert.ok(publish.indexOf('sha256sum --check') < publish.indexOf('gh release create'));
	assert.ok(publish.indexOf('gh release upload') < publish.indexOf('--draft=false'));
	assert.match(publish, /gh api "repos\/\$GH_REPO\/commits\/\$RELEASE_TAG" --jq \.sha/u);
	assert.match(publish, /--target "\$GITHUB_SHA"/u);
	assert.match(build, /if: always\(\)\n {8}run: rm -f "\$RUNNER_TEMP\/soundscaper-release\.jks"/u);
});
