import { recordBridgeTiming } from "../experiments/performanceLog.js";

export class BridgeApiError extends Error {
  constructor(status, error) {
    super(error?.message ?? `Bridge request failed with status ${status}`);
    this.name = "BridgeApiError";
    this.status = status;
    this.code = error?.code ?? "UNKNOWN_ERROR";
    this.retryable = error?.retryable === true;
    this.requestId = error?.requestId ?? null;
  }
}

export class BridgeClient {
  constructor({
    baseUrl = "",
    fetchImpl = (...args) => globalThis.fetch(...args),
  } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
    this.logSubscription = null;
  }

  getHealth() {
    return this.#request("/v2/health");
  }

  startCameraPreview() {
    return this.#request("/v2/camera/preview/start", { method: "POST" });
  }

  getCameraPreviewStreamUrl() {
    return `${this.baseUrl}/v2/camera/preview-stream?timestamp=${Date.now()}`;
  }

  startLogForwarding() {
    if (this.logSubscription || typeof EventSource === "undefined") {
      return () => this.stopLogForwarding();
    }

    const source = new EventSource(`${this.baseUrl}/v2/logs/stream`);
    this.logSubscription = source;
    source.addEventListener("message", (event) => {
      try {
        const log = JSON.parse(event.data);
        const method = log.level === "error" ? "error" : log.level === "warn" ? "warn" : "info";
        const [message = "[BIB] Log", ...args] = log.args ?? [];
        recordBridgeTiming(message, args);
        console[method](message, ...args);
      } catch (error) {
        console.warn("[BI] BIB log forwarding failed", error);
      }
    });
    source.addEventListener("error", () => {
      source.close();
      if (this.logSubscription === source) {
        this.logSubscription = null;
      }
    });

    return () => this.stopLogForwarding();
  }

  stopLogForwarding() {
    this.logSubscription?.close();
    this.logSubscription = null;
  }

  resetActiveSessions() {
    return this.#request("/v2/sessions/reset-active", { method: "POST" });
  }

  async getCameraPreviewBlob() {
    const response = await this.fetchImpl(
      `${this.baseUrl}/v2/camera/preview?timestamp=${Date.now()}`,
      { cache: "no-store" },
    );

    if (!response.ok) {
      const payload = await response.json();
      throw new BridgeApiError(response.status, payload.error);
    }

    return response.blob();
  }

  createSession(kioskInstanceId, idempotencyKey) {
    return this.#request("/v2/sessions", {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      body: { kioskInstanceId },
    });
  }

  getSession(session) {
    return this.#sessionRequest(session, "");
  }

  updateProfile(session, profile) {
    return this.#sessionRequest(session, "/profile", {
      method: "PATCH",
      body: profile,
    });
  }

  startCapture(session) {
    return this.#sessionRequest(session, "/capture/start", { method: "POST" });
  }

  retryCapture(session) {
    return this.#sessionRequest(session, "/capture/retry", { method: "POST" });
  }

  cancelCapture(session) {
    return this.#sessionRequest(session, "/capture/cancel", { method: "POST" });
  }

  getCaptureStatus(session) {
    return this.#sessionRequest(session, "/capture/status");
  }

  finalizeSession(session) {
    return this.#sessionRequest(session, "/finalize", { method: "POST" });
  }

  scheduleTransforms(session, priorityAssetIds = [], options = {}) {
    return this.#sessionRequest(session, "/transforms/schedule", {
      method: "POST",
      body: { priorityAssetIds, ...options },
    });
  }

  getTransforms(session) {
    return this.#sessionRequest(session, "/transforms");
  }

  retryTransform(session, assetId) {
    return this.#sessionRequest(
      session,
      `/transforms/${encodeURIComponent(assetId)}/retry`,
      { method: "POST" },
    );
  }

  async getTransformResultBlob(session, resultUrl) {
    return this.#getSessionBlob(session, resultUrl);
  }

  async #getSessionBlob(session, url) {
    const response = await this.fetchImpl(`${this.baseUrl}${url}`, {
      headers: { authorization: `Bearer ${session.sessionToken}` },
    });
    if (!response.ok) {
      const payload = await response.json();
      throw new BridgeApiError(response.status, payload.error);
    }
    return response.blob();
  }

  logout(session) {
    return this.#sessionRequest(session, "/logout", { method: "POST" });
  }

  #sessionRequest(session, suffix, options = {}) {
    return this.#request(`/v2/sessions/${session.sessionId}${suffix}`, {
      ...options,
      token: session.sessionToken,
    });
  }

  async #request(path, { method = "GET", headers = {}, body, token } = {}) {
    const requestHeaders = { ...headers };

    if (body !== undefined) {
      requestHeaders["content-type"] = "application/json";
    }

    if (token) {
      requestHeaders.authorization = `Bearer ${token}`;
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new BridgeApiError(response.status, payload.error);
    }

    return payload;
  }
}

export const bridgeClient = new BridgeClient();
