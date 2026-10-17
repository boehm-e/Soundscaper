/* SPDX-License-Identifier: AGPL-3.0-only */
export async function emulateNonPrimaryPen(page) {
	await page.addInitScript(() => {
		const primary = Object.getOwnPropertyDescriptor(PointerEvent.prototype, 'isPrimary');
		Object.defineProperty(PointerEvent.prototype, 'isPrimary', { configurable: true,
			get() { return this.pointerType === 'pen' ? false : primary.get.call(this); } });
	});
}
export async function pointerCenter(locator) {
	const box = await locator.boundingBox();
	if (!box) throw new Error('Pointer target is not visible.');
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
export async function dragNativePointer(native, start, end, kind = 'pen', cancel = false) {
	if (kind === 'pen') {
		await native.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start, pointerType: 'pen' });
		await native.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, pointerType: 'pen', clickCount: 1 });
		for (let step = 1; step <= 8; step++) await native.send('Input.dispatchMouseEvent', { type: 'mouseMoved',
			x: start.x + (end.x - start.x) * step / 8, y: start.y + (end.y - start.y) * step / 8, button: 'left', buttons: 1, pointerType: 'pen' });
		await native.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', buttons: 0, pointerType: 'pen', clickCount: 1 });
		return;
	}
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
	for (let step = 1; step <= 8; step++) await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
		x: start.x + (end.x - start.x) * step / 8, y: start.y + (end.y - start.y) * step / 8, id: 1,
	}] });
	await native.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
}
