import assert from "node:assert/strict";
import test from "node:test";
import { createProfileWorkers } from "../src/services/profileWorkers.js";

class FakeWorker {
  listeners = new Map();
  messages = [];
  terminated = false;
  constructor(mode = "ready") { this.mode = mode; }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  postMessage(message) {
    this.messages.push(message);
    if (this.mode === "silent") return;
    queueMicrotask(() => {
      const data = this.mode === "error"
        ? { type: "ERROR", error: "bootstrap failed" }
        : { type: "READY", renderer: message.computeOnly ? "wasm-compute" : "webgpu" };
      this.listeners.get("message")?.forEach((listener) => listener({ data }));
    });
  }
  terminate() { this.terminated = true; }
}

test("uses distinct compute/playback workers with shared resource loading and one worker per role", async () => {
  const created = [];
  let loads = 0;
  const workers = createProfileWorkers({
    createWorker: () => { const w = new FakeWorker(); created.push(w); return w; },
    loadResources: async () => { loads++; return { init: { wasmBytes: new ArrayBuffer(8) }, weightsImage: {} }; },
  });
  const first = workers.get("compute");
  assert.equal(workers.get("compute"), first);
  const [compute, animation] = await Promise.all([first, workers.get("animation")]);
  assert.notEqual(compute.worker, animation.worker);
  assert.equal(created.length, 2);
  assert.equal(loads, 1);
  assert.equal(compute.worker.messages[0].computeOnly, true);
  assert.equal(animation.worker.messages[0].computeOnly, false);
  assert.equal(await workers.get("animation"), animation);
});

test("a stalled compute bootstrap does not block animation; timeout can retry", async () => {
  const created = [];
  const workers = createProfileWorkers({
    timeoutMs: 20,
    createWorker: (role) => {
      const w = new FakeWorker(role === "compute" && !created.length ? "silent" : "ready");
      created.push(w); return w;
    },
    loadResources: async () => ({ init: {} }),
  });
  const compute = workers.get("compute");
  const rejection = assert.rejects(compute, /timed out/);
  const animation = await workers.get("animation");
  assert.equal(animation.renderer, "webgpu");
  await rejection;
  assert.equal(created[0].terminated, true);
  assert.equal((await workers.get("compute")).renderer, "wasm-compute");
});

test("resource failures are retried and failed worker listeners are removed", async () => {
  let attempts = 0;
  const failed = new FakeWorker("error");
  const workers = createProfileWorkers({
    createWorker: () => failed,
    loadResources: async () => {
      if (++attempts === 1) throw new Error("fetch failed");
      return { init: {} };
    },
  });
  await assert.rejects(workers.get("compute"), /fetch failed/);
  await assert.rejects(workers.get("compute"), /bootstrap failed/);
  assert.equal(attempts, 2);
  assert.equal(failed.terminated, true);
  assert.equal(failed.listeners.get("message").size, 0);
  assert.equal(failed.listeners.get("error").size, 0);
});
