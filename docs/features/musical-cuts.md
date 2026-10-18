# Musical cut suggestions

Open **Analyze → Find musical cuts**. Choose an audio track and either its full
timeline span or the selection captured when the dialog opened. An optional
duration filters suggestions to nearby removal lengths. Listen to the four-second
join preview, then apply. One Undo restores the entire edit. Later clips on that
track ripple earlier; other tracks retain their timing.

Each proposal shows the source waveform on a common timeline scale. Its red span
is the part to remove, bracketed by markers A and B. Selecting one opens a detached
result track with the same Audacity waveform painter and timeline ruler as the
main editor, including separate stereo channels, min/max/RMS and individual
samples at high zoom. The A → B marker stays at the actual join. The renderer
calculates only the visible result window in eight-second chunks; overview
min/max/RMS storage is bounded by the viewport width, and sample zoom retains
exact PCM. No audio from the real project is changed by this preview.

Pinch or use + / − to zoom, drag to pan, or use the horizontal navigation slider.
Ctrl/Command-wheel zooms around the pointer. **Join** centers four seconds around
the cut; **Whole track** fits the complete result. Tap with a finger or pen to
place the preview cursor, then listen to up to four seconds from there. Without a
cursor, listening starts two seconds before the join. Playback shows a moving
cursor. Analysis settings collapse to give the track room.

The dialog works with ordinary buttons, radio cards and native selects, including
touch and pen input in the Android WebView. Its controls have at least 44-pixel
targets. Opening it does not change the timeline selection. Analysis never
uploads audio or downloads models.

## Analysis

`musical-cuts-session.ts` renders the chosen track in eight-second chunks, retaining
only 8 kHz stereo analysis planes. The selected range is limited to 5 seconds–10
minutes. A dedicated, cancellable worker calculates Hann-windowed spectra,
normalized pitch-class chroma, spectral bands, energy and onset flux. Stereo
channels contribute spectral power separately, so opposite polarity does not
erase the signal. Onset autocorrelation estimates a beat interval when supported
by the signal; this is not a downbeat or meter detector.

Candidates compare sequences before and after both endpoints, covering four
estimated beats on each side (two seconds per side without a beat estimate).
Ranking combines harmonic/timbral/level similarity, beat-phase consistency,
proximity to possible section changes and the optional duration constraint.
Section changes are coarse novelty peaks, not semantic verse/chorus labels or a
hierarchical segmentation. Search has bounded anchors and shortlist memory; it
does not allocate a full sample-by-sample or frame-by-frame recurrence matrix.

This independent implementation draws on the sequence-comparison motivation in
[Plachouras and Miron, ICASSP 2023](https://arxiv.org/html/2305.07347v1). It does
not implement their full hierarchical segmentation, learned embeddings, downbeat
tracking or optimal multi-transition path search. No source or models from
[music-rearranger](https://github.com/chrispla/music-rearranger) are bundled;
that repository has separate licenses, including a noncommercial restriction.

## Applying and previewing

`musical-cut-edit.ts` prepares an existing ripple-delete command and optional
source-handle extensions for a centered equal-power crossfade. The overlapping
halves preserve the displayed removal duration exactly. The original source
remains intact. The preview renders that exact command against a detached project,
with authored track processing, before the identical batch is committed.

The apply path requires each endpoint inside an ordinary audio clip with enough
source context; the endpoints can belong to different clips on the same track.
It refuses overlaps, groups, linked video, reversed
or time-warped clips and loops; render those tracks to a new track first. It does
not repair lyrics, infer sentence boundaries, guarantee an inaudible join, or
optimize a complete multi-cut arrangement. Always audition the proposal.

The dialog-scoped session checks the project generation and revision after each
asynchronous render and before applying. Closing the dialog cancels its worker
and renders, stops preview playback and closes its audio context. The preview
context is unlocked directly from a tap before asynchronous rendering, as required
by mobile autoplay policy. **Update AI assets is not required.**
