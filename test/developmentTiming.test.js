import { test } from "node:test";
import assert from "node:assert/strict";
import { observeDevelopmentTiming } from "../src/services/developmentTiming.js";

test("releases React debug measurements without deleting application timings", () => {
  let callback;
  let disconnected = false;
  const cleared = [];
  class Observer {
    constructor(cb) { callback = cb; }
    observe(options) { assert.deepEqual(options, { type: "measure", buffered: true }); }
    disconnect() { disconnected = true; }
  }
  const stop = observeDevelopmentTiming({ clearMeasures: (name) => cleared.push(name) }, Observer);
  callback({ getEntries: () => [
    { name: "Profile", detail: { devtools: { track: "Components \u269b" } } },
    { name: "Render", detail: { devtools: { trackGroup: "Scheduler \u269b" } } },
    { name: "BI transform", detail: null },
  ] });
  assert.deepEqual(cleared, ["Profile", "Render"]);
  stop();
  assert.equal(disconnected, true);
});
