/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, chooseCommandAction } from './audio-editor-test-helpers.js';
import { dragNativePointer, emulateNonPrimaryPen, pointerCenter } from './helpers/native-pointer-input.js';

for (const kind of ['touch', 'pen']) test(`${kind} moves and resizes a dialog`, async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium');
	await emulateNonPrimaryPen(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Analyze', 'Contrast');
	const dialog = page.getByRole('dialog', { name: 'Contrast', exact: true });
	const native = await page.context().newCDPSession(page);
	const before = await dialog.boundingBox(), header = await pointerCenter(dialog.locator('.dialog-header'));
	await dragNativePointer(native, header, { x: header.x - 40, y: header.y + 20 }, kind);
	await expect.poll(async () => (await dialog.boundingBox()).x).toBeLessThan(before.x - 25);
	await expect.poll(async () => (await dialog.boundingBox()).y).toBeGreaterThan(before.y + 10);
	const size = await dialog.boundingBox();
	const grip = await pointerCenter(dialog.getByRole('button', { name: 'Resize: Contrast', exact: true }));
	await dragNativePointer(native, grip, { x: grip.x - 40, y: grip.y - 25 }, kind);
	await expect.poll(async () => (await dialog.boundingBox()).width).toBeLessThan(size.width - 25);
	if (kind === 'touch') {
		const restored = await dialog.boundingBox(), again = await pointerCenter(dialog.getByRole('button', { name: 'Resize: Contrast', exact: true }));
		await dragNativePointer(native, again, { x: again.x - 25, y: again.y - 15 }, kind, true);
		await expect.poll(async () => (await dialog.boundingBox()).width).toBeCloseTo(restored.width, 0);
	}
});
