/* SPDX-License-Identifier: AGPL-3.0-only */

export const musicalCutTime = seconds => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
const width = 600, height = 72;
const clamp = value => Math.max(0, Math.min(1, value));
function peak(waveforms) {
	return Math.max(0.001, ...waveforms.filter(Boolean).flatMap(wave => [...wave.maximum, ...wave.minimum.map(Math.abs)]));
}
function wavePath(wave, offset, span, scale) {
	if (!wave?.maximum.length) return '';
	const y = amplitude => (height / 2 - amplitude / scale * (height / 2 - 4)).toFixed(2);
	const x = index => (offset + index / Math.max(1, wave.maximum.length - 1) * span).toFixed(2);
	return `M${x(0)},${y(0)} ${wave.maximum.map((value, index) => `L${x(index)},${y(value)}`).join(' ')} `
		+ wave.minimum.map((_, index) => wave.minimum.length - index - 1).map(index => `L${x(index)},${y(wave.minimum[index])}`).join(' ') + ' Z';
}

/** Every proposal uses the same source scale, so its red span is directly comparable. */
export function MusicalCutSourceTimeline({ waveform, candidate, rangeStart, phrases, copy }) {
	if (!waveform?.durationSeconds) return null;
	const a = clamp((candidate.startSeconds - rangeStart) / waveform.durationSeconds);
	const b = clamp((candidate.endSeconds - rangeStart) / waveform.durationSeconds);
	return <span className="audio-editor-musical-timeline audio-editor-musical-timeline--source" aria-hidden="true">
		<svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
			<path className="audio-editor-musical-timeline__wave" d={wavePath(waveform, 0, width, peak([waveform]))} />
			<rect className="audio-editor-musical-timeline__removed" x={a * width} y="0" width={Math.max(1, (b - a) * width)} height={height} />
			{phrases?.boundaries.map(point => <line key={point.seconds} className="audio-editor-musical-timeline__phrase"
				x1={(point.seconds - rangeStart) / waveform.durationSeconds * width} x2={(point.seconds - rangeStart) / waveform.durationSeconds * width} y1="0" y2={height} />)}
			<line className="audio-editor-musical-timeline__marker" x1={a * width} x2={a * width} y1="0" y2={height} />
			<line className="audio-editor-musical-timeline__marker" x1={b * width} x2={b * width} y1="0" y2={height} />
		</svg>
		<span className="audio-editor-musical-timeline__pin" style={{ left: `${a * 100}%` }}>{b - a < 0.06 ? copy.combinedMarkers : 'A'}</span>
		{b - a >= 0.06 && <span className="audio-editor-musical-timeline__pin" style={{ left: `${b * 100}%` }}>{'B'}</span>}
		<span className="audio-editor-musical-timeline__axis"><span>{musicalCutTime(rangeStart)}</span><span>{copy.removedArea}</span><span>{musicalCutTime(rangeStart + waveform.durationSeconds)}</span></span>
	</span>;
}
