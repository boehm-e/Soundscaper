# Android application

This fork packages Soundscaper's browser editor with Capacitor 8. The web
application and its WASM/worker assets are bundled in the APK; it does not load
the editor from soundscaper.org. The desktop Electron build remains independent.
Android uses Web Audio, not the desktop native audio/plugin hosts.

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

The debug APK is signed with the runner's disposable debug key. It is suitable
for testing; different runners may require uninstalling a previous debug build
before installation, which deletes that installation's private projects. Export
projects before uninstalling. Use a stable release key for ongoing distribution.

For signed release APK/AAB artifacts, manually dispatch **Android APK** with
`signed_release` enabled and configure these repository secrets:

- `ANDROID_KEYSTORE_BASE64`: base64-encoded release keystore.
- `ANDROID_KEYSTORE_PASSWORD`: keystore password.
- `ANDROID_KEY_ALIAS`: signing alias.
- `ANDROID_KEY_PASSWORD`: signing key password.

No release key is generated or committed by this fork. The workflow removes its
temporary keystore even on failure. It does not publish to Google Play or create
a public GitHub Release. `ANDROID_VERSION_CODE` defaults to 1 locally and uses
the workflow run number in CI; maintain a monotonically increasing value when
changing workflows or distributing updates. The version name comes from
`package.json`.

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
