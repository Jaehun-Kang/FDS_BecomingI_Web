# Transform experiments

Optional extension settings are isolated here. The default is disabled.
The popup stores a pixel-size multiplier; the web snapshots it per page load.
An explicit schedule updates BIB's experiment selection without changing the capture model.
The result job reports its actual processingSidelen back to the web app.
The animation uses that value and the same rectangular-grid calculation as
the Electron renderer. Existing/default rendering stays unchanged.

Pixel settings affect the next page reload, not running animations. Captures are retained.
Results are isolated by processing version; returning to a tested size can reuse its results.
Larger multipliers mean larger pixels. Range: 0.75 to 2; base edge: 144.

The auto-return checkbox is independent of pixel experiments and applies immediately.
Disabling it cancels the inactivity timer, but keeps the manual home button.
Enabling it starts a fresh inactivity period. The setting persists until restored.

The popup can copy timings from the active Becoming I tab. Reload the extension
and web page after installation. Collection starts when the page loads, survives
SPA navigation, and is reset by a reload. Only structured numeric timings and
job identifiers are kept, never image payloads or credentials. The buffer holds
at most 1000 records / 500000 characters and reports discarded records.
Bridge stages and renderer timings overlap; do not add them together.

Removal points:
- main.jsx: remove installExperimentSettings and its import/disposal.
- useProfileTransforms.js: remove experiment schedule options and resolution registration.
- Profile.jsx: replace getResultGrid with { sidelen: 128, gridWidth: 128, gridHeight: 128 }.
- Delete this folder.
- useInactivitySessionReset.js: remove the experiment subscription/guard.
- Profile.jsx: replace logProfileTiming calls with console.info.
- bridgeClient.js: remove recordBridgeTiming import/call.
- Extension: remove src/experiments plus action, storage/clipboardWrite permissions and adapter entry in manifest.json.
- Bridge: remove src/experiments integration from transform-service.js; remove optional
  processingSidelen handling from transform-renderer.js. Keep the mixed-face assets/fix.

No CSS compilation is required for the native extension popup.
