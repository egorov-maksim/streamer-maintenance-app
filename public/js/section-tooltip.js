/**
 * Section hover tooltip content, shared by the Main heatmap and the Planning heatmap
 * so both show the same cleaning history for a section.
 */

import { escapeHtml, formatDateTime, methodLabel } from "./ui.js";

const DAY_MS = 1000 * 60 * 60 * 24;

/** Small icon shown next to a cleaning method name. */
export function getMethodIcon(method) {
  const icons = {
    rope: "🪢",
    scraper: "🛠️",
    "scraper-rope": "🪢🛠️",
    scue: "⚙️",
    knife: "🔪",
  };
  return icons[method] || "🔧";
}

/**
 * Cleaning events that cover one section, newest first.
 * @param {Array} events - cleaning events (already filtered by method, if needed)
 * @param {number} streamerId
 * @param {number} sectionIndex - index along the streamer; tail sections follow the active ones
 * @param {boolean} isTail
 * @param {number} relIndex - index within the tail for tail sections, else sectionIndex
 * @returns {Array}
 */
export function sectionEventsNewestFirst(events, streamerId, sectionIndex, isTail, relIndex) {
  return (events || [])
    .filter((evt) => {
      if (evt.streamerId !== streamerId) return false;
      if (isTail) {
        if (evt.sectionType !== "tail") return false;
        return relIndex >= evt.sectionIndexStart && relIndex <= evt.sectionIndexEnd;
      }
      if (evt.sectionType !== "active") return false;
      return sectionIndex >= evt.sectionIndexStart && sectionIndex <= evt.sectionIndexEnd;
    })
    .sort((a, b) => new Date(b.cleanedAt) - new Date(a.cleanedAt));
}

/**
 * Inner HTML of the section tooltip.
 * @param {object} opts
 * @param {number} opts.streamerId
 * @param {number} opts.sectionIndex
 * @param {boolean} opts.isTail
 * @param {number} opts.relIndex
 * @param {string} opts.sectionLabel - e.g. "AS06" or "T01"
 * @param {Array} opts.events - events to count (method filter already applied)
 * @param {string[]} [opts.disabledMethods] - methods left out, listed in a note
 * @param {string} [opts.extraHtml] - trusted markup appended as its own section (e.g. RMS)
 * @param {number} [opts.now] - current time in ms, for tests
 * @returns {string}
 */
export function buildSectionTooltipHtml({
  streamerId,
  sectionIndex,
  isTail,
  relIndex,
  sectionLabel,
  events,
  disabledMethods = [],
  extraHtml = "",
  now = Date.now(),
}) {
  const sorted = sectionEventsNewestFirst(events, streamerId, sectionIndex, isTail, relIndex);
  // Same rule as the stats clean count: each event adds its cleaningCount (1 per logged event).
  const totalCleanings = sorted.reduce((sum, evt) => sum + (evt.cleaningCount > 0 ? evt.cleaningCount : 1), 0);

  let html = `<div class="tooltip-header">Streamer ${escapeHtml(streamerId)}, Section ${escapeHtml(sectionLabel)}</div>`;

  if (sorted.length > 0) {
    const last = sorted[0];
    const days = Math.max(0, Math.floor((now - new Date(last.cleanedAt)) / DAY_MS));
    const ageClass = days > 7 ? "old" : "";
    html += `
      <div class="tooltip-row">
        <span class="tooltip-label">Last Cleaned</span>
      </div>
      <div class="tooltip-row" style="margin-top: 4px">
        <span class="tooltip-value">${escapeHtml(last.cleaningMethod)}</span>
      </div>
      <div class="tooltip-row">
        <span class="tooltip-value">${escapeHtml(formatDateTime(last.cleanedAt))}</span>
      </div>
      <div class="tooltip-row">
        <span class="tooltip-age ${ageClass}">${days} days ago</span>
      </div>
    `;
  } else {
    html += `
      <div class="tooltip-row">
        <span class="tooltip-label">Last Cleaned</span>
        <span class="tooltip-value" style="color: #9ca3af">Never</span>
      </div>
    `;
  }

  html += `
    <div class="tooltip-section">
      <div class="tooltip-row">
        <span class="tooltip-label">Total Times Cleaned</span>
        <span class="tooltip-value">${totalCleanings}</span>
      </div>
    </div>
  `;

  if (extraHtml) {
    html += `<div class="tooltip-section">${extraHtml}</div>`;
  }

  if (sorted.length > 0) {
    html += `<div class="tooltip-section"><div class="tooltip-row"><span class="tooltip-label">Last 5 cleanings</span></div>`;
    sorted.slice(0, 5).forEach((evt) => {
      html += `
        <div class="tooltip-row">
          <span class="tooltip-value">${escapeHtml(formatDateTime(evt.cleanedAt))}</span>
          <span class="tooltip-method">${getMethodIcon(evt.cleaningMethod)} ${escapeHtml(methodLabel(evt.cleaningMethod))}</span>
        </div>
      `;
    });
    html += `</div>`;
  }

  if (disabledMethods.length > 0) {
    html += `
      <div class="tooltip-section">
        <div class="tooltip-row">
          <span class="tooltip-label">Not counted: ${escapeHtml(disabledMethods.map(methodLabel).join(", "))}</span>
        </div>
      </div>
    `;
  }

  return html;
}
