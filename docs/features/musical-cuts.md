# Musical cut suggestions

Open **Analyze → Find musical cuts**. Choose an audio track and either its full
timeline span or the selection captured when the dialog opened. An optional
duration and its ± tolerance filter suggestions to an explicit removal range (default ±5 seconds; zero requires the target on the 50 ms analysis grid). Listen with the editor’s
play/pause/stop controls, compare the original and the cut, then apply. One Undo restores the entire edit. Later clips on that
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
Ctrl/Command-wheel zooms around the pointer. **Join** centers the cut and returns the playhead two seconds before it; **Whole
track** fits the complete result. The same amplitude ruler and waveform painter
as the main timeline magnify quiet audio automatically on first display. Amplitude
zoom and **Fit waveform height** change only the display, never playback gain.

**Show removed section** keeps A–B on the original time axis as a grey, hatched
region. Retained material is drawn from the exact edited render on either side;
the grey material is drawn from the original. **Play removed section (original)**
compares the unedited track with the edited one, keeping the corresponding source
position when switched during playback. The result playhead skips A–B when this
option is off. Hiding the grey section restores the compact result timeline.

The standard green play/pause button, stop and jump-to-start buttons use the
editor's normal streaming engine in a dialog-owned instance. Playback continues
through the track; it is not limited to a four-second buffer. It shares listening
volume, output routing and source caches with the editor. Touching the waveform
seeks, and space toggles play/pause while it is focused. Closing cancels preparation,
releases the engine and leaves the real project untouched. Analysis settings
collapse to give the track room.

The dialog works with ordinary buttons, radio cards and native selects, including
touch and pen input in the Android WebView. Its controls have at least 44-pixel
targets. Opening it does not change the timeline selection. Analysis never
uploads audio or downloads models.

Each proposal displays separate **Music** and **Duration** indices out of 100, plus
their arithmetic average when a target exists. Music is `100 × (1 − musical cost)`,
clamped to 0–100; that cost combines sequence distance, beat alignment and section
proximity without any duration penalty. Duration is 100 at the target and falls
quadratically to 80 at the selected tolerance boundary (`100 − 20 × (error / tolerance)²`). This keeps accepted duration indices on a scale comparable to musical compatibility, instead of overwhelming the average with a 0–100 range. These are heuristic comparison
indices, not probabilities or a guarantee of an inaudible join. Without a target,
the duration index is unavailable and only musical sorting is enabled.

**Sort proposals by** reorders by musical compatibility, duration match or their
equal-weight average without analyzing again or changing the selected proposal.
The bounded search retains contenders for all three orderings, including during
intermediate pruning, rather than sorting only the musical top twelve.

Waveform rendering has a dialog-local LRU cache: up to 4 MiB / 128 completed
windows and 24 MiB / 64 full-rate PCM blocks, separately bounded. Aligned eight-second
blocks can be reused across overlapping pan/zoom windows; tiny uncached sample
views render only their requested interval. Completed views remain cached even
after PCM eviction. Original material is shared between proposals; edited data
is keyed by cut endpoints and crossfade. Only completed, current renders enter
the cache. Analysis restart, apply, project invalidation or closing clears it.
A first uncached view still requires rendering; revisits can reuse those results.

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
and proximity to possible section changes. The optional duration is a separate filter and index.
Section changes are coarse novelty peaks, not semantic verse/chorus labels or a
hierarchical segmentation. Standard search retains at most 900 anchors. **Deep search** retains those same
anchors plus a denser grid (up to 6,000 points total), then refines the best diverse
proposals within ±250 ms at the native 50 ms feature resolution. It improves
coverage; it does not infer vocal phrase boundaries.

Search groups pairs by their time separation. Duration bounds and beat-phase
rejections apply before visiting endpoints. Four rolling context sums reuse
neighboring sequence comparisons, and precomputed logarithmic levels avoid
per-comparison logarithms. Memory stays bounded by features, a per-lag rolling
window and the shortlist; it
does not allocate a full sample-by-sample or frame-by-frame recurrence matrix.

This independent implementation draws on the sequence-comparison motivation in
[Plachouras and Miron, ICASSP 2023](https://arxiv.org/html/2305.07347v1). It does
not implement their full hierarchical segmentation, learned embeddings, downbeat
tracking or optimal multi-transition path search. No source or models from
[music-rearranger](https://github.com/chrispla/music-rearranger) are bundled;
that repository has separate licenses, including a noncommercial restriction.

Deep search extracts FFT features once in a dedicated worker. Search uses two
workers on devices reporting at least four logical cores when the estimated search is large enough. Smaller searches finish in the preparation worker, avoiding extra startup and feature-copy overhead. Devices with fewer cores always use one. Only the
compact feature representation is copied to each search worker; downsampled track
PCM is transferred once. Workers receive interleaved time-separation partitions;
their bounded shortlists are merged before a final worker refines endpoints.
Cancellation or a shard failure terminates all active peers. Standard search
keeps its single-worker path. No SharedArrayBuffer, server, model download or
cross-origin isolation is required.

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
and renders, stops preview playback and closes its audio context. The playback context is unlocked directly from a tap before asynchronous
cache preparation, as required by mobile autoplay policy. **Update AI assets is not required.**
