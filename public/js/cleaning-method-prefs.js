/**
 * Per-browser default cleaning method preference persisted in localStorage.
 * Follows the same pattern as heatmap-legend.js so users' preferred method is
 * remembered across sessions without any server-side changes.
 */

const STORAGE_KEY = "defaultCleaningMethod";

export const DEFAULT_CLEANING_METHOD = "scraper-rope";

/** All accepted cleaning method values. */
export const VALID_CLEANING_METHODS = ["rope", "scraper", "scraper-rope", "scue", "knife"];

/**
 * Load the user's remembered default cleaning method from localStorage.
 * Falls back to DEFAULT_CLEANING_METHOD when no valid value has been saved
 * (first visit, cleared storage, or a method that no longer exists).
 * @returns {string}
 */
export function loadDefaultCleaningMethod() {
  try {
    const saved =
      typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY);
    if (saved && VALID_CLEANING_METHODS.includes(saved)) return saved;
  } catch {
    // Ignore private-browsing or quota errors.
  }
  return DEFAULT_CLEANING_METHOD;
}

/**
 * Persist the user's chosen cleaning method so it is pre-selected on the next visit.
 * Invalid values are silently ignored to keep this a best-effort preference.
 * @param {string} method
 */
export function saveDefaultCleaningMethod(method) {
  if (!VALID_CLEANING_METHODS.includes(method)) return;
  try {
    localStorage.setItem(STORAGE_KEY, method);
  } catch {
    // Ignore private-browsing or quota errors.
  }
}
