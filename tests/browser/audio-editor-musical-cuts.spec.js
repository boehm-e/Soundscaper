/* SPDX-License-Identifier: AGPL-3.0-only */
import { musicalCutFixture } from './audio-editor-musical-cut-fixture.js';
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, collectClientErrors, importFiles, openChromeDrawer, registerAudioEditorHooks } from './audio-editor-test-helpers.js';


test.describe('musical cuts on a tablet-sized touch screen', () => {
	test.use({ viewport: { width: 1100, height: 760 }, hasTouch: true });
	registerAudioEditorHooks();
	test('analyzes locally, auditions the staged join, applies it and restores it with one Undo', async ({ page }) => {
		test.setTimeout(90_000);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const fixture = musicalCutFixture();
		await importFiles(editor, [fixture]);
		await clipByName(editor, fixture.name).locator('.clip-header').tap();
		await editor.getByRole('button', { name: 'Fullscreen', exact: true }).tap();
		await chooseCommandAction(page, editor, 'Analyze', 'Find musical cuts');
		const dialog = page.getByRole('dialog', { name: 'Find musical cuts', exact: true });
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Close', exact: true }).last().click({ trial: true });
		await dialog.getByRole('spinbutton', { name: 'Duration to remove (seconds, optional)', exact: true }).fill('8');
		await dialog.getByRole('button', { name: 'Find cuts', exact: true }).tap();
		await expect(dialog.getByRole('radio').first()).toBeVisible({ timeout: 40_000 });
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		const apply = dialog.getByRole('button', { name: 'Apply this cut', exact: true });
		await expect(apply).toBeDisabled();
		await dialog.getByRole('button', { name: 'Listen to the join', exact: true }).tap();
		await expect.poll(async () => await dialog.getByRole('alert').count()
			? await dialog.getByRole('alert').innerText() : await apply.isEnabled() ? 'ready' : 'waiting',
		{ timeout: 20_000 }).toBe('ready');
		await expect(dialog.getByRole('alert')).toHaveCount(0);
		await page.screenshot({ path: 'test-results/musical-cuts-tablet.png' });
		await apply.tap();
		await expect(dialog).not.toBeVisible();
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(clipByName(editor, fixture.name)).toBeVisible();
		expect(errors).toEqual([]);
	});
	test.describe('French phone layout', () => {
		test.use({ viewport: { width: 390, height: 844 } });
		test('keeps controls inside the viewport and explains when no musical cut is found', async ({ page }) => {
			const editor = await bootEditor(page, '/embed/fr/');
			const fixture = createWavFixture({ name: 'silence.wav', frequency: 0, duration: 6, channelCount: 1 });
			await importFiles(editor, [fixture]);
			await openChromeDrawer(editor);
			await editor.getByRole('menuitem', { name: 'Analyser', exact: true }).tap();
			await page.getByRole('menuitem', { name: 'Trouver des coupes musicales', exact: true }).tap();
			const dialog = page.getByRole('dialog', { name: 'Trouver des coupes musicales', exact: true });
			await expect(dialog).toBeVisible();
			const bounds = await dialog.boundingBox();
			expect(bounds.x).toBeGreaterThanOrEqual(0);
			expect(bounds.width).toBeLessThanOrEqual(390);
			await dialog.getByRole('button', { name: 'Chercher des coupes', exact: true }).tap();
			await expect(dialog.getByRole('status')).toHaveText('Aucune coupe compatible trouvée. Essayez une autre sélection ou laissez la durée vide.', { timeout: 20_000 });
			await expect(dialog.getByRole('alert')).toHaveCount(0);
			await expect(editor).toHaveAttribute('data-clip-count', '1');
		});
	});
});
