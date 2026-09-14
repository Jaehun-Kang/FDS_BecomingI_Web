export function isTransitionVisible(element, viewportWidth, viewportHeight) {
  if (!element?.isConnected) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || viewportWidth <= 0 || viewportHeight <= 0) return false;
  if (rect.right <= 0 || rect.left >= viewportWidth) return false;
  const visibleHeight = Math.max(0,
    Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
  return visibleHeight / rect.height >= 0.3;
}
