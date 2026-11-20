// utils/overviewPeriods.js
// Time windows and delta helpers for the supervisor fleet overview.

const DAY_MS = 24 * 60 * 60 * 1000;
const ALLOWED_DAYS = [7, 30, 90];

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Parses the ?days= query value.
 * @param {*} raw
 * @returns {7|30|90|null} 30 when absent or empty, null when not an allowed window
 */
function parseDays(raw) {
  if (raw === undefined || raw === null || raw === "") return 30;
  const n = Number(raw);
  return ALLOWED_DAYS.includes(n) ? n : null;
}

/**
 * Whole-UTC-day windows: the current one is [start, end) and the previous [prevStart, start),
 * where end is the start of the day after `now`.
 * @param {number} days
 * @param {Date} [now]
 * @returns {{ start: string, end: string, prevStart: string }} ISO strings
 */
function buildPeriods(days, now = new Date()) {
  const endMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY_MS;
  const startMs = endMs - days * DAY_MS;
  return {
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    prevStart: new Date(startMs - days * DAY_MS).toISOString(),
  };
}

/**
 * A value with its previous-window value and the relative change in percent.
 * @param {number|null} value
 * @param {number|null} previous
 * @returns {{ value: number|null, previous: number|null, deltaPct: number|null }}
 */
function kpi(value, previous) {
  const deltaPct =
    value === null || previous === null || previous === 0 ? null : round1(((value - previous) / previous) * 100);
  return { value, previous, deltaPct };
}

/**
 * Difference of two percentages in percentage points, one decimal.
 * @param {number|null} now
 * @param {number|null} before
 * @returns {number|null}
 */
function deltaPoints(now, before) {
  if (now === null || now === undefined || before === null || before === undefined) return null;
  return round1(now - before);
}

/**
 * One entry per UTC day of [start, end), filling days without cleaning with 0 km.
 * @param {Array<{ date: string, meters: number }>} rows - distance per UTC day (YYYY-MM-DD) that had cleaning
 * @param {string} start - ISO start of the window (UTC midnight)
 * @param {string} end - ISO end of the window (exclusive, UTC midnight)
 * @returns {Array<{ date: string, km: number }>}
 */
function fillDailyKm(rows, start, end) {
  const metersByDate = new Map(rows.map((r) => [r.date, r.meters]));
  const out = [];
  for (let ms = Date.parse(start); ms < Date.parse(end); ms += DAY_MS) {
    const date = new Date(ms).toISOString().slice(0, 10);
    out.push({ date, km: (metersByDate.get(date) ?? 0) / 1000 });
  }
  return out;
}

module.exports = { parseDays, buildPeriods, kpi, deltaPoints, fillDailyKm };
