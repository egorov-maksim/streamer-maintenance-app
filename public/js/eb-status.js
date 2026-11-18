/**
 * eBird (EB module) cleaning status on heatmap cells, shared by the Main and Planning
 * heatmaps so an EB cell reads the same on both pages. An eBird only counts as cleaned
 * through an entry made for it; scraping runs that pass it do not change it.
 */

import { formatDateTime } from "./ui.js";
import { DEFAULT_TOOLTIP_RECENT_COUNT } from "./tooltip-history-prefs.js";

/** Whole days between an ISO timestamp and now; a date in the future counts as today. */
export function daysSince(iso, now = Date.now()) {
  return Math.max(0, Math.floor((now - new Date(iso)) / (1000 * 60 * 60 * 24)));
}

/** Two-digit EB label, e.g. 5 -> "EB05". */
export function ebLabel(ebNumber) {
  return `EB${String(ebNumber).padStart(2, "0")}`;
}

/** "cleaned today" / "cleaned N days ago", shared by cell labels and tooltips. */
export function cleanedAgoText(days) {
  return days === 0 ? "cleaned today" : `cleaned ${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Newest cleaning date per eBird.
 * @param {Array<{streamerId:number, ebNumber:number, cleanedAt:string}>} entries - newest first
 * @returns {Map<string, string>} "streamer:eb" -> newest cleanedAt
 */
export function latestEbCleaningMap(entries) {
  const latest = new Map();
  for (const entry of entries || []) {
    const key = `${entry.streamerId}:${entry.ebNumber}`;
    if (!latest.has(key)) latest.set(key, entry.cleanedAt);
  }
  return latest;
}

/**
 * Marks an EB cell with its cleaning status. With an entry the cell carries data-eb-days
 * (painted by paintEbAgeCells); without one it keeps the plain EB look.
 * @param {HTMLElement} cell
 * @param {number} streamerId
 * @param {number} ebNumber - 1-based along the streamer
 * @param {Map<string, string>} latestEbCleaning - from latestEbCleaningMap
 */
export function applyEbCleaningStatus(cell, streamerId, ebNumber, latestEbCleaning, now = Date.now()) {
  cell.dataset.ebStreamer = streamerId;
  cell.dataset.ebNum = ebNumber;
  const last = latestEbCleaning.get(`${streamerId}:${ebNumber}`);
  let stateText = "no cleaning date entered";
  if (last) {
    const days = daysSince(last, now);
    cell.dataset.ebDays = String(days);
    stateText = cleanedAgoText(days);
  } else {
    delete cell.dataset.ebDays;
  }
  // aria-label only, no title: the hover tooltip shows the status, and a title would
  // pop the browser's own label up next to it.
  cell.setAttribute("aria-label", `Streamer ${streamerId}, ${ebLabel(ebNumber)}: ${stateText}`);
}

/**
 * Hover tooltip content for one eBird, shared by the Main and Planning heatmaps.
 * @param {Object} opts
 * @param {number} opts.streamerId
 * @param {number} opts.ebNumber
 * @param {Array<{cleanedAt:string}>} opts.entries - this eBird's entries, newest first
 * @param {string} [opts.hint] - closing line, e.g. what a click does; omitted when empty
 * @param {number} [opts.recentCount] - how many earlier dates to list below the newest
 * @param {number} [opts.now]
 * @returns {string} HTML
 */
export function buildEbTooltipHtml({
  streamerId,
  ebNumber,
  entries,
  hint = "",
  recentCount = DEFAULT_TOOLTIP_RECENT_COUNT,
  now = Date.now(),
}) {
  let html = `<div class="tooltip-header">Streamer ${streamerId}, ${ebLabel(ebNumber)}</div>`;

  if (entries.length > 0) {
    const days = daysSince(entries[0].cleanedAt, now);
    html += `
      <div class="tooltip-row">
        <span class="tooltip-label">eBird Last Cleaned</span>
      </div>
      <div class="tooltip-row">
        <span class="tooltip-value">${formatDateTime(entries[0].cleanedAt)}</span>
      </div>
      <div class="tooltip-row">
        <span class="tooltip-age ${days > 7 ? "old" : ""}">${days} days ago</span>
      </div>
    `;
    if (entries.length > 1) {
      html += `<div class="tooltip-section"><div class="tooltip-row"><span class="tooltip-label">Earlier dates</span></div>`;
      entries.slice(1, 1 + Math.max(1, recentCount)).forEach((entry) => {
        html += `<div class="tooltip-row"><span class="tooltip-value">${formatDateTime(entry.cleanedAt)}</span></div>`;
      });
      html += `</div>`;
    }
  } else {
    html += `
      <div class="tooltip-row">
        <span class="tooltip-label">eBird Last Cleaned</span>
        <span class="tooltip-value" style="color: #9ca3af">No date entered</span>
      </div>
    `;
  }
  if (hint) {
    html += `
    <div class="tooltip-section">
      <div class="tooltip-row">
        <span class="tooltip-label">${hint}</span>
      </div>
    </div>
  `;
  }
  return html;
}
