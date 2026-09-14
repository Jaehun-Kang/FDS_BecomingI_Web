import { buildTimingTable, timingColumns, formatTimingJson } from "./timingTable.js";
const contexts = new Map();
let nextPlaybackId = 1;
export function registerTimingContext(url, context) {
  if (!url) return;
  contexts.set(url, safeDetail(context));
  if (contexts.size > 512) contexts.delete(contexts.keys().next().value);
}
export const createPlaybackContext = (url) => ({ ...contexts.get(url), playbackId: nextPlaybackId++ });
const entries = [];
const MAX_ENTRIES = 1000;
const MAX_BYTES = 500000;
let bytes = 0;
let dropped = 0;
const startedAt = new Date().toISOString();

function safeDetail(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 2) return {};
  const result = {};
  for (const [key, field] of Object.entries(value)) {
    if (typeof field === "number" && Number.isFinite(field) && /Ms$|^playbackId$|^imgId$|^pipelineVersion$|^modelRevision$|^sidelen$|^gridWidth$|^gridHeight$|^pixelSize$|Count$|Steps$|Frames$/.test(key)) result[key] = field;
    else if (typeof field === "string" && /^(sessionId|assetId|stage|status|renderer|finishReason|cacheStatus)$/.test(key)) result[key] = field.slice(0, 150);
    else if (key === "worker") result.worker = safeDetail(field, depth + 1);
  }
  return result;
}

export function recordTiming(label, detail) {
  const line = `${new Date().toISOString()} ${label.slice(0, 120)} ${JSON.stringify(safeDetail(detail))}`;
  entries.push(line);
  bytes += line.length;
  while (entries.length > MAX_ENTRIES || bytes > MAX_BYTES) {
    bytes -= entries.shift().length;
    dropped++;
  }
}

export function logProfileTiming(label, detail) {
  recordTiming(label, detail);
  console.info(label, detail);
}

export function recordBridgeTiming(message, args) {
  if (/^\[BIB\] Transform (started|completed|stage completed|queued)$/.test(message)) {
    recordTiming(message, args[0]);
  } else if (message === "[BIB] transform renderer console") {
    const text = args[0]?.message;
    if (typeof text !== "string") return;
    const match = text.match(/^(\[BI\] Transform (?:worker timing|renderer timing|direct pass started|images decoded)) (\{.*\})$/);
    if (!match) return;
    try { recordTiming(match[1], JSON.parse(match[2])); } catch { /* Ignore non-JSON diagnostics. */ }
  }
}

export function exportPerformanceLog(settings) {
  const report = { format: "Becoming I performance log", schemaVersion: 2,
    collectedSince: startedAt, exportedAt: new Date().toISOString(),
    popupSettingsForNextReload: settings, records: entries.length, discardedRecords: dropped,
    units: "ms", columns: timingColumns,
    notes: ["null = not recorded; 0 = measured zero. Unknown session/version is not guessed.",
      "Bridge total includes its stages; do not sum them with the total.",
      "images contains the first playback; replays contains later playbacks in order, without repeating bridge calculations.",
      "Cached preparation is not recalculated; its time is null on replays. Reload clears collection.",
      "settled = normal; safety-final-approach = safety convergence; view-disposed-or-source-changed = interrupted view; failed = error."],
    ...buildTimingTable(entries) };
  return formatTimingJson(report);
}
