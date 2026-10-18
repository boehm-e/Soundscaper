/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { TimelineRuler } from '@soundscaper/design-system/TimelineRuler';
import { CLIP_CONTENT_OFFSET } from '@soundscaper/design-system/constants';
import { AudacityWaveformCanvases } from '../timeline/TimelineCanvasRenderer.jsx';
import { reprojectWaveformRange } from '../timeline/waveform-plan-continuity.ts';
import { prepareBoundedWaveformWindow } from '../../design-system-adapters/waveform.ts';
import { useMusicalCutViewport } from './useMusicalCutViewport.ts';
import { musicalCutTime as time } from './MusicalCutTimeline.jsx';
import { formatLocalizedTemplate as format } from '../localization-template.ts';

/** A detached, rendered result track. Navigation never authors edits in the real project. */
export default function MusicalCutResultTrack({ session, candidate, fadeMs, result, copy, seekFrame, onSeek, playing, audition, playbackStart }) {
	const sampleRate = result.sampleRate;
	const totalFrames = result.trackEndFrame - Math.round((candidate.endSeconds - candidate.startSeconds) * sampleRate);
	const joinFrame = Math.round(candidate.startSeconds * sampleRate);
	const [width, setWidth] = useState(640);
	const navigation = useMusicalCutViewport({ totalFrames, joinFrame, sampleRate, width, onSeek });
	const { root, view } = navigation;
	const [data, setData] = useState(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [position, setPosition] = useState(null);
	const canvasRoot = useRef(null);
	const messages = useRef(copy); messages.current = copy;
	useLayoutEffect(() => {
		const element = root.current;
		const observer = new ResizeObserver(() => setWidth(Math.max(1, Math.floor(element.clientWidth))));
		observer.observe(element);
		return () => observer.disconnect();
	}, [root]);
	useEffect(() => {
		const abort = new AbortController();
		setLoading(true); setError('');
		// Coalesce drag/pinch moves before asking the offline renderer for a new window.
		const timer = setTimeout(() => {
			void session.renderResultWindow(candidate, fadeMs, view, Math.min(4096, Math.ceil(width)), abort.signal).then(window => {
				if (!abort.signal.aborted) { setData({ window, width }); setLoading(false); }
			}).catch(cause => {
				if (abort.signal.aborted || cause?.name === 'AbortError') return;
				const key = typeof cause?.code === 'string' ? `error${cause.code[0].toUpperCase()}${cause.code.slice(1)}` : '';
				setError(messages.current[key] || cause?.message || messages.current.resultLoading); setLoading(false);
			});
		}, 80);
		return () => { clearTimeout(timer); abort.abort(); };
	}, [candidate, fadeMs, session, view, width]);
	useEffect(() => {
		if (!playing) { setPosition(null); return; }
		let frame;
		const tick = () => { setPosition(playbackStart + audition.positionSeconds()); frame = requestAnimationFrame(tick); };
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [audition, playbackStart, playing]);
	const models = useMemo(() => {
		if (!data) return [];
		const window = data.window, length = window.endFrame - window.startFrame;
		const rendering = window.pcm ? prepareBoundedWaveformWindow(window.pcm,
			{ sourceStartFrame: 0, durationFrames: length }, { pixelWidth: data.width, maxSamples: 4096 }).rendering
			: { mode: 'summary', pixelWidth: data.width, pixelsPerSample: data.width / length,
				startFrame: 0, endFrame: length, frameCount: length, channels: window.channels };
		const plan = { ...rendering, startFrame: window.startFrame, endFrame: window.endFrame };
		return [{ id: 'musical-cut-result', start: 0, duration: (view.endFrame - view.startFrame) / sampleRate,
			audacityWaveform: reprojectWaveformRange(plan, view.startFrame, view.endFrame, width) }];
	}, [data, sampleRate, view, width]);
	const span = view.endFrame - view.startFrame;
	const pixelsPerSecond = width * sampleRate / span;
	const percent = frame => (frame - view.startFrame) / span * 100;
	const marker = percent(joinFrame);
	const cursor = position !== null ? percent(position * sampleRate) : seekFrame !== null ? percent(seekFrame) : null;
	return <section className="audio-editor-musical-result" aria-label={copy.resultTrack}>
		<div className="audio-editor-musical-result__toolbar">
			<strong>{copy.resultTrack}</strong>
			<div className="audio-editor-musical-cuts__actions">
				<Button variant="secondary" onClick={() => navigation.zoom(2)} disabled={span <= navigation.minimum}>{copy.zoomIn}</Button>
				<Button variant="secondary" onClick={() => navigation.zoom(0.5)} disabled={span >= totalFrames}>{copy.zoomOut}</Button>
				<Button variant="secondary" onClick={navigation.focus}>{copy.focusJoin}</Button>
				<Button variant="secondary" onClick={navigation.fit}>{copy.fitTrack}</Button>
			</div>
		</div>
		<div ref={root} className="audio-editor-musical-result__viewport" role="group" aria-label={copy.resultWaveform} tabIndex="0"
			data-start-frame={view.startFrame} data-end-frame={view.endFrame} aria-busy={loading} {...navigation.handlers}
			onKeyDown={event => {
				if (event.key === '+' || event.key === '=') navigation.zoom(2);
				else if (event.key === '-') navigation.zoom(0.5);
				else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') navigation.pan(view.startFrame + span * (event.key === 'ArrowLeft' ? -0.1 : 0.1));
				else return;
				event.preventDefault(); event.stopPropagation();
			}}>
			<div className="audio-editor-musical-result__ruler" aria-hidden="true">
				<TimelineRuler pixelsPerSecond={pixelsPerSecond} scrollX={view.startFrame / sampleRate * pixelsPerSecond + CLIP_CONTENT_OFFSET}
					totalDuration={totalFrames / sampleRate} width={width} viewportWidth={width} height={34} timeFormat="minutes-seconds" />
			</div>
			<div className="audio-editor-musical-result__clip clip-header clip-header--blue">{format(copy.resultEndpoints, { start: time(candidate.startSeconds), end: time(candidate.endSeconds) })}</div>
			<div ref={canvasRoot} className="audio-editor-musical-result__waveforms">
				<div className="clip-body clip-body--blue" data-clip-id="musical-cut-result" data-color="blue">
					<canvas className="clip-body__waveform" aria-label={copy.resultWaveform} />
				</div>
				{data && <AudacityWaveformCanvases rootRef={canvasRoot} clips={models} displayMode="waveform" pixelsPerSecond={pixelsPerSecond}
					showRms verticalZoom={0} channelHeightRatio={0.5} spectrogramOptions={{ sampleRate }} />}
			</div>
			{marker >= 0 && marker <= 100 && <div className="audio-editor-musical-result__join" style={{ left: `${marker}%` }}><span>{copy.joinMarker}</span></div>}
			{cursor !== null && cursor >= 0 && cursor <= 100 && <div className="audio-editor-musical-result__cursor" style={{ left: `${cursor}%` }} />}
			{loading && <div role="status" className="audio-editor-musical-result__loading">{copy.resultLoading}</div>}
		</div>
		<input type="range" aria-label={copy.navigateResult} min="0" max={Math.max(0, totalFrames - span)} value={view.startFrame} step="1"
			disabled={span >= totalFrames} onChange={event => navigation.pan(Number(event.target.value))} />
		<p className="audio-editor-musical-join__caption">{copy.resultHelp}</p>
		{error && <p role="alert" className="audio-editor-field-error">{error}</p>}
	</section>;
}
