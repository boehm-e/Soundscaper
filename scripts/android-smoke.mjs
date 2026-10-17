#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { _android as android, expect } from '@playwright/test';
import { createWavFixture } from '../tests/browser/audio-editor-test-fixtures.js';
import {
	bootEditor, chooseDropdown, importFiles, openChromeDrawer, openExportDialog,
	chooseFileAction, waitForProjectActivation, chooseNestedCommandAction,
	clipByName, seekOnRuler, waitForEditor, closeChromeDrawer,
} from '../tests/browser/audio-editor-test-helpers.js';
import { playAndWaitForAdvance } from '../tests/browser/helpers/playback-progress.js';

const appId = 'io.github.boehme.soundscaper';
const evidence = resolve('.android-build/evidence');
await mkdir(evidence, { recursive: true });
const devices = await android.devices();
const device = devices.find(item => process.env.ANDROID_SERIAL
	? item.serial() === process.env.ANDROID_SERIAL : item.serial().startsWith('emulator-'));
if (!device) throw new Error('Start an emulator, or explicitly set ANDROID_SERIAL to a test device.');
device.setDefaultTimeout(60_000);
const adb = (...args) => execFileSync('adb', ['-s', device.serial(), ...args], {
	maxBuffer: 16 * 1024 * 1024, timeout: 60_000,
});
const report = { steps: [], consoleErrors: [] };
function mark(step) {
	report.steps.push(step);
	console.log(`Android smoke: ${step}`);
}

function nativeNode(resourceId, className) {
	adb('shell', 'uiautomator', 'dump', '/sdcard/soundscaper-smoke-ui.xml');
	const xml = adb('shell', 'cat', '/sdcard/soundscaper-smoke-ui.xml').toString();
	for (const node of xml.matchAll(/<node\b[^>]*>/gu)) {
		const attributes = Object.fromEntries([...node[0].matchAll(/([\w-]+)="([^"]*)"/gu)].map(match => [match[1], match[2]]));
		if (attributes['resource-id'] === resourceId && (!className || attributes.class === className)) return attributes;
	}
	return null;
}

async function tapNative(resourceId, className) {
	let node;
	await expect.poll(() => {
		node = nativeNode(resourceId, className);
		return node !== null;
	}, { timeout: 60_000 }).toBe(true);
	const bounds = [...node.bounds.matchAll(/\d+/gu)].map(match => Number(match[0]));
	adb('shell', 'input', 'tap', String(Math.round((bounds[0] + bounds[2]) / 2)), String(Math.round((bounds[1] + bounds[3]) / 2)));
}
let page;
try {
	await expect.poll(() => adb('shell', 'getprop', 'sys.boot_completed').toString().trim(), { timeout: 120_000 }).toBe('1');
	adb('install', '-r', resolve('android/app/build/outputs/apk/debug/app-debug.apk'));
	adb('shell', 'pm', 'grant', appId, 'android.permission.RECORD_AUDIO');
	adb('shell', 'am', 'force-stop', appId);
	adb('shell', 'am', 'start', '-W', '-n', `${appId}/.MainActivity`, '--ez', 'soundscaper.smoke', 'true');
	const processId = adb('shell', 'pidof', appId).toString().trim();
	// Playwright gives pkg precedence over socketName; select only the current
	// process socket so a just-replaced APK cannot match a cached dead WebView.
	const webview = await device.webView({ socketName: `webview_devtools_remote_${processId}` });
	page = await webview.page();
	page.setDefaultTimeout(60_000);
	page.on('pageerror', error => report.consoleErrors.push(String(error)));
	page.on('console', message => {
		if (message.type() === 'error') report.consoleErrors.push(message.text());
	});
	// No remote server is permitted for the baseline editor or its resources.
	const remoteRequests = [];
	await page.route('**/*', route => {
		if (new URL(route.request().url()).hostname === 'localhost') return route.continue();
		remoteRequests.push(route.request().url());
		return route.abort();
	});
	const editor = await bootEditor(page, 'https://localhost/embed/en/');
	report.capabilities = await page.evaluate(() => ({
		origin: location.origin,
		nativeFiles: !!globalThis.soundscaperAndroid,
		secureContext: isSecureContext,
		crossOriginIsolated,
		audioWorklet: 'AudioWorkletNode' in globalThis,
		userAgent: navigator.userAgent,
	}));
	assert.equal(report.capabilities.origin, 'https://localhost');
	assert.equal(report.capabilities.nativeFiles, true);
	assert.equal(report.capabilities.secureContext, true);
	assert.equal(report.capabilities.audioWorklet, true);
	mark('bundled editor starts with remote requests blocked');
	await page.evaluate(async () => {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		try {
			if (!stream.getAudioTracks().some(track => track.readyState === 'live')) throw new Error('No live microphone track.');
		} finally {
			for (const track of stream.getTracks()) track.stop();
		}
	});
	mark('Android microphone capture opens');
	const priorProjectId = await editor.getAttribute('data-project-id');
	await chooseFileAction(page, editor, 'New');
	await expect.poll(() => editor.getAttribute('data-project-id')).not.toBe(priorProjectId);
	await waitForProjectActivation(editor);
	const tone = createWavFixture({ name: 'android-smoke-tone.wav', frequency: 440, duration: 8 });
	const priorClips = await editor.locator('canvas.clip-body__waveform').count();
	await importFiles(editor, [tone]);
	await expect(editor.locator('canvas.clip-body__waveform')).toHaveCount(priorClips + 1);
	mark('WAV import and waveform');
	await openChromeDrawer(editor);
	await playAndWaitForAdvance(editor);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	mark('playback clock advances');
	await closeChromeDrawer(editor);
	await clipByName(editor, tone.name).click({ position: { x: 24, y: 10 } });
	await seekOnRuler(page, editor, 100);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Split']);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await page.reload();
	await waitForEditor(page);
	await waitForProjectActivation(editor);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	mark('clip split and project persistence after reload');
	await page.screenshot({ path: resolve(evidence, 'editor.png') });
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
	const exporting = dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await exporting;
	// The system picker remains a native Android surface outside the WebView.
	const exportedName = `soundscaper-smoke-${Date.now()}.wav`;
	await tapNative('android:id/title', 'android.widget.EditText');
	adb('shell', 'input', 'keycombination', '113', '29'); // Ctrl+A
	adb('shell', 'input', 'text', exportedName);
	await expect.poll(() => nativeNode('android:id/title', 'android.widget.EditText')?.text).toBe(exportedName);
	await tapNative('android:id/button1');
	await expect(dialog.locator('[data-export-action="start"]')).toBeVisible({ timeout: 90_000 });
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 90_000 });
	const output = adb('exec-out', 'cat', `/sdcard/Download/${exportedName}`);
	assert.equal(output.subarray(0, 4).toString(), 'RIFF');
	assert.equal(output.subarray(8, 12).toString(), 'WAVE');
	assert.ok(output.length > 44);
	await writeFile(resolve(evidence, 'export.wav'), output);
	mark('native document picker and WAV export');
	report.remoteRequests = remoteRequests;
	assert.deepEqual(report.consoleErrors, []);
	report.passed = true;
} catch (error) {
	report.passed = false;
	report.error = String(error.stack || error);
	throw error;
} finally {
	if (page) await page.screenshot({ path: resolve(evidence, 'final.png') }).catch(() => {});
	await writeFile(resolve(evidence, 'report.json'), JSON.stringify(report, null, 2));
	try {
		await writeFile(resolve(evidence, 'logcat.txt'), adb('logcat', '-d', '-t', '2500'));
	} catch (error) {
		await writeFile(resolve(evidence, 'logcat-unavailable.txt'), String(error));
	}
	await device.close();
}
console.log(JSON.stringify(report, null, 2));
