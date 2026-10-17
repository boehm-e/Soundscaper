/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

const tone = createWavFixture({ name: 'touch-selection.wav', frequency: 440, duration: 30 });

async function swipe(native, first, last) {
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
	for (let step = 1; step <= 8; step += 1) {
		await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
			...first, x: first.x + (last.x - first.x) * step / 8,
			y: first.y + (last.y - first.y) * step / 8,
		}] });
	}
	await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

for (const viewport of [{ width: 1137, height: 668 }, { width: 412, height: 915 }]) {
	test(`native touch selects audio without moving the clip or scrolling at ${viewport.width}px`, async ({ page, browserName }) => {
		test.skip(browserName !== 'chromium', 'Native touch uses the Chromium input protocol.');
		await page.setViewportSize(viewport);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [tone]);
		await chooseCommandAction(page, editor, 'Select', 'Select none');
		const clip = clipByName(editor, tone.name);
		const waveform = clip.locator('canvas.clip-body__waveform').first();
		const box = await waveform.boundingBox();
		expect(box).not.toBeNull();
		const timeline = editor.locator('[data-timeline]');
		const initialScroll = await timeline.evaluate(element => element.scrollLeft);
		const initialClip = await clip.boundingBox();
		const timecodes = editor.locator('[data-selection-toolbar] .timecode');
		const initialSelection = await timecodes.allTextContents();
		const cancellations = [];
		page.on('console', message => {
			if (message.text() === 'touch-selection-cancelled') cancellations.push(message.text());
		});
		await waveform.evaluate(element => element.addEventListener('pointercancel', () => console.log('touch-selection-cancelled')));
		const native = await page.context().newCDPSession(page);
		const first = { x: box.x + 40, y: box.y + box.height * 0.4, id: 1 };
		await swipe(native, first, { ...first, x: Math.min(box.x + 200, viewport.width - 35) });
		await expect.poll(() => timecodes.allTextContents()).not.toEqual(initialSelection);
		expect(cancellations).toEqual([]);
		expect(await timeline.evaluate(element => element.scrollLeft)).toBe(initialScroll);
		expect((await clip.boundingBox()).x).toBeCloseTo(initialClip.x, 0);
		const selected = await timecodes.allTextContents();
		expect(selected[0]).not.toBe(selected[1]);
		await expect(editor.getByRole('group', { name: 'Selection start', exact: true })).toBeEnabled();
	});
}

test('two fingers pan and pinch the timeline without selecting or moving audio', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'Native touch uses the Chromium input protocol.');
	await page.setViewportSize({ width: 1137, height: 668 });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [tone]);
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	const clip = clipByName(editor, tone.name);
	const waveform = clip.locator('canvas.clip-body__waveform').first();
	const box = await waveform.boundingBox();
	const timecodes = editor.locator('[data-selection-toolbar] .timecode');
	const selection = await timecodes.allTextContents();
	const timeline = editor.locator('[data-timeline]');
	const initialWidth = await timeline.evaluate(element => element.scrollWidth);
	const native = await page.context().newCDPSession(page);
	const first = { x: box.x + 160, y: Math.min(box.y + 50, 570), id: 1 };
	const second = { ...first, x: first.x + 120, id: 2 };
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first, second] });
	for (let step = 1; step <= 8; step += 1) {
		await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [first, second].map(point => ({
			...point, x: point.x - step * 10, y: point.y - step * 4,
		})) });
	}
	await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await expect.poll(() => timeline.evaluate(element => element.scrollLeft)).toBeGreaterThan(50);
	expect(await timecodes.allTextContents()).toEqual(selection);
	await expect(clip).toHaveAccessibleName(/starts at 0 seconds/u);
	const a = { ...first, x: first.x - 50, y: first.y - 32 };
	const b = { ...second, x: second.x - 50, y: second.y - 32 };
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a, b] });
	for (let step = 1; step <= 8; step += 1) {
		await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [
			{ ...a, x: a.x - step * 4 }, { ...b, x: b.x + step * 4 },
		] });
	}
	await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await expect.poll(() => timeline.evaluate(element => element.scrollWidth)).toBeGreaterThan(initialWidth * 1.2);
	expect(await timecodes.allTextContents()).toEqual(selection);
	await expect(clip).toHaveAccessibleName(/starts at 0 seconds/u);
});
