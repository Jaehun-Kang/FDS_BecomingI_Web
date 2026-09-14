import { test } from "node:test";
import assert from "node:assert/strict";
import { createPreparationCache } from "../src/services/preparationCache.js";

test("grid and modal share pending preparation and immutable reusable buffers", async () => {
  const get = createPreparationCache();
  let calls = 0;
  const prepare = async () => { calls++; return { sourceRgba: new Uint8Array([1, 2, 3, 4]) }; };
  const grid = get("session-result:box", prepare);
  const modal = get("session-result:box", prepare);
  assert.equal(grid, modal);
  const result = await grid;
  const workerCopy = structuredClone(result);
  workerCopy.sourceRgba[0] = 99;
  assert.equal(result.sourceRgba[0], 1);
  assert.equal(calls, 1);
});

test("failed entries retry, changed result keys recompute and memory is bounded", async () => {
  const get = createPreparationCache(2);
  await assert.rejects(get("a", () => { throw new Error("decode"); }));
  assert.equal(await get("a", () => 1), 1);
  assert.equal(await get("b", () => 2), 2);
  assert.equal(await get("c", () => 3), 3);
  assert.equal(await get("a", () => 4), 4);
});
