import { useEffect, useRef, useState } from "react";
import { bridgeClient } from "../services/bridgeClient.js";
import { extensionClient } from "../services/extensionClient.js";
import { sessionStore } from "../services/sessionStore.js";
import { getCaptureCountdownVisual } from "../services/captureCountdown.js";

const kioskInstanceId = "invidigram-windows-dev";
const staleCaptureStates = new Set(["CAPTURING", "RECOVERY_REQUIRED"]);
const completedProfileStates = new Set(["FINALIZED", "ACTIVE_PROFILE"]);
const staleStartErrorCodes = new Set([
  "AUTH_INVALID",
  "INVALID_SESSION_TRANSITION",
]);
const captureTotalSteps = 4;

const toCredentials = (session) => ({
  sessionId: session.sessionId,
  sessionToken: session.sessionToken,
});

const isCompletedProfileSession = (session) =>
  completedProfileStates.has(session?.state);

const isProfileFinalizable = (session) =>
  session?.capture?.state === "COMPLETE" &&
  ["MODEL_READY", "PROFILE_READY"].includes(session?.state);

const shouldReplaceForNewProfileSetup = (session) =>
  isCompletedProfileSession(session) ||
  session?.capture?.state === "COMPLETE" ||
  ["MODEL_READY", "PROFILE_READY"].includes(session?.state);

const formatCaptureStatusMessage = (status) => {
  const step =
    status.step ??
    Math.min(status.completedSlots.length + 1, captureTotalSteps);
  const totalSteps = status.totalSteps ?? captureTotalSteps;
  const instruction = status.instruction || "정면을 바라봐주세요";

  return `${instruction} ${step}/${totalSteps}`;
};

const logSessionError = (message, error) => {
  console.warn(`[BI] ${message}`, {
    code: error?.code,
    message: error?.message,
    status: error?.status,
    retryable: error?.retryable,
    requestId: error?.requestId,
  });
};

export const useProfileSession = () => {
  const [session, setSession] = useState(null);
  const [statusMessage, setStatusMessage] = useState("Bridge 연결 확인 중");
  const [isBusy, setIsBusy] = useState(true);
  const [isBridgeReady, setIsBridgeReady] = useState(false);
  const [captureCountdown, updateCaptureCountdown] = useState(null);
  const [countdownDeadline, setCountdownDeadline] = useState(null);
  const [captureFlashId, setCaptureFlashId] = useState(0);
  const [captureProgress, setCaptureProgress] = useState(null);
  const setCaptureCountdown = (value) => {
    setCountdownDeadline(null);
    setCaptureProgress(null);
    updateCaptureCountdown(value);
  };
  const pollTimer = useRef(null);

  useEffect(() => {
    if (countdownDeadline === null) return undefined;
    const update = () => {
      const { countdown, progress } = getCaptureCountdownVisual(
        countdownDeadline,
        Date.now(),
      );
      updateCaptureCountdown(countdown);
      setCaptureProgress(progress);
    };
    update();
    const timer = setInterval(update, 50);
    return () => clearInterval(timer);
  }, [countdownDeadline]);

  useEffect(() => {
    let cancelled = false;

    const connect = async () => {
      try {
        const [extensionHealth, bridgeHealth] = await Promise.all([
          extensionClient.checkBridgeHealth(),
          bridgeClient.getHealth(),
        ]);

        if (
          extensionHealth.contractVersion !== bridgeHealth.contractVersion ||
          bridgeHealth.resources?.modelsReady !== true
        ) {
          throw new Error(
            "Extension/Bridge 버전 또는 모델 상태가 올바르지 않습니다",
          );
        }

        const stored = sessionStore.load();
        let current;

        if (stored) {
          try {
            current = { ...(await bridgeClient.getSession(stored)), ...stored };
            if (shouldReplaceForNewProfileSetup(current)) {
              await bridgeClient.resetActiveSessions();
              sessionStore.clear();
              current = null;
            } else if (
              staleCaptureStates.has(current.state) ||
              staleCaptureStates.has(current.capture.state)
            ) {
              current = {
                ...(await bridgeClient.cancelCapture(stored)),
                ...stored,
              };
              sessionStore.save(current);
            }
          } catch (error) {
            logSessionError(
              "Stored profile session could not be restored",
              error,
            );
            sessionStore.clear();
          }
        }

        if (!cancelled) {
          setSession(current ?? null);
          setIsBridgeReady(true);
          setStatusMessage("프로필 촬영을 진행해주세요");
          setCaptureCountdown(null);
        }
      } catch (error) {
        logSessionError("Profile session connection failed", error);
        if (!cancelled) {
          setStatusMessage("프로필 촬영을 준비하지 못했습니다");
        }
      } finally {
        if (!cancelled) setIsBusy(false);
      }
    };

    void connect();
    return () => {
      cancelled = true;
      clearTimeout(pollTimer.current);
    };
  }, []);

  const createProfileSession = async () => {
    const current = await bridgeClient.createSession(
      kioskInstanceId,
      crypto.randomUUID(),
    );
    sessionStore.save(current);
    setSession(current);
    return current;
  };

  const replaceProfileSession = async () => {
    await bridgeClient.resetActiveSessions();
    sessionStore.clear();
    setSession(null);
    return createProfileSession();
  };

  const refreshSession = async (activeSession = session) => {
    const credentials = toCredentials(activeSession);
    const next = {
      ...(await bridgeClient.getSession(credentials)),
      ...credentials,
    };
    setSession(next);
    return next;
  };

  const requestCaptureStart = async (activeSession) => {
    if (isCompletedProfileSession(activeSession)) {
      return requestCaptureStart(await replaceProfileSession());
    }

    const credentials = toCredentials(activeSession);
    const next =
      activeSession.capture.state === "COMPLETE"
        ? await bridgeClient.retryCapture(credentials)
        : await bridgeClient.startCapture(credentials);
    return { ...next, ...credentials };
  };

  const recoverCaptureStart = async (activeSession) => {
    const credentials = toCredentials(activeSession);

    try {
      const cancelled = {
        ...(await bridgeClient.cancelCapture(credentials)),
        ...credentials,
      };
      if (shouldReplaceForNewProfileSetup(cancelled)) {
        return requestCaptureStart(await replaceProfileSession());
      }
      sessionStore.save(cancelled);
      setSession(cancelled);
      return requestCaptureStart(cancelled);
    } catch (error) {
      if (!staleStartErrorCodes.has(error?.code)) {
        throw error;
      }
    }

    sessionStore.clear();
    setSession(null);
    return requestCaptureStart(await createProfileSession());
  };

  const pollCapture = async (activeSession = session) => {
    if (!activeSession) return;

    try {
      const credentials = toCredentials(activeSession);
      const status = await bridgeClient.getCaptureStatus(credentials);
      if (status.captureSerial > 0) setCaptureFlashId(status.captureSerial);

      if (status.state === "COMPLETE") {
        await refreshSession(activeSession);
        setStatusMessage("프로필 촬영 완료");
        setCaptureCountdown(null);
        setIsBusy(false);
        return;
      }

      if (status.state === "FAILED") {
        await refreshSession(activeSession);
        setStatusMessage("촬영에 실패했습니다. 다시 시도해주세요");
        setCaptureCountdown(null);
        setIsBusy(false);
        return;
      }

      setStatusMessage(formatCaptureStatusMessage(status));
      if (
        Number.isFinite(status.countdownEndsAt) &&
        !status.previewCountdownEmbedded
      ) {
        setCountdownDeadline(status.countdownEndsAt);
      } else
        setCaptureCountdown(
          !status.previewCountdownEmbedded &&
            Number.isFinite(status.remainingMs)
            ? Math.max(1, Math.ceil(status.remainingMs / 1000))
            : null,
        );
      pollTimer.current = setTimeout(() => pollCapture(activeSession), 100);
    } catch (error) {
      logSessionError("Capture status polling failed", error);
      setStatusMessage("촬영 상태를 확인하지 못했습니다");
      setCaptureCountdown(null);
      setIsBusy(false);
    }
  };

  const startCapture = async () => {
    if (!isBridgeReady || isBusy) return;
    setIsBusy(true);
    setCaptureFlashId(0);
    setCaptureCountdown(null);
    setStatusMessage("카메라를 준비하는 중");

    try {
      let activeSession = session;
      if (activeSession) {
        try {
          activeSession = await refreshSession(activeSession);
        } catch (error) {
          if (!staleStartErrorCodes.has(error?.code)) {
            throw error;
          }
          sessionStore.clear();
          activeSession = null;
        }
      }

      if (shouldReplaceForNewProfileSetup(activeSession)) {
        activeSession = await replaceProfileSession();
      }

      activeSession ??= await createProfileSession();
      let nextSession;

      try {
        nextSession = await requestCaptureStart(activeSession);
      } catch (error) {
        if (!staleStartErrorCodes.has(error?.code)) {
          throw error;
        }

        logSessionError("Stale profile session was cancelled", error);
        nextSession = await recoverCaptureStart(activeSession);
      }

      setSession(nextSession);
      setStatusMessage(formatCaptureStatusMessage(nextSession.capture));
      setCaptureCountdown(null);
      pollTimer.current = setTimeout(() => pollCapture(nextSession), 100);
    } catch (error) {
      logSessionError("Capture start failed", error);
      setStatusMessage("촬영을 시작하지 못했습니다. 다시 시도해주세요");
      setCaptureCountdown(null);
      setIsBusy(false);
    }
  };

  const finalize = async (profile) => {
    if (!isProfileFinalizable(session)) return null;
    setIsBusy(true);
    setStatusMessage("프로필을 저장하는 중");

    try {
      const credentials = toCredentials(session);
      await bridgeClient.updateProfile(credentials, profile);
      const finalized = await bridgeClient.finalizeSession(credentials);
      setSession({ ...finalized, ...credentials });
      setStatusMessage("프로필 저장 완료");
      setCaptureCountdown(null);
      return finalized;
    } catch (error) {
      logSessionError("Profile finalize failed", error);
      setStatusMessage("프로필을 저장하지 못했습니다. 다시 시도해주세요");
      setCaptureCountdown(null);
      return null;
    } finally {
      setIsBusy(false);
    }
  };

  return {
    canStartCapture:
      isBridgeReady &&
      !isBusy &&
      (!session ||
        [
          "CREATED",
          "MODEL_READY",
          "PROFILE_READY",
          "CAPTURE_FAILED",
          "MODEL_FAILED",
          "RECOVERY_REQUIRED",
          "FINALIZED",
          "ACTIVE_PROFILE",
        ].includes(session.state)),
    captureCountdown,
    captureFlashId,
    captureProgress,
    finalize,
    isBusy,
    isCaptureComplete: isProfileFinalizable(session),
    session,
    startCapture,
    statusMessage,
  };
};
