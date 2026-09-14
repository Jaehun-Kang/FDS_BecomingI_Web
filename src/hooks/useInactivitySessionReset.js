import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getAutoReturnEnabled, subscribeExperimentSettings } from "../experiments/transformSettings.js";
import { bridgeClient } from "../services/bridgeClient.js";
import { logoutCurrentSession } from "../services/sessionLifecycle.js";
import { sessionStore } from "../services/sessionStore.js";
import { clearCurrentAudience } from "../utils/audienceStore.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const ACTIVITY_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
  "touchstart",
];

const isIgnorableBridgeError = (error) =>
  ["AUTH_INVALID", "SESSION_EXPIRED", "INVALID_SESSION_TRANSITION"].includes(
    error?.code,
  );

const resetCurrentSession = async () => {
  const credentials = sessionStore.load();

  if (credentials) {
    try {
      await bridgeClient.cancelCapture(credentials);
    } catch (error) {
      if (!isIgnorableBridgeError(error)) {
        console.warn("[BI] Inactivity capture cancel failed", error);
      }
    }
  }

  try {
    await logoutCurrentSession();
  } catch (error) {
    console.warn("[BI] Inactivity session logout failed", error);
    sessionStore.clear();
  }
};

export const useInactivitySessionReset = ({
  onReset,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) => {
  const onResetRef = useRef(onReset);
  const deadlineRef = useRef(0);
  const [remainingMs, setRemainingMs] = useState(timeoutMs);
  const autoReturn = useSyncExternalStore(subscribeExperimentSettings, getAutoReturnEnabled);

  useEffect(() => {
    onResetRef.current = onReset;
  }, [onReset]);

  useEffect(() => {
    let timerId = 0;
    if (!autoReturn) return;
    let countdownTimerId = 0;
    let isResetting = false;
    let lastPointerMoveAt = 0;

    const updateRemainingTime = () => {
      const nextRemainingMs = Math.max(0, deadlineRef.current - Date.now());
      setRemainingMs(nextRemainingMs);
    };

    const clearInactivityTimer = () => {
      if (timerId) {
        window.clearTimeout(timerId);
        timerId = 0;
      }
    };

    const scheduleInactivityTimer = () => {
      clearInactivityTimer();
      deadlineRef.current = Date.now() + timeoutMs;
      updateRemainingTime();
      timerId = window.setTimeout(() => {
        void handleTimeout();
      }, timeoutMs);
    };

    const handleTimeout = async () => {
      if (isResetting || !getAutoReturnEnabled()) return;
      isResetting = true;

      try {
        await resetCurrentSession();
      } finally {
        clearCurrentAudience();
        onResetRef.current?.();
        isResetting = false;
        scheduleInactivityTimer();
      }
    };

    const handleActivity = (event) => {
      if (event.type === "pointermove") {
        const now = Date.now();
        if (now - lastPointerMoveAt < 1000) return;
        lastPointerMoveAt = now;
      }

      if (!isResetting) {
        scheduleInactivityTimer();
      }
    };

    ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, handleActivity, { passive: true });
    });
    scheduleInactivityTimer();
    countdownTimerId = window.setInterval(updateRemainingTime, 250);

    return () => {
      clearInactivityTimer();
      if (countdownTimerId) {
        window.clearInterval(countdownTimerId);
      }
      ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, handleActivity);
      });
    };
  }, [timeoutMs, autoReturn]);

  return {
    remainingSeconds: autoReturn ? Math.max(0, Math.ceil(remainingMs / 1000)) : Infinity,
    timeoutSeconds: Math.ceil(timeoutMs / 1000),
  };
};
