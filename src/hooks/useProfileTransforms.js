import { useEffect, useState } from "react";
import { bridgeClient } from "../services/bridgeClient.js";
import { sessionStore } from "../services/sessionStore.js";
import { registerTimingContext } from "../experiments/performanceLog.js";
import { getSessionExperiment, registerResultResolution, waitForExperimentSettings } from "../experiments/transformSettings.js";
import { createTransformResultCache, getTransformCacheKey, loadReadyTransformResults } from "../services/transformResultCache.js";

const transformReadyStates = new Set(["FINALIZED", "ACTIVE_PROFILE"]);
const resultCache = createTransformResultCache(
  (credentials, url) => bridgeClient.getTransformResultBlob(credentials, url),
  (blob) => URL.createObjectURL(blob),
);
const transformBlobUrlCache = resultCache.urls;
const transformStateCache = new Map();
const terminalAuthErrorCodes = new Set(["AUTH_INVALID", "SESSION_EXPIRED"]);

const getTransformStateCacheKey = (credentials, profileGender) =>
  `${credentials.sessionId}:${profileGender}`;

const buildUrlState = (credentials, jobs) => {
  const urls = {};

  for (const job of jobs) {
    const url = transformBlobUrlCache.get(getTransformCacheKey(credentials, job));
    if (url) urls[job.assetId] = url;
  }

  return urls;
};

const hasPendingTransformWork = (jobs) =>
  jobs.some((job) => ["PENDING", "RUNNING"].includes(job.status));

const hasReadyResultWithoutBlob = (credentials, jobs) =>
  jobs.some(
    (job) =>
      job.status === "READY" &&
      job.resultUrl &&
      !transformBlobUrlCache.has(getTransformCacheKey(credentials, job)),
  );

const emptyTransformState = { canApply: false, jobs: [], urls: {} };

const getInitialTransformState = (profileGender) => {
  const credentials = sessionStore.load();

  if (!credentials) return emptyTransformState;

  return (
    transformStateCache.get(getTransformStateCacheKey(credentials, profileGender)) ??
    emptyTransformState
  );
};

const formatSessionForLog = (session) => ({
  sessionId: session?.sessionId,
  state: session?.state,
  profileGender: session?.profile?.gender ?? null,
  modelRevision: session?.modelRevision,
});

const logTransformInfo = (message, detail = {}) => {
  console.info(`[BI] ${message}`, detail);
};

const logTransformError = (message, error) => {
  console.warn(`[BI] ${message}`, {
    code: error?.code,
    message: error?.message,
    status: error?.status,
    retryable: error?.retryable,
    requestId: error?.requestId,
  });
};

const isTerminalAuthError = (error) => terminalAuthErrorCodes.has(error?.code);

export const useProfileTransforms = (profileGender, priorityAssetIds = []) => {
  const [state, setState] = useState(() =>
    getInitialTransformState(profileGender),
  );
  const priorityKey = priorityAssetIds.join("|");
  const hasPriorityAssets = priorityAssetIds.length > 0;

  useEffect(() => {
    const credentials = sessionStore.load();
    if (!credentials) {
      logTransformInfo("Profile transform skipped", {
        reason: "NO_SESSION",
        routeProfileGender: profileGender,
      });
      setState({ canApply: false, jobs: [], urls: {} });
      return undefined;
    }

    let cancelled = false;
    let pollTimer;

    const poll = async () => {
      if (cancelled) return;
      try {
        const jobs = await bridgeClient.getTransforms(credentials);
        if (cancelled) return;
        const snapshot = jobs
          .map(
            (job) =>
              `${job.assetId}:${job.status}:model-${job.modelRevision}:pipeline-${job.pipelineVersion}`,
          )
          .join("|");
        if (snapshot && poll.lastSnapshot !== snapshot) {
          poll.lastSnapshot = snapshot;
          logTransformInfo("Profile transform status", {
            routeProfileGender: profileGender,
            jobs: jobs.map((job) => ({
              assetId: job.assetId,
              role: job.role,
              status: job.status,
              modelRevision: job.modelRevision,
              pipelineVersion: job.pipelineVersion,
              errorCode: job.errorCode,
            })),
          });
        }
        const publish = (completedJob) => {
          if (cancelled) return;
          if (completedJob) logTransformInfo("Profile transform result loaded", {
            assetId: completedJob.assetId,
            role: completedJob.role,
            modelRevision: completedJob.modelRevision,
            pipelineVersion: completedJob.pipelineVersion,
          });
          const nextState = {
            canApply: true,
            jobs,
            urls: buildUrlState(credentials, jobs),
          };
          for (const job of jobs) {
            registerResultResolution(nextState.urls[job.assetId], job.processingSidelen, job.processingGrid);
            registerTimingContext(nextState.urls[job.assetId], { sessionId: credentials.sessionId,
              pipelineVersion: job.pipelineVersion, modelRevision: job.modelRevision });
          }
          transformStateCache.set(
            getTransformStateCacheKey(credentials, profileGender),
            nextState,
          );
          setState(nextState);
        };
        publish();
        // Bound downloads, but publish each result without waiting for the batch.
        await loadReadyTransformResults({
          jobs, credentials, priorityAssetIds, cache: resultCache,
          cancelled: () => cancelled, publish,
          onError: (error) => {
            if (isTerminalAuthError(error)) throw error;
            logTransformError("Profile transform result download failed", error);
          },
        });
        if (cancelled) return;
        const scheduledFromEmptyList = !jobs.length && hasPriorityAssets;
        if (scheduledFromEmptyList) {
          logTransformInfo("Profile transform schedule requested", {
            reason: "NO_JOBS",
            routeProfileGender: profileGender,
            priorityAssetIds,
          });
          await bridgeClient.scheduleTransforms(credentials, priorityAssetIds, {
            onlyPriority: true,
            experiment: getSessionExperiment(credentials.sessionId),
          });
        }
        if (
          scheduledFromEmptyList ||
          hasPendingTransformWork(jobs) ||
          hasReadyResultWithoutBlob(credentials, jobs)
        ) {
          pollTimer = setTimeout(poll, 300);
        }
      } catch (error) {
        if (cancelled) return;
        logTransformError("Profile transform polling failed", error);
        if (isTerminalAuthError(error)) {
          sessionStore.clear();
          transformStateCache.delete(
            getTransformStateCacheKey(credentials, profileGender),
          );
          if (!cancelled) {
            setState({ canApply: false, jobs: [], urls: {} });
          }
          return;
        }
        pollTimer = setTimeout(poll, 1000);
      }
    };

    const schedule = async () => {
      await waitForExperimentSettings();
      if (cancelled) return;
      const bridgeSession = await bridgeClient.getSession(credentials);
      if (cancelled) return;
      logTransformInfo("Profile transform session checked", {
        routeProfileGender: profileGender,
        session: formatSessionForLog(bridgeSession),
      });

      const bridgeProfileGender = bridgeSession.profile?.gender ?? null;
      if (bridgeProfileGender !== profileGender) {
        logTransformInfo("Profile transform skipped", {
          reason: "PROFILE_GENDER_MISMATCH",
          routeProfileGender: profileGender,
          bridgeProfileGender,
          session: formatSessionForLog(bridgeSession),
        });
        setState({ canApply: false, jobs: [], urls: {} });
        return;
      }

      if (!transformReadyStates.has(bridgeSession.state)) {
        logTransformInfo("Profile transform skipped", {
          reason: "SESSION_NOT_FINALIZED",
          routeProfileGender: profileGender,
          session: formatSessionForLog(bridgeSession),
        });
        setState({ canApply: false, jobs: [], urls: {} });
        return;
      }

      if (!hasPriorityAssets) {
        logTransformInfo("Profile transform waiting for visible assets", {
          routeProfileGender: profileGender,
        });
        await bridgeClient.scheduleTransforms(credentials, [], {
          onlyPriority: true, experiment: getSessionExperiment(credentials.sessionId),
        });
        if (!cancelled) await poll();
        return;
      }

      const jobs = await bridgeClient.scheduleTransforms(
        credentials,
        priorityAssetIds,
        { onlyPriority: true, experiment: getSessionExperiment(credentials.sessionId) },
      );
      logTransformInfo("Profile transform scheduled", {
        routeProfileGender: profileGender,
        priorityAssetIds,
        jobCount: jobs.length,
        jobs: jobs.map((job) => ({
          assetId: job.assetId,
          role: job.role,
          status: job.status,
        })),
      });
      await poll();
    };

    schedule().catch((error) => {
      if (cancelled) return;
      logTransformError("Profile transform scheduling failed", error);
      if (isTerminalAuthError(error)) {
        sessionStore.clear();
        transformStateCache.delete(
          getTransformStateCacheKey(credentials, profileGender),
        );
        setState({ canApply: false, jobs: [], urls: {} });
        return;
      }
      pollTimer = setTimeout(poll, 1000);
    });

    return () => {
      cancelled = true;
      clearTimeout(pollTimer);
    };
  }, [profileGender, priorityKey]);

  return state;
};
