// Keep assignment computation off the worker that advances visible animations.
export const createProfileWorkers = ({ createWorker, loadResources, timeoutMs = 30000 }) => {
  const workers = new Map();
  let resourcesPromise;
  const resources = () => {
    resourcesPromise ??= Promise.resolve().then(loadResources).catch((error) => {
      resourcesPromise = undefined;
      throw error;
    });
    return resourcesPromise;
  };

  const get = (role = "animation") => {
    if (!["compute", "animation"].includes(role)) throw new Error("Unknown profile worker role");
    if (workers.has(role)) return workers.get(role);
    const request = (async () => {
      const { init, weightsImage } = await resources();
      const worker = createWorker(role);
      try {
        const renderer = await new Promise((resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timer);
            worker.removeEventListener("message", onMessage);
            worker.removeEventListener("error", onError);
          };
          const onError = (event) => {
            cleanup();
            reject(new Error(event.message || event.data?.error || "Profile worker initialization failed"));
          };
          const onMessage = (event) => {
            if (event.data.type === "READY") {
              cleanup();
              resolve(event.data.renderer);
            } else if (event.data.type === "ERROR") {
              onError(event);
            }
          };
          const timer = setTimeout(() => {
            cleanup();
            reject(new Error("Profile worker initialization timed out: " + role));
          }, timeoutMs);
          worker.addEventListener("message", onMessage);
          worker.addEventListener("error", onError);
          try {
            worker.postMessage({ ...init, type: "INIT", computeOnly: role === "compute" });
          } catch (error) {
            cleanup();
            reject(error);
          }
        });
        console.info("[BI] Profile worker ready", { role, renderer });
        return { worker, weightsImage, renderer };
      } catch (error) {
        worker.terminate();
        throw error;
      }
    })();
    workers.set(role, request);
    request.catch(() => {
      if (workers.get(role) === request) workers.delete(role);
    });
    return request;
  };
  return { get };
};
