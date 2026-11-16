/**
 * Formatting helpers for <input type="date"> / <input type="time"> values.
 *
 * Both inputs are interpreted in the browser's LOCAL time zone when the form is
 * read back with `new Date(`${date}T${time}`)`, so they must be filled from local
 * getters too. Mixing toISOString() (UTC day) with toTimeString() (local clock)
 * shifts events by a day whenever the local date differs from the UTC date.
 */

function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * @param {Date} date
 * @returns {string} YYYY-MM-DD in local time
 */
export function toDateInputValue(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * @param {Date} date
 * @returns {string} YYYY-MM-DDTHH:MM in local time, for <input type="datetime-local">
 */
export function toDateTimeLocalInputValue(date) {
  return `${toDateInputValue(date)}T${toTimeInputValue(date)}`;
}

/**
 * Read an <input type="datetime-local"> value (local time) as an ISO UTC string.
 * @param {string|null|undefined} value
 * @returns {string|null} null when the field is empty or not a valid date-time
 */
export function dateTimeLocalInputToIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * @param {Date} date
 * @returns {string} HH:MM in local time
 */
export function toTimeInputValue(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}
