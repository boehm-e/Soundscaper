/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { resolveSelectionRange } from '../../selection-range.ts';
import { createMusicalCutAudition } from '../../controller/analysis/musical-cut-audition.ts';
import { formatLocalizedTemplate as format } from '../localization-template.ts';
import { resolveMusicalCutsCopy } from '../../../i18n/editor-musical-cuts-copy.ts';
import { MusicalCutSourceTimeline, musicalCutTime as time } from './MusicalCutTimeline.jsx';
import MusicalCutResultTrack from './MusicalCutResultTrack.jsx';
import './musical-cuts-dialog.css';

export default function MusicalCutsDialog({ controller, snapshot, copy, onClose }) {
	const messages = useMemo(() => resolveMusicalCutsCopy(copy), [copy]);
	const project = snapshot.project;
	const tracks = project?.tracks.filter(track => track.type === 'audio') ?? [];
	const [selection] = useState(() => resolveSelectionRange(project, { selectedClipId: snapshot.selectedClipId }));
	const [trackId, setTrackId] = useState(() => tracks.find(track => track.id === snapshot.selectedTrackId)?.id
		|| tracks.find(track => selection?.trackIds.includes(track.id))?.id || tracks[0]?.id || '');
	const [scope, setScope] = useState(selection ? 'selection' : 'track');
	const [remove, setRemove] = useState('');
	const [fade, setFade] = useState('20');
	const [ready, setReady] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(true);
	const [pending, setPending] = useState(null);
	const [progress, setProgress] = useState(0);
	const [result, setResult] = useState(null);
	const [selected, setSelected] = useState(0);
	const [heard, setHeard] = useState(null);
	const [seekFrame, setSeekFrame] = useState(null);
	const [playing, setPlaying] = useState(false);
	const [error, setError] = useState('');
	const session = useRef(null);
	const operation = useRef(null);
	const audition = useMemo(() => createMusicalCutAudition({ createContext: () => new AudioContext(), onEnded: () => setPlaying(false) }), []);
	const rangeAvailable = selection && (!selection.trackIds.length || selection.trackIds.includes(trackId));
	const blocked = !ready || !snapshot.ready || snapshot.importing || snapshot.recording || snapshot.exporting || project?.readOnly;
	const candidate = result?.candidates[selected];
	const validRemove = remove.trim() === '' || (Number.isFinite(Number(remove)) && Number(remove) > 0);
	const validFade = Number.isFinite(Number(fade)) && Number(fade) >= 0 && Number(fade) <= 100;
	const showError = cause => {
		const key = typeof cause?.code === 'string' ? `error${cause.code[0].toUpperCase()}${cause.code.slice(1)}` : '';
		setError(messages[key] || cause?.message || copy.audioAnalysisFailed);
	};
	useEffect(() => {
		let closed = false;
		void controller.actions.analysis.createMusicalCutsSession().then(value => {
			if (closed) value.dispose();
			else { session.current = value; setReady(true); }
		}).catch(cause => { if (!closed) showError(cause); });
		return () => {
			closed = true; operation.current?.abort(); session.current?.dispose(); session.current = null;
		};
	// The session belongs to the active project and captures each analysis revision itself.
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [controller, project?.id]);
	useEffect(() => () => audition.dispose(), [audition]);
	useEffect(() => {
		operation.current?.abort(); audition.stop(); setPlaying(false); setHeard(null); setResult(null);
	}, [project?.id, project?.revision, audition]);
	const stop = () => { audition.stop(); setPlaying(false); };
	const invalidate = () => { stop(); setResult(null); setHeard(null); setSeekFrame(null); setError(''); };
	const perform = async (kind, action) => {
		operation.current?.abort();
		const abort = new AbortController(); operation.current = abort;
		stop(); setError(''); setPending(kind);
		try { await action(abort.signal); }
		catch (cause) { if (!abort.signal.aborted && cause?.name !== 'AbortError') showError(cause); }
		finally { if (operation.current === abort) { operation.current = null; setPending(null); } }
	};
	const analyze = () => {
		if (blocked || pending || !validRemove || !trackId) return;
		setHeard(null); setSeekFrame(null); setResult(null); setProgress(0);
		void perform('analysis', async signal => {
			controller.actions.transport.stop();
			const value = await session.current.analyze({ trackId,
				range: scope === 'selection' && rangeAvailable ? selection : undefined,
				removeSeconds: remove.trim() === '' ? undefined : Number(remove),
			}, signal, value => { if (!signal.aborted) setProgress(value); });
			if (!signal.aborted) { setResult(value); setSelected(0); setSettingsOpen(!value.candidates.length); }
		});
	};
	const listen = () => {
		if (blocked || pending || !candidate || !validFade) return;
		// Resume in the tap's activation, before async rendering (required by Android WebView).
		const unlock = audition.unlock();
		void perform('preview', async signal => {
			controller.actions.transport.stop();
			await unlock;
			const pcm = await session.current.preview(candidate, Number(fade), signal, seekFrame === null ? undefined : seekFrame / result.sampleRate);
			if (!signal.aborted) {
				audition.play(pcm); setPlaying(true);
				setHeard({ candidate, fade, startSeconds: pcm.startSeconds });
			}
		});
	};
	const apply = () => {
		if (blocked || pending || !candidate || heard?.candidate !== candidate || heard?.fade !== fade) return;
		try {
			stop(); session.current.apply(candidate, Number(fade), command => controller.actions.edit.commit(command)); onClose();
		} catch (cause) { showError(cause); }
	};
	return <AudioEditorDialogShell title={messages.title} onClose={onClose} width={960} closeOnOutside={false}>
		<div className="audio-editor-musical-cuts">
			<p>{result?.candidates.length ? messages.visualHelp : messages.help}</p>
			<details className="audio-editor-musical-cuts__settings" open={settingsOpen} onToggle={event => setSettingsOpen(event.currentTarget.open)}>
				<summary>{messages.settings}</summary>
			<div className="audio-editor-musical-cuts__fields">
				<label>{messages.track}<select value={trackId} disabled={Boolean(pending)} onChange={event => {
					setTrackId(event.target.value); setScope('track'); invalidate();
				}}>{tracks.map(track => <option key={track.id} value={track.id}>{track.name}</option>)}</select></label>
				<label>{messages.scope}<select value={scope} disabled={Boolean(pending)} onChange={event => { setScope(event.target.value); invalidate(); }}>
					<option value="track">{messages.entireTrack}</option>
					{rangeAvailable && <option value="selection">{messages.selection} ({time(selection.startFrame / project.sampleRate)}–{time(selection.endFrame / project.sampleRate)})</option>}
				</select></label>
				<label>{messages.remove}<input type="number" min="0.1" step="0.1" inputMode="decimal" value={remove}
					disabled={Boolean(pending)} onChange={event => { setRemove(event.target.value); invalidate(); }} aria-invalid={!validRemove} /></label>
				<label>{messages.fade}<select value={fade} disabled={Boolean(pending)} onChange={event => { setFade(event.target.value); stop(); setHeard(null); }}>
					{[0, 5, 10, 20, 50, 100].map(value => <option key={value} value={value}>{`${value} ms`}</option>)}
				</select></label>
			</div>
			<div className="audio-editor-musical-cuts__actions">
				<Button disabled={blocked || Boolean(pending) || !trackId || !validRemove} onClick={analyze}>{messages.analyze}</Button>
			</div>
			</details>
			{pending && <div role="status">{pending === 'analysis' ? messages.busy : copy.analysisRendering}
				{pending === 'analysis' && <progress max="1" value={progress} aria-label={messages.busy} />}</div>}
			{pending && <Button variant="secondary" onClick={() => operation.current?.abort()}>{messages.cancel}</Button>}
			{result && <>
				{candidate && <>
					<MusicalCutResultTrack key={`${candidate.startSeconds}-${candidate.endSeconds}-${fade}`} session={session.current}
						candidate={candidate} fadeMs={Number(fade)} result={result} copy={messages} seekFrame={seekFrame}
						onSeek={frame => { stop(); setSeekFrame(frame); }} playing={playing} audition={audition} playbackStart={heard?.startSeconds ?? 0} />
					<div className="audio-editor-musical-cuts__actions">
						<Button variant="secondary" disabled={blocked || Boolean(pending)} onClick={playing ? stop : listen}>{playing ? messages.stop : seekFrame === null ? messages.preview : messages.listenFrom}</Button>
						<Button disabled={blocked || Boolean(pending) || heard?.candidate !== candidate || heard?.fade !== fade} onClick={apply}>{messages.apply}</Button>
					</div>
				</>}
				{!result.candidates.length && <p role="status">{messages.none}</p>}
				<fieldset className="audio-editor-musical-cuts__proposals" disabled={Boolean(pending)}>
					<legend>{messages.proposals}</legend>
					{result.candidates.map((cut, index) => <label key={`${cut.startSeconds}-${cut.endSeconds}`} className="audio-editor-musical-cuts__proposal">
						<input type="radio" name="musical-cut-proposal" checked={selected === index} onChange={() => { setSelected(index); stop(); setHeard(null); setSeekFrame(null); setError(''); }} />
						<span><strong>{format(messages.pair, { start: time(cut.startSeconds), end: time(cut.endSeconds) })}</strong>
							<MusicalCutSourceTimeline waveform={result.waveform} candidate={cut} rangeStart={result.range.startFrame / result.sampleRate} copy={messages} />
							<small>{format(messages.removed, { duration: (cut.endSeconds - cut.startSeconds).toFixed(2), context: cut.matchingSeconds.toFixed(1) })}</small>
							{cut.nearSection && <small>{messages.section}</small>}</span>
					</label>)}
				</fieldset>
				{result.sectionSeconds.length > 0 && <details><summary>{messages.sections}</summary>
					<p>{result.sectionSeconds.map(time).join(' · ')}</p>
					{result.beatSeconds && <p>{format(messages.rhythm, { seconds: result.beatSeconds.toFixed(2) })}</p>}
				</details>}
			</>}
			{error && <p role="alert" className="audio-editor-field-error">{error}</p>}
			<p className="audio-editor-panel-hint">{messages.previewFirst}</p>
			<p className="audio-editor-panel-hint">{messages.caution}</p>
		</div>
	</AudioEditorDialogShell>;
}
