import { exportPerformanceLog } from "./performanceLog.js";
const key = "becomingi-experiments-v1";
const listeners = new Set();
export const subscribeExperimentSettings = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const readExperimentSettings = () => {
  try { return normalizeSettings(JSON.parse(localStorage.getItem(key))); }
  catch { return normalizeSettings(null); }
};
let liveAutoReturn;
export const getAutoReturnEnabled = () => liveAutoReturn ?? readExperimentSettings().autoReturn;
const sessions = new Map();
// Module lifetime matches a page load, not a profile route or modal lifetime.
const calculationRunId = globalThis.crypto.randomUUID();
let resolveInitialSettings;
let initialSettingsReceived = false;
const initialSettings = new Promise((resolve) => { resolveInitialSettings = resolve; });
export const waitForExperimentSettings = () => initialSettingsReceived ? Promise.resolve() :
  new Promise((resolve) => {
    const timer = setTimeout(resolve, 1200);
    initialSettings.then(() => { clearTimeout(timer); resolve(); });
  });
const results = new Map();
export const normalizeSettings = (value) => ({
  enabled: value?.enabled === true,
  autoReturn: value?.autoReturn !== false,
  pixelScale: Number.isFinite(value?.pixelScale) ? Math.max(0.75, Math.min(2, value.pixelScale)) : 1,
});
export const getSessionExperiment = (sessionId) => {
  if (!sessions.has(sessionId)) {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(key)); } catch { /* Use defaults. */ }
    sessions.clear();
    sessions.set(sessionId, { ...normalizeSettings(saved), calculationRunId });
  }
  return sessions.get(sessionId);
};
export const registerResultResolution = (url, sidelen, shape = "rectangular") => {
  if (url && Number.isInteger(sidelen) && sidelen >= 72 && sidelen <= 192) results.set(url, { sidelen, shape });
};
export const getResultResolution = (url) => results.get(url)?.sidelen ?? null;
export const getResultGrid = (url, width, height) => {
  const resolution = results.get(url);
  const sidelen = resolution?.sidelen ?? 128;
  const cellSize = Math.max(1, Math.max(width, height) / sidelen);
  return { sidelen,
    gridWidth: resolution?.shape === "rectangular" ? Math.max(32, Math.round(width / cellSize)) : sidelen,
    gridHeight: resolution?.shape === "rectangular" ? Math.max(32, Math.round(height / cellSize)) : sidelen };
};
export function installExperimentSettings() {
  const receive = (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== "becomingi-experiments") return;
    if (event.data.type === "EXPORT_PERFORMANCE" && typeof event.data.requestId === "string") {
      window.postMessage({ source: "becomingi-experiments-web", type: "PERFORMANCE_LOG",
        requestId: event.data.requestId, text: exportPerformanceLog(readExperimentSettings()) }, location.origin);
      return;
    }
    if (event.data.type !== "SETTINGS") return;
    const settings = normalizeSettings(event.data.settings);
    liveAutoReturn = settings.autoReturn;
    try { localStorage.setItem(key, JSON.stringify(settings)); } catch { /* Optional settings. */ }
    initialSettingsReceived = true;
    resolveInitialSettings();
    listeners.forEach((listener) => listener());
  };
  window.addEventListener("message", receive);
  window.postMessage({ source: "becomingi-experiments-web", type: "GET_SETTINGS" }, location.origin);
  return () => window.removeEventListener("message", receive);
}
