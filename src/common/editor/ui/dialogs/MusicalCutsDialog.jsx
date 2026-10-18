/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { resolveSelectionRange } from '../../selection-range.ts';
import { formatLocalizedTemplate as format } from '../localization-template.ts';
import { resolveMusicalCutsCopy } from '../../../i18n/editor-musical-cuts-copy.ts';
import { MusicalCutSourceTimeline, musicalCutTime as time } from './MusicalCutTimeline.jsx';
import MusicalCutResultTrack from './MusicalCutResultTrack.jsx';
import { sortMusicalCuts, musicalCutRank } from '../../musical-cut-ranking.ts';
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
	const [tolerance, setTolerance] = useState('5');
	const [sort, setSort] = useState(/** @returns {import('../../musical-cut-ranking.ts').MusicalCutSort} */ () => 'music');
	const [fade, setFade] = useState('20');
	const [ready, setReady] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(true);
	const [pending, setPending] = useState(null);
	const [progress, setProgress] = useState(0);
	const [result, setResult] = useState(null);
	const [selected, setSelected] = useState(0);
	const [heard, setHeard] = useState(null);
	const [seekFrame, setSeekFrame] = useState(null);
	const [transport, setTransport] = useState(null);
	const [error, setError] = useState('');
	const session = useRef(null);
	const operation = useRef(null);
	const rangeAvailable = selection && (!selection.trackIds.length || selection.trackIds.includes(trackId));
	const blocked = !ready || !snapshot.ready || snapshot.importing || snapshot.recording || snapshot.exporting || project?.readOnly;
	const candidate = result?.candidates[selected];
	const proposals = useMemo(() => sortMusicalCuts(result?.candidates ?? [], sort), [result, sort]);
	const hasDuration = result?.candidates.some(cut => cut.durationScore !== null);
	const validTolerance = tolerance.trim() !== '' && Number.isFinite(Number(tolerance)) && Number(tolerance) >= 0 && Number(tolerance) <= 600;
	const validRemove = remove.trim() === '' || (Number.isFinite(Number(remove)) && Number(remove) > 0);
	const showError = cause => {
		const key = typeof cause?.code === 'string' ? `error${cause.code[0].toUpperCase()}${cause.code.slice(1)}` : '';
		setError(messages[key] || cause?.message || copy.audioAnalysisFailed);
	};
	useEffect(() => {
		let closed = false;
		void controller.actions.analysis.createMusicalCutsSession().then(value => {
			if (closed) value.dispose();
			else { session.current = value; setTransport(value.createTransport()); setReady(true); }
		}).catch(cause => { if (!closed) showError(cause); });
		return () => {
			closed = true; operation.current?.abort(); session.current?.dispose(); session.current = null;
		};
	// The session belongs to the active project and captures each analysis revision itself.
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [controller, project?.id]);
	useEffect(() => {
		operation.current?.abort(); transport?.stop(); setHeard(null); setResult(null);
	}, [project?.id, project?.revision, transport]);
	const stop = () => { transport?.stop(); };
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
		if (blocked || pending || !validRemove || (remove.trim() !== '' && !validTolerance) || !trackId) return;
		setHeard(null); setSeekFrame(null); setResult(null); setProgress(0);
		void perform('analysis', async signal => {
			controller.actions.transport.stop();
			const value = await session.current.analyze({ trackId,
				range: scope === 'selection' && rangeAvailable ? selection : undefined,
				removeSeconds: remove.trim() === '' ? undefined : Number(remove),
				toleranceSeconds: remove.trim() === '' ? undefined : Number(tolerance),
			}, signal, value => { if (!signal.aborted) setProgress(value); });
			if (!signal.aborted) { setResult(value); setSelected(0); if (remove.trim() === '') setSort('music'); setSettingsOpen(!value.candidates.length); }
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
				<label>{messages.tolerance}<input type="number" min="0" max="600" step="0.1" inputMode="decimal" value={tolerance}
					disabled={Boolean(pending) || remove.trim() === ''} onChange={event => { setTolerance(event.target.value); invalidate(); }} aria-invalid={remove.trim() !== '' && !validTolerance} /></label>
				<label>{messages.fade}<select value={fade} disabled={Boolean(pending)} onChange={event => { setFade(event.target.value); stop(); setHeard(null); }}>
					{[0, 5, 10, 20, 50, 100].map(value => <option key={value} value={value}>{`${value} ms`}</option>)}
				</select></label>
			</div>
			<p className="audio-editor-panel-hint">{messages.toleranceHelp}</p>
			<div className="audio-editor-musical-cuts__actions">
				<Button disabled={blocked || Boolean(pending) || !trackId || !validRemove || (remove.trim() !== '' && !validTolerance)} onClick={analyze}>{messages.analyze}</Button>
			</div>
			</details>
			{pending && <div role="status">{pending === 'analysis' ? messages.busy : copy.analysisRendering}
				{pending === 'analysis' && <progress max="1" value={progress} aria-label={messages.busy} />}</div>}
			{pending && <Button variant="secondary" onClick={() => operation.current?.abort()}>{messages.cancel}</Button>}
			{result && <>
				{candidate && <>
					<MusicalCutResultTrack key={`${candidate.startSeconds}-${candidate.endSeconds}-${fade}`} session={session.current}
						candidate={candidate} fadeMs={Number(fade)} result={result} copy={messages} editorCopy={copy} seekFrame={seekFrame} transport={transport} blocked={blocked || Boolean(pending)} onAudition={() => setHeard({ candidate, fade })}
						onSeek={setSeekFrame} />
					<div className="audio-editor-musical-cuts__actions">
						<Button disabled={blocked || Boolean(pending) || heard?.candidate !== candidate || heard?.fade !== fade} onClick={apply}>{messages.apply}</Button>
					</div>
				</>}
				{!result.candidates.length && <p role="status">{messages.none}</p>}
				{Boolean(result.candidates.length) && <><label className="audio-editor-musical-cuts__sort">{messages.sort}<select value={sort} onChange={event => setSort(event.target.value === 'duration' ? 'duration' : event.target.value === 'average' ? 'average' : 'music')}>
					<option value="music">{messages.sortMusic}</option>
					<option value="duration" disabled={!hasDuration}>{messages.sortDuration}</option>
					<option value="average" disabled={!hasDuration}>{messages.sortAverage}</option>
				</select></label>
				<p className="audio-editor-panel-hint">{hasDuration ? messages.scoreHelp : messages.noDurationScore}</p></>}
				<fieldset className="audio-editor-musical-cuts__proposals" disabled={Boolean(pending)}>
					<legend>{messages.proposals}</legend>
					{proposals.map(cut => <label key={`${cut.startSeconds}-${cut.endSeconds}`} className="audio-editor-musical-cuts__proposal">
						<input type="radio" name="musical-cut-proposal" checked={candidate === cut} onChange={() => { setSelected(result.candidates.indexOf(cut)); stop(); setHeard(null); setSeekFrame(null); setError(''); }} />
						<span><strong>{format(messages.pair, { start: time(cut.startSeconds), end: time(cut.endSeconds) })}</strong>
							<MusicalCutSourceTimeline waveform={result.waveform} candidate={cut} rangeStart={result.range.startFrame / result.sampleRate} copy={messages} />
							<small className="audio-editor-musical-cuts__scores">
								<span>{format(messages.musicScore, { score: cut.musicScore.toFixed(1) })}</span>
								<span>{format(messages.durationScore, { score: cut.durationScore === null ? '—' : cut.durationScore.toFixed(1) })}</span>
								{cut.durationScore !== null && <span>{format(messages.averageScore, { score: musicalCutRank(cut, 'average').toFixed(1) })}</span>}
							</small>
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
