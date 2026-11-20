/**
 * How many recent cleanings the heatmap hover tooltips list (section history and eBird
 * dates). A per-browser preference in localStorage, shared by the Main and Planning pages.
 */

const STORAGE_KEY = "tooltipRecentCleanings";

export const DEFAULT_TOOLTIP_RECENT_COUNT = 3;
export const MIN_TOOLTIP_RECENT_COUNT = 1;
export const MAX_TOOLTIP_RECENT_COUNT = 20;

/**
 * A whole number in the allowed range, or null when the value is unusable.
 * @param {unknown} value
 * @returns {number|null}
 */
export function parseTooltipRecentCount(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(MAX_TOOLTIP_RECENT_COUNT, Math.max(MIN_TOOLTIP_RECENT_COUNT, Math.round(n)));
}

/** The saved count, or the default when nothing usable is saved. */
export function loadTooltipRecentCount() {
  try {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    return parseTooltipRecentCount(saved) ?? DEFAULT_TOOLTIP_RECENT_COUNT;
  } catch {
    return DEFAULT_TOOLTIP_RECENT_COUNT;
  }
}

/** Saves a count; unusable values are ignored. Returns the stored count. */
export function saveTooltipRecentCount(value) {
  const n = parseTooltipRecentCount(value);
  if (n === null) return loadTooltipRecentCount();
  try {
    localStorage.setItem(STORAGE_KEY, String(n));
  } catch {
    // Ignore private-browsing or quota errors.
  }
  return n;
}

/**
 * Fills the number input from the saved count and saves whatever the user enters.
 * On blur an out-of-range or empty entry snaps back to the stored value.
 * @param {HTMLInputElement|null} input
 */
export function initTooltipRecentCountInput(input) {
  if (!input) return;
  input.min = String(MIN_TOOLTIP_RECENT_COUNT);
  input.max = String(MAX_TOOLTIP_RECENT_COUNT);
  input.value = String(loadTooltipRecentCount());
  input.addEventListener("input", () => {
    if (parseTooltipRecentCount(input.value) !== null) saveTooltipRecentCount(input.value);
  });
  input.addEventListener("change", () => {
    input.value = String(saveTooltipRecentCount(input.value));
  });
}
