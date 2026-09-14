import assert from "node:assert/strict";
import test from "node:test";
import { installExperimentSettings, getAutoReturnEnabled, subscribeExperimentSettings } from "../src/experiments/transformSettings.js";
test("auto-return changes immediately and diagnostics use a validated page handshake", () => {
  const previous = { window: globalThis.window, location: globalThis.location, localStorage: globalThis.localStorage };
  const storage = new Map();
  const messages = [];
  let receive;
  globalThis.location = { origin: "http://127.0.0.1:5174" };
  globalThis.localStorage = { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  globalThis.window = { addEventListener: (_, listener) => { receive = listener; }, removeEventListener: () => {}, postMessage: (message) => messages.push(message) };
  let notifications = 0;
  const unsubscribe = subscribeExperimentSettings(() => notifications++);
  const cleanup = installExperimentSettings();
  try {
    assert.equal(getAutoReturnEnabled(), true);
    const event = { source: window, origin: location.origin, data: { source: "becomingi-experiments", type: "SETTINGS", settings: { autoReturn: false } } };
    receive({ ...event, origin: "https://example.com" });
    assert.equal(getAutoReturnEnabled(), true);
    receive(event);
    assert.equal(getAutoReturnEnabled(), false);
    assert.equal(notifications, 1);
    receive({ ...event, data: { ...event.data, settings: { autoReturn: true } } });
    assert.equal(getAutoReturnEnabled(), true);
    receive({ ...event, data: { source: "becomingi-experiments", type: "EXPORT_PERFORMANCE", requestId: "check" } });
    assert.equal(messages.at(-1).requestId, "check");
    assert.match(messages.at(-1).text, /Becoming I performance log/);
  } finally {
    cleanup(); unsubscribe();
    Object.assign(globalThis, previous);
  }
});
