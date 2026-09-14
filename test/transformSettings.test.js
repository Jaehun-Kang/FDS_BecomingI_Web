import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSettings, registerResultResolution, getResultGrid } from "../src/experiments/transformSettings.js";
test("default rendering stays unchanged, experiments use the result grid", () => {
  assert.deepEqual(getResultGrid("default", 400, 200), { sidelen: 128, gridWidth: 128, gridHeight: 128 });
  registerResultResolution("wide", 144);
  assert.deepEqual(getResultGrid("wide", 400, 200), { sidelen: 144, gridWidth: 144, gridHeight: 72 });
  assert.deepEqual(getResultGrid("wide", 200, 400), { sidelen: 144, gridWidth: 72, gridHeight: 144 });
  registerResultResolution("fallback", 96, "square");
  assert.deepEqual(getResultGrid("fallback", 400, 200), { sidelen: 96, gridWidth: 96, gridHeight: 96 });
  registerResultResolution("bad", 99999);
  assert.equal(getResultGrid("bad", 400, 200).sidelen, 128);
});
test("invalid experimental settings are clamped or defaulted", () => {
  assert.deepEqual(normalizeSettings(null), { enabled: false, pixelScale: 1, autoReturn: true });
  assert.equal(normalizeSettings({ autoReturn: false }).autoReturn, false);
  assert.equal(normalizeSettings({ enabled: true, pixelScale: Infinity }).pixelScale, 1);
  assert.equal(normalizeSettings({ pixelScale: 100 }).pixelScale, 2);
});

test("pixel settings stay stable on a page but reload applies changes to the same session", async () => {
  const previous = globalThis.localStorage;
  let settings = { enabled: true, pixelScale: 1.5 };
  globalThis.localStorage = { getItem: () => JSON.stringify(settings) };
  try {
    const page = await import("../src/experiments/transformSettings.js?page-test=1");
    assert.equal(page.getSessionExperiment("same-capture").pixelScale, 1.5);
    const runId = page.getSessionExperiment("same-capture").calculationRunId;
    assert.ok(runId);
    settings = { enabled: true, pixelScale: 2 };
    assert.equal(page.getSessionExperiment("same-capture").pixelScale, 1.5);
    assert.equal(page.getSessionExperiment("same-capture").calculationRunId, runId);
    const reloadedPage = await import("../src/experiments/transformSettings.js?page-test=2");
    assert.equal(reloadedPage.getSessionExperiment("same-capture").pixelScale, 2);
    assert.notEqual(reloadedPage.getSessionExperiment("same-capture").calculationRunId, runId);
  } finally { globalThis.localStorage = previous; }
});
