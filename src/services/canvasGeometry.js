export const getCanvasBackingGeometry = (width, height, density) => {
  const renderWidth = Math.max(1, Math.round(width * density));
  const renderHeight = Math.max(1, Math.round(height * density));
  // CSS dimensions remain fractional; each axis uses its actual rounded backing ratio.
  return { renderWidth, renderHeight, scaleX: renderWidth / width, scaleY: renderHeight / height };
};
