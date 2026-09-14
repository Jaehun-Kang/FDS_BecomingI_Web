export const getCaptureCountdownVisual = (deadline, now, durationMs = 3000) => {
  if (!Number.isFinite(deadline)) return { countdown: null, progress: null };
  const remaining = Math.max(0, deadline - now);
  return {
    // Keep the final number until the camera confirms capture, not merely a predicted deadline.
    countdown: Math.max(1, Math.ceil(remaining / 1000)),
    progress: Math.max(0, Math.min(1, 1 - remaining / durationMs)),
  };
};
