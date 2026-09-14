import assert from "node:assert/strict";
import test from "node:test";
import { recordBridgeTiming, recordTiming, exportPerformanceLog } from "../src/experiments/performanceLog.js";
test("captures structured timings without tokens, images, or arbitrary console data", () => {
  recordBridgeTiming("[BIB] Transform stage completed", [{ assetId: "male-post-test", stage: "WARP_FACE", stageMs: 123, token: "secret", image: "data:image/png;base64,secret" }]);
  recordBridgeTiming("[BIB] transform renderer console", [{ message: '[BI] Transform worker timing {"computeMs":45,"solverSteps":9}' }]);
  recordBridgeTiming("unrelated", [{ token: "secret" }]);
  recordTiming("[BI] Profile first frame timing", { assetId: "male-post-test", playbackToFirstFrameMs: 8, worker: { totalMs: 5 } });
  const report = exportPerformanceLog({ autoReturn: false });
  assert.match(report, /WARP_FACE/);
  assert.equal(JSON.parse(report).runs[0].images["male-post-test"][3], 123);
  assert.match(report, /playbackToFirstFrameMs/);
  assert.doesNotMatch(report, /secret|unrelated|data:image/);
  recordTiming("[BI] Profile playback ended", { assetId: "male-post-test", stage: "playing", finishReason: "view-disposed-or-source-changed", totalMs: 123 });
  assert.equal(JSON.parse(exportPerformanceLog({})).runs[0].images["male-post-test"][12], "view-disposed-or-source-changed");
});
test("timing collection is bounded", () => {
  for (let i = 0; i < 1500; i++) recordTiming("bounded", { imgId: i, totalMs: i });
  const report = exportPerformanceLog({});
  assert.equal(JSON.parse(report).records, 1000);
  assert(report.length < 600000);
});
