/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolveEditorCopyScope } from './editor-copy-scope.ts';

export const MUSICAL_CUTS_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze({
		title: "Find musical cuts",
		help: "Find matching musical sequences, audition a cut, then apply it. Analysis stays on this device.",
		track: "Audio track",
		scope: "Audio to analyze",
		entireTrack: "Entire track",
		selection: "Selected range",
		remove: "Duration to remove (seconds, optional)",
		fade: "Crossfade (milliseconds)",
		analyze: "Find cuts",
		cancel: "Cancel analysis",
		busy: "Analyzing music",
		preview: "Listen to the join",
		stop: "Stop preview",
		apply: "Apply this cut",
		previewFirst: "Listen to a proposal before applying it. Undo restores the cut. Later clips on this track move earlier.",
		caution: "Musical similarity does not detect lyrics or sentence boundaries. Always check the join by ear.",
		none: "No compatible cut found. Try another range or leave the duration empty.",
		pair: "Cut at {start}; resume at {end}",
		removed: "{duration} s removed · {context} s of matching context",
		section: "Near a possible section change",
		sections: "Possible section changes",
		rhythm: "Estimated beat interval: {seconds} s",
		errorTrack: "Choose an audio track.",
		errorRange: "Choose a valid time range and a positive duration to remove.",
		errorLength: "Analyze between 5 seconds and 10 minutes. Select a shorter range for longer tracks.",
		errorStale: "The project changed. Run the analysis again.",
		errorComplex: "Both endpoints need ordinary audio clips with room for the crossfade, without overlaps, groups, video links, loops or time warping. Try a shorter crossfade or render the track to a new track first.",
		errorEmpty: "This track has no audio clips.",
	}),
	de: Object.freeze({
		title: "Musikalische Schnitte finden",
		help: "Passende musikalische Folgen finden, den Schnitt anhören und anwenden. Die Analyse bleibt auf diesem Gerät.",
		track: "Audiospur",
		scope: "Analysebereich",
		entireTrack: "Ganze Spur",
		selection: "Ausgewählter Bereich",
		remove: "Zu entfernende Dauer (Sekunden, optional)",
		fade: "Überblendung (Millisekunden)",
		analyze: "Schnitte suchen",
		cancel: "Analyse abbrechen",
		busy: "Musik wird analysiert",
		preview: "Übergang anhören",
		stop: "Vorschau stoppen",
		apply: "Diesen Schnitt anwenden",
		previewFirst: "Einen Vorschlag vor dem Anwenden anhören. Rückgängig stellt den Schnitt wieder her. Spätere Clips dieser Spur rücken vor.",
		caution: "Musikalische Ähnlichkeit erkennt keine Liedtexte oder Satzgrenzen. Den Übergang immer anhören.",
		none: "Kein passender Schnitt gefunden. Anderen Bereich wählen oder die Dauer leer lassen.",
		pair: "Bei {start} schneiden; bei {end} fortsetzen",
		removed: "{duration} s entfernt · {context} s ähnlicher Kontext",
		section: "Nahe einem möglichen Abschnittswechsel",
		sections: "Mögliche Abschnittswechsel",
		rhythm: "Geschätzter Schlagabstand: {seconds} s",
		errorTrack: "Eine Audiospur wählen.",
		errorRange: "Gültigen Zeitbereich und positive Dauer wählen.",
		errorLength: "Zwischen 5 Sekunden und 10 Minuten analysieren. Für längere Spuren einen kürzeren Bereich wählen.",
		errorStale: "Das Projekt wurde geändert. Die Analyse erneut starten.",
		errorComplex: "Beide Schnittpunkte benötigen normale Audioclips mit Platz für die Überblendung, ohne Überlagerungen, Gruppen, Videoverknüpfungen, Loops oder Zeitverzerrung. Kürzere Überblendung wählen oder die Spur zuerst in eine neue Spur rendern.",
		errorEmpty: "Diese Spur enthält keine Audioclips.",
	}),
});

export function resolveMusicalCutsCopy(copy: Readonly<Record<string, string>> = {}) {
	const scoped: Record<string, string> = {};
	for (const key of Object.keys(MUSICAL_CUTS_COPY_BY_LOCALE.en)) {
		const name = `ui.musicalCuts.${key}`;
		if (typeof copy[name] === 'string') scoped[name] = copy[name];
	}
	return resolveEditorCopyScope('musicalCuts', MUSICAL_CUTS_COPY_BY_LOCALE.en, scoped);
}
