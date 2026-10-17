/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, clipByName, seekOnRuler, chooseNestedCommandAction, chooseCommandAction } from './audio-editor-test-helpers.js';

test('a split can be rejoined through clip menus without keyboard modifiers', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Editing$/u }).click();
	await preferences.getByRole('checkbox', { name: 'Apply 2 ms fades to new clips', exact: true }).uncheck();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await importFiles(editor, [toneA]);
	await clipByName(editor, toneA.name).locator('.clip-header').click();
	await seekOnRuler(page, editor, 100);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Split']);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	const clip = editor.locator('[data-clip-id][role="group"]').first();
	await clip.locator('.clip-header').click();
	await clip.getByRole('button', { name: 'Clip menu', exact: true }).click();
	await page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: /^Select all clips on this track/u }).click();
	await expect(editor.locator('.clip-display[data-selected="true"]')).toHaveCount(2);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Join selected clips']);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
});
