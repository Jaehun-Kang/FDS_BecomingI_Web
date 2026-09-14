import { test } from "node:test";
import assert from "node:assert/strict";
import { createTransitionQueue } from "../src/services/transitionQueue.js";

test("serial preparation feeds overlapping ready animations", async () => {
  const prepare = createTransitionQueue(1);
  const play = createTransitionQueue(4);
  let computing = 0;
  let computePeak = 0;
  const playing = [];
  const releases = [];
  const jobs = ["A", "B", "C", "D"].map(async (id) => {
    await prepare(async () => {
      computePeak = Math.max(computePeak, ++computing);
      await new Promise(setImmediate);
      computing--;
    });
    await play(() => {
      playing.push(id);
      return new Promise((resolve) => releases.push(resolve));
    });
  });
  for (let i = 0; i < 20 && releases.length < 4; i++) await new Promise(setImmediate);
  const startedTogether = [...playing];
  for (const release of releases) release();
  await Promise.all(jobs);
  assert.equal(computePeak, 1);
  assert.deepEqual(startedTogether, ["A", "B", "C", "D"]);
});

test("modal priority bypasses pending grid work without exceeding capacity", async () => {
  const enqueue = createTransitionQueue(1);
  let release;
  const order = [];
  const active = enqueue(() => new Promise((resolve) => { release = resolve; }));
  await new Promise(setImmediate);
  const grid = enqueue(() => order.push("grid"));
  const modal = enqueue(() => order.push("modal"), { priority: 1 });
  release();
  await Promise.all([active, grid, modal]);
  assert.deepEqual(order, ["modal", "grid"]);
});

test("visible B starts before offscreen A; A starts only after entering", async () => {
  const enqueue = createTransitionQueue(2);
  const controller = new AbortController();
  let aVisible = false;
  const order = [];
  const a = enqueue(() => order.push("A"), {
    ready: () => aVisible, signal: controller.signal,
  });
  try {
    await enqueue(() => order.push("B"));
    assert.deepEqual(order, ["B"]);
    aVisible = true;
    await a;
    assert.deepEqual(order, ["B", "A"]);
  } finally {
    controller.abort();
    await a;
  }
});

test("runs at most two transitions and releases capacity after completion", async () => {
  const enqueue = createTransitionQueue(2);
  const releases = [];
  let running = 0;
  let peak = 0;
  const jobs = Array.from({ length: 4 }, () => enqueue(async () => {
    peak = Math.max(peak, ++running);
    await new Promise((resolve) => releases.push(resolve));
    running--;
  }));
  await new Promise(setImmediate);
  assert.equal(releases.length, 2);
  releases.shift()();
  await new Promise(setImmediate);
  assert.equal(releases.length, 2);
  releases.shift()();
  await new Promise(setImmediate);
  for (const release of releases) release();
  await Promise.all(jobs);
  assert.equal(peak, 2);
});

test("does not run an ineligible or cancelled transition", async () => {
  const enqueue = createTransitionQueue(2);
  const controller = new AbortController();
  let started = false;
  const waiting = enqueue(() => { started = true; }, { ready: () => false, signal: controller.signal });
  controller.abort();
  await waiting;
  assert.equal(started, false);
});
