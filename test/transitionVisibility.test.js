import assert from "node:assert/strict";
import test from "node:test";
import { isTransitionVisible } from "../src/services/transitionVisibility.js";

const element = (top, height = 100, left = 10) => ({
  isConnected: true,
  getBoundingClientRect: () => ({ top, bottom: top + height, height, left, right: left + 100, width: 100 }),
});
test("starts at exactly 30 percent visible height from either edge", () => {
  assert.equal(isTransitionVisible(element(971), 1000, 1000), false);
  assert.equal(isTransitionVisible(element(970), 1000, 1000), true);
  assert.equal(isTransitionVisible(element(-71), 1000, 1000), false);
  assert.equal(isTransitionVisible(element(-70), 1000, 1000), true);
  assert.equal(isTransitionVisible(element(0, 3000), 1000, 1000), true);
});
test("uses height, not area, and rejects invisible or detached elements", () => {
  assert.equal(isTransitionVisible(element(970, 100, 950), 1000, 1000), true);
  for (const target of [null, { isConnected: false }, element(1000), element(-100), element(0, 0), element(0, 100, 1000)]) {
    assert.equal(isTransitionVisible(target, 1000, 1000), false);
  }
});
