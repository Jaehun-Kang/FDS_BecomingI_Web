import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { getTaggedPosts, getPostTransformAssetId, updatePostLike, lockPageScroll } from "../src/services/postInteractions.js";
import { socialStore, togglePostLike } from "../src/services/socialStore.js";

test("mixed posts select the logged-in face independently of the author", () => {
  const post = { assetId: "female-post-260607", taggedUsernames: ["jin.d0uble0"] };
  assert.equal(getPostTransformAssetId(post, "female", "male"), "female-post-260607-for-male");
  assert.equal(getPostTransformAssetId(post, "female", "female"), post.assetId);
  assert.equal(getPostTransformAssetId({ ...post, taggedUsernames: [] }, "female", "male"), null);
});

test("tagged posts belong to the opposite author, sorted newest first", () => {
  const male = JSON.parse(fs.readFileSync(new URL("../src/data/profile_male.json", import.meta.url)));
  const female = JSON.parse(fs.readFileSync(new URL("../src/data/profile_female.json", import.meta.url)));
  for (const [profile, author] of [[male, female], [female, male]]) {
    const posts = getTaggedPosts(author, profile.user.username);
    assert.equal(posts.length, 4);
    posts.forEach((post, index) => {
      assert.ok(author.posts.includes(post));
      assert.ok(post.taggedUsernames.includes(profile.user.username));
      if (index) assert.ok(posts[index - 1].timestamp >= post.timestamp);
    });
  }
});

test("double click only adds; heart can remove; counts use the author", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const store = { ...socialStore, read: () => socialStore.read(storage),
    togglePostLike: (audience, author, id) => togglePostLike(audience, author, id, storage) };
  const audience = { username: "visitor", gender: "male" };
  const post = { username: "we_r_0", id: "female_post_260607" };
  updatePostLike(store, audience, post, true);
  const repeated = updatePostLike(store, audience, post, true);
  assert.equal(repeated.added, false);
  assert.equal(store.getPostLikeDelta(repeated.state, post.username, post.id), 1);
  assert.equal(store.getPostLikeDelta(repeated.state, "jin.d0uble0", post.id), 0);
  const removed = updatePostLike(store, audience, post);
  assert.equal(store.getPostLikeDelta(removed.state, post.username, post.id), 0);
});

test("modal locks background scrolling and restores prior inline styles", () => {
  const document = { documentElement: { style: { overflow: "auto" } }, body: { style: { overflow: "" } } };
  const unlock = lockPageScroll(document);
  assert.equal(document.documentElement.style.overflow, "hidden");
  assert.equal(document.body.style.overflow, "hidden");
  unlock();
  assert.equal(document.documentElement.style.overflow, "auto");
  assert.equal(document.body.style.overflow, "");
});
