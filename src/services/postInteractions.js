export const getTaggedPosts = (authorProfile, taggedUsername) =>
  [...(authorProfile?.posts ?? [])]
    .filter((post) => post.taggedUsernames?.includes(taggedUsername))
    .sort((a, b) => b.timestamp - a.timestamp);

export const getPostTransformAssetId = (post, authorGender, audienceGender) => {
  if (authorGender === audienceGender) return post.assetId;
  return post.taggedUsernames?.length && ["male", "female"].includes(audienceGender)
    ? `${post.assetId}-for-${audienceGender}` : null;
};

export const updatePostLike = (store, audience, post, likeOnly = false) => {
  const current = store.read();
  const wasLiked = store.hasLikedPost(current, audience, post.username, post.id);
  return {
    added: !wasLiked,
    state: likeOnly && wasLiked
      ? current
      : store.togglePostLike(audience, post.username, post.id),
  };
};

export const lockPageScroll = (document) => {
  const elements = [document.documentElement, document.body];
  const previous = elements.map((element) => element.style.overflow);
  elements.forEach((element) => { element.style.overflow = "hidden"; });
  return () => {
    elements.forEach((element, index) => { element.style.overflow = previous[index]; });
  };
};
