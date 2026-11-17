/**
 * Which cleaning methods the Streamers Detail View counts, remembered per browser.
 *
 * Crew switch a method off (typically SCUE) to see when each section was last cleaned
 * by hand. The switched-off methods are stored, not the switched-on ones, so events
 * with a method this list does not know (old imports) keep counting.
 */

import { VALID_CLEANING_METHODS } from "./cleaning-method-prefs.js";

const STORAGE_KEY = "heatmapDisabledCleaningMethods";

/** Methods offered as toggles, in display order. */
export const HEATMAP_FILTER_METHODS = VALID_CLEANING_METHODS;

/**
 * Keeps only known methods, without duplicates, in display order. Refuses a list that
 * would switch every method off, because an all-grey heatmap reads as "never cleaned".
 * @param {*} methods
 * @returns {string[]|null} cleaned list, or null when it would disable everything
 */
function sanitizeDisabled(methods) {
  if (!Array.isArray(methods)) return [];
  const disabled = HEATMAP_FILTER_METHODS.filter((m) => methods.includes(m));
  return disabled.length >= HEATMAP_FILTER_METHODS.length ? null : disabled;
}

/**
 * Load the switched-off methods. Anything unreadable falls back to "all methods on".
 * @returns {string[]}
 */
export function loadDisabledMethods() {
  try {
    const raw = typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY);
    if (raw) return sanitizeDisabled(JSON.parse(raw)) ?? [];
  } catch {
    // Ignore private-browsing errors and malformed stored values.
  }
  return [];
}

/**
 * Persist the switched-off methods.
 * @param {string[]} methods
 * @returns {string[]|null} the list as stored, or null when it was refused
 */
export function saveDisabledMethods(methods) {
  const disabled = sanitizeDisabled(methods);
  if (disabled === null) return null;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(disabled));
  } catch {
    // Best-effort preference; the caller still uses the returned list.
  }
  return disabled;
}

/**
 * Flip one method in a switched-off list.
 * @param {string[]} disabled - current switched-off methods
 * @param {string} method
 * @returns {string[]|null} new list, or null when it would switch the last method off
 */
export function toggleDisabledMethod(disabled, method) {
  if (!HEATMAP_FILTER_METHODS.includes(method)) return sanitizeDisabled(disabled);
  const next = disabled.includes(method)
    ? disabled.filter((m) => m !== method)
    : [...disabled, method];
  return sanitizeDisabled(next);
}

/**
 * Drops events whose method is switched off, so tooltips agree with the heatmap colours.
 * @param {Array<{ cleaningMethod: string }>} eventList
 * @param {string[]} disabled
 * @returns {Array}
 */
export function filterEventsByMethod(eventList, disabled) {
  if (!disabled || disabled.length === 0) return eventList;
  return eventList.filter((evt) => !disabled.includes(evt.cleaningMethod));
}
