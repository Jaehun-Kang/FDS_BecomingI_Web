import assert from "node:assert/strict";
import test from "node:test";
import { buildTimingTable, formatTimingJson } from "../src/experiments/timingTable.js";
const line = (label, data) => `2026-09-14T00:00:00Z ${label} ${JSON.stringify({sessionId: "session", pipelineVersion: 33072, modelRevision: 1, assetId: "male-post-test", ...data})}`;
test("fixed rows preserve gaps, zeros, repeat playbacks and actual session versions", () => {
  const report = buildTimingTable([
    line("[BIB] Transform completed", { queueWaitMs: 0, totalMs: 2500 }),
    line("[BI] Profile preparation timing", { playbackId: 1, imgId: 20, totalMs: 1200, cacheStatus: "hit", cacheLookupMs: 2 }),
    line("[BI] Profile first frame timing", { playbackId: 1, imgId: 21, playbackToFirstFrameMs: 15 }),
    line("[BI] Profile playback ended", { playbackId: 1, finishReason: "view-disposed-or-source-changed" }),
    line("[BI] Profile pixel transition complete", { playbackId: 1, finishReason: "settled" }),
    line("[BI] Profile animation timing", { playbackId: 2, animationMs: 4000 }),
    line("[BI] Profile playback ended", { playbackId: 2, finishReason: "settled" }),
    line("[BIB] Transform completed", { pipelineVersion: 33096, totalMs: 4200 }),
    line("[BIB] Transform completed", { sessionId: "other", totalMs: 2600 }),
  ]);
  assert.equal(report.runs.length, 3);
  const run = report.runs[0];
  assert.deepEqual(run.preparationCache["male-post-test"], [{ status: "hit", lookupMs: 2 }, null]);
  assert.deepEqual(run.images["male-post-test"], [0,null,null,null,null,null,null,null,2500,1200,15,null,"view-disposed-or-source-changed"]);
  assert.deepEqual(run.replays["male-post-test"][0], [null,null,null,null,null,null,null,null,null,null,null,4000,"settled"]);
  const text = formatTimingJson(report);
  assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(report)));
  assert.match(text, /"male-post-test": \[0,null/);
});
