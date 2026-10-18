/* SPDX-License-Identifier: AGPL-3.0-only */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { musicalCutViewport, zoomMusicalCutViewport, type MusicalCutViewport } from './musical-cut-viewport.ts';

export function useMusicalCutViewport({ totalFrames, joinFrame, joinEndFrame = joinFrame, sampleRate, width, onSeek }: {
	readonly totalFrames: number; readonly joinFrame: number; readonly sampleRate: number; readonly width: number;
	readonly joinEndFrame?: number;
	readonly onSeek: (frame: number) => void;
}) {
	const root = useRef<HTMLDivElement>(null);
	const [view, setView] = useState(() => musicalCutViewport(joinFrame - sampleRate * 4, sampleRate * 8, totalFrames));
	const current = useRef(view); current.current = view;
	const points = useRef(new Map<number, number>());
	const gesture = useRef<{ view: MusicalCutViewport; center: number; distance: number; moved: boolean } | null>(null);
	const minimum = Math.max(1, Math.ceil(width / 8));
	const update = useCallback((value: MusicalCutViewport) => { current.current = value; setView(value); }, []);
	const zoom = useCallback((factor: number, anchor = 0.5) => update(zoomMusicalCutViewport(current.current, factor, anchor, totalFrames, minimum)), [minimum, totalFrames, update]);
	const focus = useCallback(() => update(musicalCutViewport(joinFrame - sampleRate * 2, joinEndFrame - joinFrame + sampleRate * 4, totalFrames, minimum)), [joinFrame, joinEndFrame, sampleRate, totalFrames, minimum, update]);
	useEffect(() => { update(musicalCutViewport(joinFrame - sampleRate * 4, joinEndFrame - joinFrame + sampleRate * 8, totalFrames)); }, [joinFrame, joinEndFrame, sampleRate, totalFrames, update]);
	const fit = () => update({ startFrame: 0, endFrame: totalFrames });
	const pan = (start: number) => update(musicalCutViewport(start, current.current.endFrame - current.current.startFrame, totalFrames, minimum));
	function resetGesture(moved = false) {
		const xs = [...points.current.values()];
		gesture.current = xs.length ? { view: current.current, center: xs.length > 1 ? (xs[0] + xs[1]) / 2 : xs[0],
			distance: xs.length > 1 ? Math.max(1, Math.abs(xs[1] - xs[0])) : 0, moved } : null;
	}
	function down(event: ReactPointerEvent<HTMLDivElement>) {
		if (event.pointerType !== 'touch' && event.button !== 0) return;
		event.stopPropagation();
		points.current.set(event.pointerId, event.clientX); resetGesture(points.current.size > 1);
		event.currentTarget.setPointerCapture(event.pointerId);
	}
	function move(event: ReactPointerEvent<HTMLDivElement>) {
		if (!points.current.has(event.pointerId)) return;
		event.stopPropagation(); points.current.set(event.pointerId, event.clientX);
		const initial = gesture.current; if (!initial || !width) return;
		const xs = [...points.current.values()];
		const center = xs.length > 1 ? (xs[0] + xs[1]) / 2 : xs[0];
		if (Math.abs(center - initial.center) > 4 || xs.length > 1) initial.moved = true;
		if (!initial.moved) return;
		const span = initial.view.endFrame - initial.view.startFrame;
		const nextSpan = xs.length > 1 ? Math.max(minimum, Math.min(totalFrames, span * initial.distance / Math.max(1, Math.abs(xs[1] - xs[0])))) : span;
		const left = event.currentTarget.getBoundingClientRect().left;
		const anchor = initial.view.startFrame + (initial.center - left) / width * span;
		update(musicalCutViewport(anchor - (center - left) / width * nextSpan, nextSpan, totalFrames, minimum));
	}
	function finish(event: ReactPointerEvent<HTMLDivElement>, cancelled = false) {
		if (!points.current.has(event.pointerId)) return;
		event.stopPropagation();
		if (!cancelled && points.current.size === 1 && !gesture.current?.moved) {
			const offset = Math.max(0, Math.min(1, (event.clientX - event.currentTarget.getBoundingClientRect().left) / width));
			onSeek(Math.min(totalFrames - 1, Math.round(current.current.startFrame + offset * (current.current.endFrame - current.current.startFrame))));
		}
		points.current.delete(event.pointerId); resetGesture(true);
		if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
	}
	useEffect(() => {
		const element = root.current; if (!element) return;
		const wheel = (event: WheelEvent) => {
			event.preventDefault(); event.stopPropagation();
			if (event.ctrlKey || event.metaKey) zoom(2 ** (-event.deltaY / 300), Math.max(0, Math.min(1, (event.clientX - element.getBoundingClientRect().left) / width)));
			else { const v = current.current; update(musicalCutViewport(v.startFrame + (event.deltaX || event.deltaY) / width * (v.endFrame - v.startFrame), v.endFrame - v.startFrame, totalFrames, minimum)); }
		};
		element.addEventListener('wheel', wheel, { passive: false });
		return () => element.removeEventListener('wheel', wheel);
	}, [minimum, totalFrames, update, width, zoom]);
	return { root, view, zoom, focus, fit, pan, minimum, handlers: {
		onPointerDown: down, onPointerMove: move, onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => finish(e),
		onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => finish(e, true),
		onLostPointerCapture: (e: ReactPointerEvent<HTMLDivElement>) => finish(e, true),
	} };
}
