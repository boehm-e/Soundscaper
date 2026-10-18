/* SPDX-License-Identifier: AGPL-3.0-only */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { TransportButton } from '@soundscaper/design-system/TransportButton';
import { ToolbarButtonGroup } from '@soundscaper/design-system/Toolbar';
import { ContextMenu } from '@soundscaper/design-system/ContextMenu';
import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';
import { TimelineRuler } from '@soundscaper/design-system/TimelineRuler';
import { CLIP_CONTENT_OFFSET } from '@soundscaper/design-system/constants';
import { AudacityWaveformCanvases } from '../timeline/TimelineCanvasRenderer.jsx';
import { AudioTrackRuler } from '../timeline/AudioTrackRuler.jsx';
import { reprojectWaveformRange } from '../timeline/waveform-plan-continuity.ts';
import { prepareBoundedWaveformWindow } from '../../design-system-adapters/waveform.ts';
import { musicalCutFrames, musicalCutOriginalFrame, musicalCutResultFrame, musicalCutComparisonParts, musicalCutFitAmplitude } from '../../musical-cut-comparison.ts';
import { useMusicalCutViewport } from './useMusicalCutViewport.ts';
import { musicalCutTime as time } from './MusicalCutTimeline.jsx';
import { formatLocalizedTemplate as format } from '../localization-template.ts';

function waveformPeak(parts) {
	return Math.max(0, ...(parts ?? []).filter(part => !part.removed).flatMap(part => part.window.channels.flatMap(ch => [
		...ch.maximum, ...Array.from(ch.minimum, Math.abs),
	])));
}

/** Same transport, rulers and waveform painter as the editor, on an isolated before/after project. */
export default function MusicalCutResultTrack({ session, candidate, fadeMs, result, copy, editorCopy, seekFrame, onSeek, transport, blocked, onAudition }) {
	const sampleRate = result.sampleRate;
	const cut = musicalCutFrames(candidate, sampleRate);
	const [original, setOriginal] = useState(false);
	const [showRemoved, setShowRemoved] = useState(false);
	const expanded = showRemoved || original;
	const totalFrames = result.trackEndFrame - (expanded ? 0 : cut.removed);
	const [width, setWidth] = useState(640);
	const [playback, setPlayback] = useState(() => transport.snapshot());
	useEffect(() => transport.subscribe(() => setPlayback(transport.snapshot())), [transport]);
	const [error, setError] = useState('');
	const messages = useRef(copy); messages.current = copy;
	const run = action => {
		setError('');
		try { void Promise.resolve(action()).catch(cause => fail(cause)); } catch (cause) { fail(cause); }
	};
	const fail = useCallback(cause => {
		if (cause?.name === 'AbortError') return;
		transport.stop();
		const key = typeof cause?.code === 'string' ? `error${cause.code[0].toUpperCase()}${cause.code.slice(1)}` : '';
		setError(messages.current[key] || cause?.message || messages.current.resultLoading);
	}, [transport]);
	const sourceFrame = () => playback.original ? playback.positionFrame : musicalCutOriginalFrame(playback.positionFrame, cut.start, cut.removed);
	const playbackFrame = frame => original ? frame : musicalCutResultFrame(frame, cut.start, cut.end);
	const seek = frame => {
		const source = expanded ? frame : musicalCutOriginalFrame(frame, cut.start, cut.removed);
		onSeek(source); run(() => transport.seek(playbackFrame(source)));
	};
	const navigation = useMusicalCutViewport({ totalFrames, joinFrame: cut.start, joinEndFrame: expanded ? cut.end : cut.start, sampleRate, width, onSeek: seek });
	const { root, view } = navigation;
	const [data, setData] = useState(null);
	useEffect(() => { setData(null); }, [expanded, original]);
	const [loading, setLoading] = useState(true);
	const [verticalZoom, setVerticalZoom] = useState(0);
	const autoFit = useRef(true);
	const [menu, setMenu] = useState(null);
	const canvasRoot = useRef(null);
	const playing = playback.state === 'playing';
	const preparing = playback.state === 'loading';
	const play = async (before = original, sourceStart) => {
		const frame = sourceStart ?? (playback.state === 'paused' ? sourceFrame() : seekFrame ?? Math.max(0, cut.start - sampleRate * 2));
		const from = before ? frame : musicalCutResultFrame(frame, cut.start, cut.end);
		const started = await transport.play(candidate, fadeMs, before, Math.min((before ? result.trackEndFrame : result.trackEndFrame - cut.removed) - 1, from));
		if (started && !before) onAudition();
	};
	const playPause = () => run(() => playing || preparing ? transport.pause() : play());
	const compare = value => {
		const frame = playing || preparing || playback.state === 'paused' ? sourceFrame() : seekFrame ?? Math.max(0, cut.start - sampleRate * 2);
		setOriginal(value); if (value) setShowRemoved(true); onSeek(frame);
		if (playing || preparing) run(() => play(value, frame));
		else transport.stop();
	};
	useEffect(() => () => transport.stop(), [transport]);
	useLayoutEffect(() => {
		const element = root.current;
		const observer = new ResizeObserver(() => setWidth(Math.max(1, Math.floor(element.clientWidth))));
		observer.observe(element); return () => observer.disconnect();
	}, [root]);
	useEffect(() => {
		const abort = new AbortController();
		setLoading(true); setError('');
		const timer = setTimeout(() => {
			void (async () => {
				const parts = musicalCutComparisonParts(view.startFrame, view.endFrame, cut.start, cut.end, expanded, original);
				const rendered = [];
				for (const part of parts) {
					abort.signal.throwIfAborted();
					const columns = Math.max(1, Math.min(4096, Math.ceil(width * (part.endFrame - part.startFrame) / (view.endFrame - view.startFrame))));
					const window = await session.renderResultWindow(candidate, fadeMs, { startFrame: part.renderStart, endFrame: part.renderEnd }, columns, abort.signal, part.original);
					rendered.push({ ...part, window, width: columns });
				}
				if (abort.signal.aborted) return;
				setData(rendered); setLoading(false);
				if (autoFit.current) {
					setVerticalZoom(musicalCutFitAmplitude(waveformPeak(rendered))); autoFit.current = false;
				}
			})().catch(cause => { if (!abort.signal.aborted) { fail(cause); setLoading(false); } });
		}, 80);
		return () => { clearTimeout(timer); abort.abort(); };
	}, [candidate, cut.start, cut.end, expanded, fadeMs, original, session, view, width, fail]);
	const span = view.endFrame - view.startFrame;
	const pixelsPerSecond = width * sampleRate / span;
	const percent = frame => (frame - view.startFrame) / span * 100;
	const models = useMemo(() => (data ?? []).flatMap((part, index) => {
		const from = Math.max(view.startFrame, part.startFrame), to = Math.min(view.endFrame, part.endFrame);
		if (to <= from) return [];
		const window = part.window, length = window.endFrame - window.startFrame;
		const rendering = window.pcm ? prepareBoundedWaveformWindow(window.pcm,
			{ sourceStartFrame: 0, durationFrames: length }, { pixelWidth: part.width, maxSamples: 4096 }).rendering
			: { mode: 'summary', pixelWidth: part.width, pixelsPerSample: part.width / length,
				startFrame: 0, endFrame: length, frameCount: length, channels: window.channels };
		const plan = { ...rendering, startFrame: part.startFrame, endFrame: part.endFrame };
		return [{ id: `musical-cut-result-${index}`, start: (from - view.startFrame) / sampleRate, duration: (to - from) / sampleRate,
			removed: part.removed, audacityWaveform: reprojectWaveformRange(plan, from, to, width * (to - from) / (view.endFrame - view.startFrame)) }];
	}), [data, sampleRate, view, width]);
	const requestedPosition = playing || preparing || playback.state === 'paused' ? sourceFrame() : seekFrame;
	const sourcePosition = !original && requestedPosition !== null && requestedPosition >= cut.start && requestedPosition < cut.end ? cut.end : requestedPosition;
	const position = sourcePosition === null ? null : expanded ? sourcePosition : musicalCutResultFrame(sourcePosition, cut.start, cut.end);
	const cursor = position === null ? null : percent(position);
	const marker = percent(cut.start), resume = percent(cut.end);
	const bodyHeight = 220;
	const channels = data?.[0]?.window.channels.length ?? 2;
	const rulerTrack = useMemo(() => ({ name: copy.resultTrack }), [copy.resultTrack]);
	const fitAmplitude = () => { autoFit.current = !data; if (data) setVerticalZoom(musicalCutFitAmplitude(waveformPeak(data))); };
	return <section className="audio-editor-musical-result" aria-label={copy.resultTrack}>
		<div className="audio-editor-musical-result__toolbar">
			<strong>{copy.resultTrack}</strong>
			<ToolbarButtonGroup className="audio-editor-musical-result__transport" gap={2}>
				<TransportButton icon={playing ? 'pause' : preparing ? 'stop' : 'play'} iconColor="#74BE59" ariaLabel={playing ? editorCopy.pause : preparing ? editorCopy.cancel : editorCopy.play}
					active={playing} disabled={blocked && !playing && !preparing} onClick={playPause} />
				<TransportButton icon="stop" ariaLabel={editorCopy.stop} onClick={() => transport.stop()} />
				<TransportButton icon="skip-back" ariaLabel={editorCopy.jumpStart} disabled={blocked} onClick={() => seek(0)} />
			</ToolbarButtonGroup>
			<div className="audio-editor-musical-cuts__actions">
				<Button variant="secondary" onClick={() => navigation.zoom(2)} disabled={span <= navigation.minimum}>{copy.zoomIn}</Button>
				<Button variant="secondary" onClick={() => navigation.zoom(0.5)} disabled={span >= totalFrames}>{copy.zoomOut}</Button>
				<Button variant="secondary" onClick={() => { navigation.focus(); seek(Math.max(0, cut.start - sampleRate * 2)); }}>{copy.focusJoin}</Button>
				<Button variant="secondary" onClick={navigation.fit}>{copy.fitTrack}</Button>
			</div>
		</div>
		<div className="audio-editor-musical-result__comparison">
			<label><input type="checkbox" checked={expanded} onChange={event => { setShowRemoved(event.target.checked); if (!event.target.checked && original) compare(false); }} />{copy.showRemoved}</label>
			<label><input type="checkbox" checked={original} onChange={event => compare(event.target.checked)} />{copy.listenOriginal}</label>
			<span role="status">{original ? copy.beforeEdit : copy.afterEdit}</span>
		</div>
		<div className="audio-editor-musical-result__track">
			<AudioTrackRuler track={rulerTrack} displayMode="waveform" bodyTop={60} bodyHeight={bodyHeight} width={40} channelCount={channels} channelHeightRatio={0.5}
				sampleRate={sampleRate} waveformRulerFormat="linear-db" waveformZoom={verticalZoom} copy={editorCopy} tabIndex={0}
				onWaveformZoom={value => { autoFit.current = false; setVerticalZoom(value); }}
				onOpenRulerFlyout={(_, event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY }); }} />
			<div ref={root} className="audio-editor-musical-result__viewport" role="group" aria-label={copy.resultWaveform} tabIndex="0"
				data-start-frame={view.startFrame} data-end-frame={view.endFrame} data-vertical-zoom={verticalZoom} data-original={original} data-show-removed={expanded}
				data-source-position={sourcePosition ?? ''} data-engine-position={playback.positionFrame} data-cut-start-frame={cut.start} data-cut-end-frame={cut.end}
				aria-busy={loading} {...navigation.handlers}
				onKeyDown={event => {
					if (event.code === 'Space') playPause();
					else if (event.key === '+' || event.key === '=') navigation.zoom(2);
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
				<div ref={canvasRoot} className="audio-editor-musical-result__waveforms" style={{ height: bodyHeight }}>
					{models.map(model => <div key={model.id} className="clip-body clip-body--blue" data-clip-id={model.id} data-color="blue"
						style={{ left: model.start * pixelsPerSecond, width: model.duration * pixelsPerSecond, opacity: model.removed && !original ? 0.45 : 1 }}>
						<canvas className="clip-body__waveform" aria-label={copy.resultWaveform} />
					</div>)}
					{data && <AudacityWaveformCanvases rootRef={canvasRoot} clips={models} displayMode="waveform" pixelsPerSecond={pixelsPerSecond}
						showRms verticalZoom={verticalZoom} channelHeightRatio={0.5} spectrogramOptions={{ sampleRate }} />}
				</div>
				{expanded && resume > 0 && marker < 100 && <div className="audio-editor-musical-result__removed" data-removed-audio="true"
					style={{ left: `${Math.max(0, marker)}%`, width: `${Math.min(100, resume) - Math.max(0, marker)}%` }}><span>{original ? copy.includedRegion : copy.skippedRegion}</span></div>}
				{marker >= 0 && marker <= 100 && <div className="audio-editor-musical-result__join" style={{ left: `${marker}%` }}><span>{expanded ? 'A' : copy.joinMarker}</span></div>}
				{expanded && resume >= 0 && resume <= 100 && <div className="audio-editor-musical-result__join" style={{ left: `${resume}%` }}><span>{'B'}</span></div>}
				{cursor !== null && cursor >= 0 && cursor <= 100 && <div className="audio-editor-musical-result__cursor" style={{ left: `${cursor}%` }} />}
				{loading && <div role="status" className="audio-editor-musical-result__loading">{copy.resultLoading}</div>}
			</div>
		</div>
		<div className="audio-editor-musical-result__navigation">
			<input type="range" aria-label={copy.navigateResult} min="0" max={Math.max(0, totalFrames - span)} value={view.startFrame} step="1"
				disabled={span >= totalFrames} onChange={event => navigation.pan(Number(event.target.value))} />
			<Button variant="secondary" onClick={() => { autoFit.current = false; setVerticalZoom(value => Math.max(0, value - 1)); }}>{copy.amplitudeOut}</Button>
			<Button variant="secondary" onClick={fitAmplitude}>{copy.fitAmplitude}</Button>
			<Button variant="secondary" onClick={() => { autoFit.current = false; setVerticalZoom(value => Math.min(10, value + 1)); }}>{copy.amplitudeIn}</Button>
		</div>
		<p className="audio-editor-musical-join__caption">{copy.resultHelp}</p>
		<ContextMenu isOpen={Boolean(menu)} x={menu?.x ?? 0} y={menu?.y ?? 0} onClose={() => setMenu(null)} autoFocus>
			<ContextMenuItem label={editorCopy.zoomIn} onClick={() => { autoFit.current = false; setVerticalZoom(value => Math.min(10, value + 1)); }} onClose={() => setMenu(null)} />
			<ContextMenuItem label={editorCopy.zoomOut} onClick={() => { autoFit.current = false; setVerticalZoom(value => Math.max(0, value - 1)); }} onClose={() => setMenu(null)} />
			<ContextMenuItem label={copy.fitAmplitude} onClick={fitAmplitude} onClose={() => setMenu(null)} />
		</ContextMenu>
		{error && <p role="alert" className="audio-editor-field-error">{error}</p>}
	</section>;
}
