import { test } from "node:test";
import assert from "node:assert/strict";
import { getPostOverlayRatio, getPostOverlayWidth } from "../src/services/postOverlayGeometry.js";

test("closed modal has a safe default before any measurement", () => {
  assert.equal(getPostOverlayRatio(null, null), 1);
  assert.equal(getPostOverlayRatio(undefined, undefined), 1);
});

test("portrait then landscape then portrait never inherits the previous modal ratio", () => {
  const portrait = { baseImage: "portrait.webp", imageAspectRatio: 0.75 };
  const landscape = { baseImage: "landscape.webp", imageAspectRatio: 16 / 9 };
  const previous = { source: portrait.baseImage, ratio: 0.75 };
  assert.equal(getPostOverlayWidth(getPostOverlayRatio(portrait, previous), 2000, 1048), 750);
  assert.equal(getPostOverlayWidth(getPostOverlayRatio(landscape, previous), 2000, 1048), 1000);
  assert.equal(getPostOverlayWidth(getPostOverlayRatio(portrait, {
    source: landscape.baseImage, ratio: 16 / 9,
  }), 2000, 1048), 750);
});

test("cached transformed image dimensions work without an original load event", () => {
  const post = { baseImage: "current.webp" };
  assert.equal(getPostOverlayRatio(post, { source: "old.webp", ratio: 0.75 }), 1);
  assert.equal(getPostOverlayRatio(post, { source: post.baseImage, ratio: 9 / 16 }), 9 / 16);
  assert.equal(getPostOverlayWidth(16 / 9, 1200, 1048), 660);
  assert.equal(getPostOverlayRatio(post, { source: post.baseImage, ratio: NaN }), 1);
});
