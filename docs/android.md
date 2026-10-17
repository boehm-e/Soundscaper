# Android application

This fork packages Soundscaper's browser editor with Capacitor 8. The web
application and its WASM/worker assets are bundled in the APK; it does not load
the editor from soundscaper.org. The desktop Electron build remains independent.
Android uses Web Audio, not the desktop native audio/plugin hosts.

## Touch editing

- Drag one finger across the waveform body to select a time range. Drag the
  clip's title strip to move the clip; its trim handles change its length.
- Move two fingers together to pan the timeline, or spread/pinch them to zoom.
  Adding the second finger cancels the pending one-finger edit.
- Turn off the highlighted **Clip gain** (envelope) or **Split tool** button
  before drawing a normal selection. These tools deliberately own waveform
  gestures while active.
- The **Selection** fields at the bottom allow precise start/end adjustment.

## Build locally

Requirements: Node.js 26.5.0, npm 12.0.1, a **JDK** 21 (not only a JRE), and the
Android SDK with platform 36 and build tools 36.0.0. Android Studio is optional.
Set `ANDROID_HOME` to the SDK directory and `JAVA_HOME` to the JDK directory.

```sh
npm ci
npm run test:android
npm run android:build
```

Install `android/app/build/outputs/apk/debug/app-debug.apk` on a device or
emulator. Minimum Android version: 8.0 (API 26), with Android System WebView
120 or newer. The currently verified emulator/API/WebView combination is
recorded in `.android-build/evidence/report.json`, not implied by the minimum.

`npm run android:sync` rebuilds the web application, stages a dedicated copy
under `.android-build/web`, and synchronizes Capacitor. `npm run android:open`
opens the native project in Android Studio. Re-run sync after web changes;
Gradle alone cannot rebuild the web assets.

## Continuous integration

`.github/workflows/android.yml` runs on pushes to `main`, `feat/android`,
`android/**`, Android tags, relevant pull requests, or a manual dispatch.
It tests the adapters, builds and lints a debug APK, uploads it, then exercises
the editor in a real Android emulator. The smoke test blocks remote requests,
opens microphone capture, imports and splits a WAV, checks playback and
persistence after reload, and exports through Android's document picker. Screenshots, a report, logcat, and the exported WAV are retained as
workflow artifacts. Run the same test locally with a connected emulator:

```sh
npm run android:smoke
```

The smoke test selects an emulator by default. To use a dedicated test device,
explicitly set `ANDROID_SERIAL` to its identifier; the test installs the debug
APK and creates local test projects and a WAV in Downloads. It never clears
application data.

## Automatic APK releases

After a trusted branch push (`main`, `feat/android`, or `android/**`), an
`android-v*` tag, or a manual dispatch, the workflow publishes a GitHub
**prerelease** only after adapter tests, APK compilation/lint, and the Android
WebView smoke test all succeed. Pull requests run validation without signing
secrets or release permissions. Manual dispatch can disable `publish_release`.

Each branch build gets its own `android-build-<run number>` tag targeting the
exact validated commit. Explicit `android-v*` tags retain their name. Download
the `.apk` from the Releases page to install; the `.aab` is a bundle, not a
sideloadable package. `SHA256SUMS` covers both artifacts. The publication job
checks the downloaded bytes before exposing the release; retries require the
existing tag to resolve to the same source commit.

Configure these repository secrets once:

- `ANDROID_KEYSTORE_BASE64`: base64-encoded keystore.
- `ANDROID_KEYSTORE_PASSWORD`: keystore password.
- `ANDROID_KEY_ALIAS`: signing alias.
- `ANDROID_KEY_PASSWORD`: signing key password.

Keep a private backup of this identity: future APKs need the same certificate
to update an existing installation without deleting its private projects. This
personal fork's preview pipeline uses the certificate of the locally installed
development APK for that compatibility. These are preview builds, not Google
Play production submissions. Use a dedicated production key and a planned
migration for a separate production distribution.

No private key is committed. Signing secrets are only available after the
emulator gate on trusted events, and the temporary keystore is removed even
when a step fails. The debug workflow artifact uses the runner's disposable
key; prefer the signed release APK for installation and updates. The workflow
does not publish to Google Play.

`ANDROID_VERSION_CODE` defaults to 1 locally and uses the workflow run number
in CI. Keep it increasing for local builds installed over a distributed APK:
for example, `ANDROID_VERSION_CODE=<latest release code> npm run android:build`.
The version name comes from `package.json`. This change requires no manual
**Update AI assets** run.

## Android integration and limits

- The app uses a stable `https://localhost` origin for IndexedDB/OPFS project
  storage. Clearing application data or uninstalling deletes private projects.
  Existing project export menus provide portable backups.
- Native file inputs use Capacitor's Android picker. Exports use
  `ACTION_CREATE_DOCUMENT` with no broad storage permission. Data crosses the
  bridge in bounded chunks and is staged in private cache before copying to the
  chosen document. Export requires temporary disk space; provider-copy failure
  can leave an incomplete destination and is reported to the editor.
- The microphone permission is declared and requested by Capacitor when Web
  Audio capture needs it. Recording/playback while the app is backgrounded or
  the screen is locked is not supported by a foreground audio service yet.
- Bundled responses retain the upstream CSP and COOP/COEP headers. WebView
  support for isolation/shared memory is device-dependent; unavailable optional
  parallel audio paths must retain the upstream fallback.
- Service-worker registration is skipped inside the APK: application updates
  replace the bundled assets. The normal web build retains its service worker.
- The upstream compact interface is reused. Small-screen editing and long,
  memory-intensive projects need device testing. Optional online assets,
  models and third-party integrations can still require a connection.
- Desktop-only native codecs, plugin hosts, MCP services, and assistance runtimes
  are not packaged for Android. This browser-shell addition does **not** require
  an **Update AI assets** run.

The AGPL-3.0-only license and third-party notices remain in the repository and
are copied into the bundled application. Keep corresponding source available
when distributing modified builds.
