/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('Android starts in viewport fullscreen and web retains its default', async ({ page }) => {
	let editor = await bootEditor(page, '/embed/en/');
	await expect(editor).not.toHaveClass(/kw-audio-editor--viewport-fullscreen/u);
	await page.addInitScript(() => { globalThis.fullscreenStates = []; globalThis.soundscaperAndroid = { async setFullscreen(enabled) { globalThis.fullscreenStates.push(enabled); } }; });
	await page.reload();
	editor = page.locator('[data-audio-editor]');
	await expect(editor).toHaveClass(/kw-audio-editor--viewport-fullscreen/u);
	const rect = await editor.boundingBox(), viewport = page.viewportSize();
	expect(rect.x).toBe(0); expect(rect.y).toBe(0);
	expect(rect.width).toBe(viewport.width); expect(rect.height).toBe(viewport.height);
	await expect.poll(() => page.evaluate(() => globalThis.fullscreenStates.at(-1))).toBe(true);
	await editor.getByRole('button', { name: 'Fullscreen', exact: true }).click();
	await expect(editor).not.toHaveClass(/kw-audio-editor--viewport-fullscreen/u);
	await expect.poll(() => page.evaluate(() => globalThis.fullscreenStates.at(-1))).toBe(false);
	await editor.getByRole('button', { name: 'Fullscreen', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.fullscreenStates.at(-1))).toBe(true);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	await expect(page.getByRole('dialog', { name: 'Editor preferences', exact: true })).toBeVisible();
});
