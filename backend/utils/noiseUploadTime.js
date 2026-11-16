// utils/noiseUploadTime.js

/**
 * When a noise upload was measured.
 *
 * The upload time (`uploaded_at`) only says when the file reached the server, which can be
 * long after the noise sequence was recorded. Users can enter the sequence time
 * (`recorded_at`); when it is missing the upload time is used instead.
 */

/** SQL expression for the effective measurement time of a noise_uploads row. */
const MEASURED_AT_SQL = "datetime(COALESCE(recorded_at, uploaded_at))";

/**
 * Normalise a stored timestamp to ISO 8601 UTC.
 * SQLite's datetime('now') default is "YYYY-MM-DD HH:MM:SS" in UTC with no zone marker.
 * @param {string|null|undefined} value
 * @returns {string|null}
 */
function toIsoUtc(value) {
  if (!value) return null;
  const text = String(value);
  const normalised = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(text) ? `${text.replace(" ", "T")}Z` : text;
  const date = new Date(normalised);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Validate a client-supplied sequence time.
 * @param {*} value - ISO date-time string; null, undefined or "" mean "not given"
 * @returns {{ value: string|null } | { error: string }}
 */
function parseRecordedAt(value) {
  if (value === null || value === undefined || value === "") return { value: null };
  if (typeof value !== "string") return { error: "recordedAt must be a date-time string" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { error: "recordedAt must be a valid date-time" };
  return { value: date.toISOString() };
}

/**
 * Add the effective measurement time to a camelized noise_uploads row.
 * - recordedAt: sequence time entered by the user, or null
 * - measuredAt: recordedAt when present, otherwise the upload time (ISO UTC)
 * - timeSource: "recorded" | "uploaded"
 * @param {Object|null} upload
 * @returns {Object|null}
 */
function withMeasuredAt(upload) {
  if (!upload) return upload;
  const recordedAt = toIsoUtc(upload.recordedAt);
  return {
    ...upload,
    recordedAt,
    measuredAt: recordedAt || toIsoUtc(upload.uploadedAt),
    timeSource: recordedAt ? "recorded" : "uploaded",
  };
}

/**
 * Check that the cleaning events fall between the two noise uploads being compared.
 * Nothing is blocked: the result only explains why a comparison may be misleading.
 *
 * @param {Object} uploadBefore - upload with measuredAt / timeSource (see withMeasuredAt)
 * @param {Object} uploadAfter
 * @param {Array<{ id: number, cleanedAt: string }>} events
 * @returns {{
 *   warnings: Array<{ code: string, message: string }>,
 *   periodByEventId: Map<number, "inside"|"before"|"after"|"unknown">,
 * }}
 */
function assessCleaningPeriod(uploadBefore, uploadAfter, events) {
  const warnings = [];
  const periodByEventId = new Map();

  const beforeMs = Date.parse(uploadBefore?.measuredAt);
  const afterMs = Date.parse(uploadAfter?.measuredAt);
  if (Number.isNaN(beforeMs) || Number.isNaN(afterMs)) {
    for (const evt of events) periodByEventId.set(evt.id, "unknown");
    return { warnings, periodByEventId };
  }

  if (beforeMs >= afterMs) {
    warnings.push({
      code: "uploads_reversed",
      message:
        'The "before" upload is not older than the "after" upload, so the improvement figures are reversed or meaningless.',
    });
  }

  const periodStart = Math.min(beforeMs, afterMs);
  const periodEnd = Math.max(beforeMs, afterMs);
  let outside = 0;
  for (const evt of events) {
    const cleanedMs = Date.parse(evt.cleanedAt);
    let position = "inside";
    if (Number.isNaN(cleanedMs)) position = "unknown";
    else if (cleanedMs < periodStart) position = "before";
    else if (cleanedMs > periodEnd) position = "after";
    if (position === "before" || position === "after") outside++;
    periodByEventId.set(evt.id, position);
  }

  if (outside > 0) {
    const all = outside === events.length;
    warnings.push({
      code: all ? "all_events_outside_period" : "events_outside_period",
      message:
        all
          ? "None of the cleaning events in the selected window fall between the two noise uploads, so the result does not show the effect of cleaning."
          : `${outside} of ${events.length} cleaning events in the selected window do not fall between the two noise uploads. They are still included in the figures and are marked in the breakdown.`,
    });
  }

  // Only worth saying when something above depends on it.
  const usesUploadTime = [uploadBefore, uploadAfter].some((u) => u.timeSource !== "recorded");
  if (warnings.length > 0 && usesUploadTime) {
    warnings.push({
      code: "upload_time_used",
      message:
        "At least one upload has no sequence time, so its upload time is used. Enter the sequence time on the upload (Planning page) to make this check reliable.",
    });
  }

  return { warnings, periodByEventId };
}

module.exports = { MEASURED_AT_SQL, toIsoUtc, parseRecordedAt, withMeasuredAt, assessCleaningPeriod };
