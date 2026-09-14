import { test } from "node:test";
import assert from "node:assert/strict";
import { getCanvasBackingGeometry } from "../src/services/canvasGeometry.js";

test("fractional grid and modal dimensions preserve face and mask CSS coordinates", () => {
  for (const [width, height] of [[217.375, 289.8333], [729.625, 728.875], [150, 150]]) {
    for (const density of [1, 2, 3, 4]) {
      const geometry = getCanvasBackingGeometry(width, height, density);
      for (const position of [-17.3125, 0, 19.73, 131.934]) {
        assert.ok(Math.abs(position * geometry.scaleX * width / geometry.renderWidth - position) < 1e-10);
        assert.ok(Math.abs(position * geometry.scaleY * height / geometry.renderHeight - position) < 1e-10);
      }
      assert.equal(geometry.renderWidth, Math.round(width * density));
      assert.equal(geometry.renderHeight, Math.round(height * density));
    }
  }
});
