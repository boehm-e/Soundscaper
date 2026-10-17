/* SPDX-License-Identifier: AGPL-3.0-only */

/** A pen may report non-primary contact after another pen/hover device. */
export function isPrimaryPointer(event: Readonly<{ pointerType?: string; isPrimary?: boolean }>): boolean {
	return event.pointerType === 'pen' || event.isPrimary !== false;
}
