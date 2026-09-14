export const getPostOverlayRatio = (post, measured) => {
  const ratio = post?.baseImage && measured?.source === post.baseImage
    ? measured.ratio : post?.imageAspectRatio;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
};

export const getPostOverlayWidth = (ratio, viewportWidth, viewportHeight) => {
  const height = Math.max(0, viewportHeight - 48);
  return Math.max(0, Math.min(ratio * height, height, viewportWidth - 40 - 500));
};
