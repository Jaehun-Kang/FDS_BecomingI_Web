// React development measures clone changed props. Do not retain them for a whole kiosk session.
export const observeDevelopmentTiming = (performanceApi, Observer) => {
  if (!Observer || !performanceApi?.clearMeasures) return () => {};
  const observer = new Observer((list) => {
    const names = new Set();
    for (const entry of list.getEntries()) {
      const details = entry.detail?.devtools;
      if (details?.track === "Components \u269b" || details?.trackGroup === "Scheduler \u269b") {
        names.add(entry.name);
      }
    }
    for (const name of names) performanceApi.clearMeasures(name);
  });
  observer.observe({ type: "measure", buffered: true });
  return () => observer.disconnect();
};
