/** Pure formatting helpers for the fleet overview page. */

const HIGHER_IS_GOOD = new Set(["coverage", "distance", "improvement", "events"]);
const HIGHER_IS_BAD = new Set(["noise", "overdue", "daysSinceCleaning"]);

const isNum = (n) => typeof n === "number" && Number.isFinite(n);

/** @param {number|null|undefined} deltaPct @param {"pct"|"pts"} unit */
export function formatDelta(deltaPct, unit) {
  if (!isNum(deltaPct)) return "—";
  const suffix = unit === "pts" ? " pts" : "%";
  if (deltaPct === 0) return `= 0${suffix}`;
  const arrow = deltaPct > 0 ? "▲" : "▼";
  const sign = deltaPct > 0 ? "+" : "-";
  return `${arrow} ${sign}${Math.abs(deltaPct)}${suffix}`;
}

/** @returns {"good"|"bad"|"neutral"} */
export function deltaTone(kpiKey, delta) {
  if (!isNum(delta) || delta === 0) return "neutral";
  if (HIGHER_IS_GOOD.has(kpiKey)) return delta > 0 ? "good" : "bad";
  if (HIGHER_IS_BAD.has(kpiKey)) return delta > 0 ? "bad" : "good";
  return "neutral";
}

export function formatKm(n) {
  if (!isNum(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function formatDays(n) {
  if (!isNum(n)) return "no data";
  return n === 0 ? "today" : `${n} d`;
}
