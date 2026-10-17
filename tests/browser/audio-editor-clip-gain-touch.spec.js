/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

const tone = createWavFixture({ name: 'Touch gain.wav', duration: 6 });
test.use({ actionTimeout: 10_000 });

async function stroke(native, start, end, kind, cancel = false) {
	if (kind === 'pen') {
		await native.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, pointerType: 'pen', clickCount: 1 });
		for (let step = 1; step <= 8; step += 1) await native.send('Input.dispatchMouseEvent', { type: 'mouseMoved',
			x: start.x + (end.x - start.x) * step / 8, y: start.y + (end.y - start.y) * step / 8, button: 'left', buttons: 1, pointerType: 'pen' });
		await native.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', buttons: 0, pointerType: 'pen', clickCount: 1 });
		return;
	}
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
	for (let step = 1; step <= 8; step += 1) await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
		x: start.x + (end.x - start.x) * step / 8, y: start.y + (end.y - start.y) * step / 8, id: 1,
	}] });
	await native.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
}
async function center(point) {
	const box = await point.boundingBox();
	expect(box).not.toBeNull();
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function setup(page) {
	await page.setViewportSize({ width: 1137, height: 800 });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [tone]);
	await editor.getByRole('button', { name: 'Fit project', exact: true }).click();
	const clip = clipByName(editor, tone.name);
	await clip.locator('.clip-header').click();
	await editor.getByRole('button', { name: 'Clip gain', exact: true }).click();
	const path = clip.locator('.envelope-overlay path').first();
	await expect(clip.locator('.envelope-overlay')).toBeVisible();
	const start = await path.evaluate(element => {
		const point = element.getPointAtLength(element.getTotalLength() / 2);
		const client = new DOMPoint(point.x, point.y).matrixTransform(element.getScreenCTM());
		return { x: client.x, y: client.y };
	});
	return { editor, clip, native: await page.context().newCDPSession(page), start };
}

for (const kind of ['touch', 'pen', 'non-primary pen']) test(`${kind} creates and drags clip gain vertically, with undo and redo`, async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium');
	if (kind === 'non-primary pen') await page.addInitScript(() => {
		// Observed on the physical Xiaomi pen: contact events remain non-primary.
		const primary = Object.getOwnPropertyDescriptor(PointerEvent.prototype, 'isPrimary');
		Object.defineProperty(PointerEvent.prototype, 'isPrimary', { configurable: true,
			get() { return this.pointerType === 'pen' ? false : primary.get.call(this); } });
	});
	const pointerKind = kind === 'touch' ? 'touch' : 'pen';
	const errors = [];
	page.on('pageerror', error => errors.push(String(error)));
	const { editor, clip, native, start } = await setup(page);
	await stroke(native, start, start, pointerKind);
	const point = clip.locator('.envelope-point').first();
	await expect(clip.locator('.envelope-point')).toHaveCount(1);
	const original = await center(point);
	const timeline = editor.locator('[data-timeline]');
	const initialView = await timeline.evaluate(element => ({ width: element.scrollWidth, left: element.scrollLeft }));
	await stroke(native, original, { ...original, y: original.y + 32 }, pointerKind);
	await expect.poll(async () => (await center(point)).y).toBeGreaterThan(original.y + 20);
	const reduced = await center(point);
	await stroke(native, reduced, { ...reduced, y: reduced.y - 20 }, pointerKind);
	await expect.poll(async () => (await center(point)).y).toBeLessThan(reduced.y - 12);
	const raised = await center(point);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(async () => (await center(point)).y).toBeCloseTo(reduced.y, 1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(async () => (await center(point)).y).toBeCloseTo(original.y, 1);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(async () => (await center(point)).y).toBeCloseTo(reduced.y, 1);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(async () => (await center(point)).y).toBeCloseTo(raised.y, 1);
	expect(await timeline.evaluate(element => ({ width: element.scrollWidth, left: element.scrollLeft }))).toEqual(initialView);
	expect(errors).toEqual([]);
});

test('cancelling a touch gain drag restores the point without committing it', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium');
	const { editor, clip, native, start } = await setup(page);
	await stroke(native, start, start, 'touch');
	const point = clip.locator('.envelope-point').first();
	await expect(point).toBeVisible();
	const original = await center(point);
	await stroke(native, original, { ...original, y: original.y + 32 }, 'touch', true);
	await expect.poll(async () => (await center(point)).y).toBeCloseTo(original.y, 1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clip.locator('.envelope-point')).toHaveCount(0);
});
