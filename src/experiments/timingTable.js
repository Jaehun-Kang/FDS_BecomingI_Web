export const timingColumns = [
  "queueWaitMs", "LOAD_INPUTS", "COLOR_MATCH", "WARP_FACE",
  "FILL_MISSING_WARP_PIXELS", "OBAMIFY_RENDERER", "COMPOSITE_HAIR",
  "FACE_OVERLAY", "bridgeTotalMs", "webPreparationMs",
  "playbackToFirstFrameMs", "animationMs", "finishReason",
];
const stages = new Map(timingColumns.slice(1, 8).map((stage, index) => [stage, index + 1]));
const empty = () => Array(timingColumns.length).fill(null);
const number = (value) => Number.isFinite(value) ? Math.round(value * 100) / 100 : null;

export function formatTimingJson(value, depth = 0) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value) && value.every((item) => item === null || typeof item !== "object")) return JSON.stringify(value);
  const array = Array.isArray(value);
  const pairs = Object.entries(value);
  if (!pairs.length) return array ? "[]" : "{}";
  const padding = "  ".repeat(depth + 1);
  const body = pairs.map(([key, item]) => padding + (array ? "" : `${JSON.stringify(key)}: `) + formatTimingJson(item, depth + 1)).join(",\n");
  return `${array ? "[" : "{"}\n${body}\n${"  ".repeat(depth)}${array ? "]" : "}"}`;
}

export function buildTimingTable(entries) {
  const groups = new Map();
  let unassignedRecords = 0;
  for (const line of entries) {
    const match = line.match(/^\S+ (\[BIB?\] .+?) (\{.*\})$/);
    if (!match) continue;
    const [, label, json] = match;
    const data = JSON.parse(json);
    if (!data.assetId) { unassignedRecords++; continue; }
    const identity = [data.sessionId ?? null, data.pipelineVersion ?? null, data.modelRevision ?? null];
    const key = JSON.stringify(identity);
    if (!groups.has(key)) groups.set(key, { identity, assets: new Map() });
    const group = groups.get(key);
    if (!group.assets.has(data.assetId)) group.assets.set(data.assetId, { bridge: empty(), playbacks: new Map() });
    const asset = group.assets.get(data.assetId);
    if (label.startsWith("[BIB]")) {
      if (stages.has(data.stage)) asset.bridge[stages.get(data.stage)] = number(data.stageMs);
      if (data.queueWaitMs !== undefined) asset.bridge[0] = number(data.queueWaitMs);
      if (label === "[BIB] Transform completed") asset.bridge[8] = number(data.totalMs);
      continue;
    }
    const playbackId = data.playbackId ?? data.imgId ?? "unknown";
    if (!asset.playbacks.has(playbackId)) asset.playbacks.set(playbackId, empty());
    const row = asset.playbacks.get(playbackId);
    if (label === "[BI] Profile preparation timing") {
      row[9] = number(data.totalMs);
      row.cache = { status: data.cacheStatus ?? null, lookupMs: number(data.cacheLookupMs) };
    }
    if (label === "[BI] Profile first frame timing") row[10] = number(data.playbackToFirstFrameMs);
    if (label === "[BI] Profile animation timing") row[11] = number(data.animationMs);
    // View cleanup is authoritative even if its worker later finishes normally.
    if (label === "[BI] Profile playback ended") {
      row[12] = data.finishReason ?? null;
      asset.playbacks.get(playbackId).ended = true;
    } else if (data.finishReason && !row.ended) row[12] = data.finishReason;
  }
  return { unassignedRecords, runs: [...groups.values()].map(({ identity, assets }) => {
    const images = Object.create(null);
    const replays = Object.create(null);
    const playbackIds = Object.create(null);
    const preparationCache = Object.create(null);
    for (const [id, asset] of assets) {
      const rows = [...asset.playbacks.values()];
      images[id] = asset.bridge.map((value, index) => index >= 9 ? (rows[0]?.[index] ?? null) : value);
      if (rows.length > 1) replays[id] = rows.slice(1).map((row) => [...row]);
      playbackIds[id] = [...asset.playbacks.keys()];
      if (rows.some((row) => row.cache?.status)) preparationCache[id] = rows.map((row) => row.cache ?? null);
    }
    return { sessionId: identity[0], pipelineVersion: identity[1], modelRevision: identity[2], images, replays, playbackIds, preparationCache };
  }) };
}
