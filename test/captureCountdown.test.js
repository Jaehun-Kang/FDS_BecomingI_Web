import assert from "node:assert/strict";
import test from "node:test";
import { getCaptureCountdownVisual } from "../src/services/captureCountdown.js";

test("number and ring share the camera deadline even with late status delivery", () => {
  assert.deepEqual(getCaptureCountdownVisual(4000, 1000), { countdown: 3, progress: 0 });
  assert.deepEqual(getCaptureCountdownVisual(4000, 2500), { countdown: 2, progress: 0.5 });
  assert.deepEqual(getCaptureCountdownVisual(4000, 4100), { countdown: 1, progress: 1 });
});

test("cancelled hold clears visuals and a fresh hold starts empty", () => {
  assert.deepEqual(getCaptureCountdownVisual(null, 2000), { countdown: null, progress: null });
  assert.deepEqual(getCaptureCountdownVisual(8000, 5000), { countdown: 3, progress: 0 });
});
