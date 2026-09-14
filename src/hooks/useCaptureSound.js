import { useEffect, useRef } from "react";

export const useCaptureSound = (url, captureId) => {
  const audioRef = useRef(null);
  const lastCaptureRef = useRef(0);
  const playbackVersionRef = useRef(0);

  const prepare = () => {
    try {
      if (!audioRef.current) {
        const context = new AudioContext();
        const ready = fetch(url)
          .then((response) => {
            if (!response.ok) throw new Error(`Capture sound HTTP ${response.status}`);
            return response.arrayBuffer();
          })
          .then((data) => context.decodeAudioData(data));
        // Audio failure must not prevent camera capture.
        ready.catch((error) => console.warn("[BI] Capture sound loading failed", error));
        audioRef.current = { context, ready };
      }
      // Called directly from the capture button's user gesture.
      audioRef.current.context.resume()
        .catch((error) => console.warn("[BI] Capture sound activation failed", error));
    } catch (error) {
      console.warn("[BI] Capture sound unavailable", error);
    }
  };

  useEffect(() => {
    if (!captureId) {
      lastCaptureRef.current = 0;
      playbackVersionRef.current += 1;
      return;
    }
    if (lastCaptureRef.current === captureId) return;
    lastCaptureRef.current = captureId;
    const playbackVersion = ++playbackVersionRef.current;
    const audio = audioRef.current;
    if (!audio) return;
    audio.ready.then((buffer) => {
      if (audioRef.current !== audio || audio.context.state !== "running" ||
          playbackVersionRef.current !== playbackVersion) return;
      const source = audio.context.createBufferSource();
      source.buffer = buffer;
      source.connect(audio.context.destination);
      source.onended = () => source.disconnect();
      source.start();
    }).catch(() => {});
  }, [captureId]);

  useEffect(() => () => {
    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) audio.context.close().catch(() => {});
  }, []);

  return prepare;
};
