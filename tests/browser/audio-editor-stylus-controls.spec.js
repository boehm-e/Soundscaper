/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, clipByName, chooseCommandAction, chooseNestedCommandAction, openParametricEqSelectionEffect, dockWorkspacePanel } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { dragNativePointer, emulateNonPrimaryPen, pointerCenter } from './helpers/native-pointer-input.js';

test.use({ actionTimeout: 10_000 });
async function setup(page) {
	await emulateNonPrimaryPen(page);
	await page.setViewportSize({ width: 1280, height: 950 });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const row = clipByName(editor, toneA.name).locator('xpath=ancestor::div[@data-track-row][1]');
	return { editor, row, native: await page.context().newCDPSession(page) };
}
test('non-primary pen edits track pan and volume with one undo per gesture', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium');
	const { editor, row, native } = await setup(page);
	const volume = row.getByRole('slider', { name: 'Volume', exact: true });
	const beforeVolume = await volume.inputValue(), box = await volume.boundingBox();
	const start = { x: box.x + box.width * 0.8, y: box.y + box.height / 2 };
	await dragNativePointer(native, start, { ...start, x: box.x + box.width * 0.4 });
	await expect(volume).not.toHaveValue(beforeVolume);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(volume).toHaveValue(beforeVolume);
	const pan = row.getByRole('slider', { name: /^Pan:/ });
	const beforePan = await pan.getAttribute('aria-valuenow'), point = await pointerCenter(pan);
	await dragNativePointer(native, point, { ...point, y: point.y - 25 });
	await expect(pan).not.toHaveAttribute('aria-valuenow', beforePan);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(pan).toHaveAttribute('aria-valuenow', beforePan);
});
test('non-primary pen edits a mixer fader', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium');
	const { editor, native } = await setup(page);
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const fader = editor.locator('.kw-audio-editor__mixer-channel--track').nth(1).getByRole('slider', { name: /volume$/u });
	const before = await fader.getAttribute('aria-valuenow'), start = await pointerCenter(fader);
	await dragNativePointer(native, start, { ...start, y: start.y + 25 });
	await expect(fader).not.toHaveAttribute('aria-valuenow', before);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(fader).toHaveAttribute('aria-valuenow', before);
});
test('non-primary pen edits parametric EQ bands and output', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium');
	const { editor, native } = await setup(page);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const dialog = await openParametricEqSelectionEffect(page, editor);
	const band = dialog.locator('.audio-editor-parametric-eq__handle').nth(1);
	const before = await band.getAttribute('aria-label'), start = await pointerCenter(band);
	await dragNativePointer(native, start, { x: start.x + 25, y: start.y - 20 });
	await expect(band).not.toHaveAttribute('aria-label', before);
	const output = dialog.locator('.audio-editor-parametric-eq__output input[type="range"]');
	const beforeOutput = await output.inputValue(), outputStart = await pointerCenter(output);
	await dragNativePointer(native, outputStart, { ...outputStart, x: outputStart.x + 45 });
	await expect(output).not.toHaveValue(beforeOutput);
});
test('non-primary pen moves automation points and the playhead', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium');
	const { editor, row, native } = await setup(page);
	await chooseTrackMenuAction(page, editor, row, 'Add automation');
	await row.locator('[data-automation-insert-point]').first().press('i');
	const point = row.locator('[data-automation-point-id]').last();
	const before = await point.getAttribute('cy'), start = await pointerCenter(point);
	await dragNativePointer(native, start, { ...start, y: start.y + 18 });
	await expect(point).not.toHaveAttribute('cy', before);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(point).toHaveAttribute('cy', before);
	const playhead = editor.locator('[data-playhead][role="slider"]');
	const beforeFrame = await playhead.getAttribute('aria-valuenow');
	const cursor = await pointerCenter(playhead.locator('.playhead-cursor__icon'));
	await dragNativePointer(native, cursor, { ...cursor, x: cursor.x + 60 });
	await expect(playhead).not.toHaveAttribute('aria-valuenow', beforeFrame);
});
test('non-primary pen paints a spectral selection and adjusts its frequency handle', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium');
	const { editor, native } = await setup(page);
	await clipByName(editor, toneA.name).locator('.clip-header').click();
	await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Select', ['Spectral', 'Spectral brush']);
	const brush = editor.getByRole('button', { name: 'Spectral brush', exact: true });
	const box = await brush.boundingBox();
	const start = { x: box.x + 30, y: box.y + box.height / 2 };
	await dragNativePointer(native, start, { x: start.x + 25, y: start.y + 25 });
	const maximum = editor.getByRole('slider', { name: 'Spectral selection maximum-frequency handle', exact: true });
	await expect(maximum).toBeVisible();
	const before = await maximum.getAttribute('aria-valuenow'), handle = await pointerCenter(maximum);
	await dragNativePointer(native, handle, { ...handle, y: handle.y - 15 });
	await expect(maximum).not.toHaveAttribute('aria-valuenow', before);
});
test('non-primary pen moves and resizes a floating panel', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium');
	const { editor, native } = await setup(page);
	await chooseCommandAction(page, editor, 'Window', 'Markers');
	await dockWorkspacePanel(editor, 'markers', 'floating');
	const panel = editor.locator('[data-workspace-panel="markers"]');
	const before = await panel.boundingBox();
	const header = await pointerCenter(panel.locator('.kw-audio-editor__workspace-panel-header'));
	await dragNativePointer(native, header, { x: header.x + 30, y: header.y + 20 });
	await expect.poll(async () => (await panel.boundingBox()).x).toBeGreaterThan(before.x + 20);
	const size = await panel.boundingBox();
	const grip = await pointerCenter(panel.getByRole('button', { name: 'Resize: Markers', exact: true }));
	await dragNativePointer(native, grip, { ...grip, x: grip.x + 25 });
	await expect.poll(async () => (await panel.boundingBox()).width).toBeGreaterThan(size.width + 15);
});
