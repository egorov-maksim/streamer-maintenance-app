/* =========================
   Streamer Maintenance App
   public/app.js
   ========================= */

import {
  authToken,
  config,
  setConfig,
  events,
  setEvents,
  ebCleanings,
  setEbCleanings,
  projects,
  setProjects,
  selectedMethod,
  setSelectedMethod,
  selectedProjectFilter,
  setSelectedProjectFilter,
  dragState,
  setDragState,
  isFinalizing,
  setIsFinalizing,
  getActiveProject,
  getFilteredEvents,
} from "./js/state.js";
import * as API from "./js/api.js";
import {
  safeGet,
  setStatus,
  showErrorToast,
  showWarningToast,
  showSuccessToast,
  showAccessDeniedToast,
  formatDateTime,
  escapeHtml,
  methodLabel,
} from "./js/ui.js";
import { toDateInputValue, toTimeInputValue } from "./js/date-utils.js";
import { parseCsvEventRows } from "./js/csv-import.js";
import {
  setOnShowAppCallback,
  loadSession,
  validateSession,
  clearSession,
  showLogin,
  showApp,
  handleLogin,
  handleLogout,
  updateUIForRole,
  setupPasswordToggle,
  isSuperUser,
  isAdminOrAbove,
  isAdmin,
  isGrandSuperUser,
} from "./js/auth.js";
import { initModals, openModal, closeModal } from "./js/modals.js";
import * as Projects from "./js/projects.js";
import * as StreamerUtils from "./js/streamer-utils.js";
import { computeStreamerTooltipData } from "./js/streamer-tooltip.js";
import { initPDFGeneration } from "./pdf-generator.js";
import {
  refreshStatsFiltered,
  resetFilter,
  renderStreamerCards,
  initCleaningEventsKpiModal,
} from "./js/stats.js";
import {
  DEFAULT_PREFS,
  loadHeatmapLegendPrefs,
  saveHeatmapLegendPrefs,
  validateAgeBreaks,
  paintScrapingAgeCells,
  paintEbAgeCells,
  scrapingAgeLegendGradient,
  renderAgeTicks,
} from "./js/heatmap-legend.js";
import {
  loadDefaultCleaningMethod,
  saveDefaultCleaningMethod,
} from "./js/cleaning-method-prefs.js";
import {
  shouldInsertModuleAfterSection,
  countHeatmapColumnRows,
} from "./js/heatmap-layout.js";
import {
  loadDisabledMethods,
  saveDisabledMethods,
  toggleDisabledMethod,
  filterEventsByMethod,
} from "./js/heatmap-method-filter.js";

const sectionCount = StreamerUtils.sectionCount;
const eventDistance = StreamerUtils.eventDistance;
const ageBucket = StreamerUtils.ageBucket;
const fmtKm = StreamerUtils.fmtKm;
const getChannelRange = StreamerUtils.getChannelRange;
const formatAS = StreamerUtils.formatAS;
const formatSectionLabel = StreamerUtils.formatSectionLabel;
const formatRangeLabel = StreamerUtils.formatRangeLabel;
const formatEB = StreamerUtils.formatEB;
const getConfigForProject = StreamerUtils.getConfigForProject;
const getSectionsPerCableWithTail = StreamerUtils.getSectionsPerCableWithTail;
const getMaxSectionIndex = StreamerUtils.getMaxSectionIndex;
const validateStreamerAndSections = StreamerUtils.validateStreamerAndSections;
const getEBRangeForSectionRange = StreamerUtils.getEBRangeForSectionRange;
const getEffectiveSectionsPerCable = StreamerUtils.getEffectiveSectionsPerCable;

/* ------------ Heatmap ------------ */
/* ============================================================================
   SECTION HOVER TOOLTIP - Shows statistics for each section
   ============================================================================ */

let tooltip = null;

/**
 * Cleaning methods switched off in the Streamers Detail View. The heatmap, its section
 * tooltips and the streamer header tooltips all behave as if events of these methods
 * did not exist. Kept in memory so hover handlers do not re-read localStorage.
 */
let disabledHeatmapMethods = loadDisabledMethods();

/** Whole days between an ISO timestamp and now; a date in the future counts as today. */
function daysSince(iso) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso)) / (1000 * 60 * 60 * 24)));
}

function createTooltip() {
  if (tooltip) return tooltip;
  tooltip = document.createElement('div');
  tooltip.className = 'section-tooltip';
  document.body.appendChild(tooltip);
  return tooltip;
}

// Shared helper to position floating tooltips near the cursor,
// while keeping them within the viewport. Assumes the element is
// already visible (so getBoundingClientRect returns meaningful size).
function positionTooltipNearCursor(element, event) {
  if (!element || !event) return;

  const baseX = event.clientX + 15;
  const baseY = event.clientY + 15;

  const rect = element.getBoundingClientRect();
  const x = baseX + rect.width > window.innerWidth ? baseX - rect.width - 30 : baseX;
  const y = baseY + rect.height > window.innerHeight ? baseY - rect.height - 30 : baseY;

  element.style.left = `${x}px`;
  element.style.top = `${y}px`;
}

function showSectionTooltip(e, streamerId, sectionIndex) {
  const tooltip = createTooltip();
  const streamerNum = streamerId;
  const effectiveSectionsForStreamer = getEffectiveSectionsPerCable(streamerId);

  // Determine if it's a tail section based on this streamer's effective section count
  const isTail = sectionIndex >= effectiveSectionsForStreamer;
  const relIndex = isTail ? sectionIndex - effectiveSectionsForStreamer : sectionIndex;
  const sectionLabel = formatSectionLabel(relIndex, isTail ? 'tail' : 'active');

  // Get cleaning history for this specific section (by section_type and indices)
  const sectionEvents = filterEventsByMethod(events, disabledHeatmapMethods).filter(evt => {
    if (evt.streamerId !== streamerId) return false;
    if (isTail) {
      if (evt.sectionType !== 'tail') return false;
      return relIndex >= evt.sectionIndexStart && relIndex <= evt.sectionIndexEnd;
    }
    if (evt.sectionType !== 'active') return false;
    return sectionIndex >= evt.sectionIndexStart && sectionIndex <= evt.sectionIndexEnd;
  });

  // Same rule as the stats clean count: each event adds its cleaningCount (1 per logged event).
  const totalCleanings = sectionEvents.reduce((sum, evt) => sum + (evt.cleaningCount > 0 ? evt.cleaningCount : 1), 0);

  // Sort by date (newest first) — copy so we don't mutate before methodCounts
  const sortedByDate = [...sectionEvents].sort((a, b) =>
    new Date(b.cleanedAt) - new Date(a.cleanedAt)
  );

  // Get last cleaned date from sorted list
  let lastCleaned = null;
  let lastMethod = null;
  let daysSince = null;
  if (sortedByDate.length > 0) {
    lastCleaned = sortedByDate[0].cleanedAt;
    lastMethod = sortedByDate[0].cleaningMethod;
    daysSince = Math.floor((Date.now() - new Date(lastCleaned)) / (1000 * 60 * 60 * 24));
  }

  // Build tooltip HTML
  let html = `<div class="tooltip-header">Streamer ${streamerNum}, Section ${sectionLabel}</div>`;

  if (lastCleaned) {
    const ageClass = daysSince > 7 ? 'old' : '';
    html += `
      <div class="tooltip-row">
        <span class="tooltip-label">Last Cleaned</span>
      </div>
      <div class="tooltip-row" style="margin-top: 4px">
        <span class="tooltip-value">${escapeHtml(lastMethod)}</span>
      </div>
      <div class="tooltip-row">
        <span class="tooltip-value">${formatDateTime(lastCleaned)}</span>
      </div>
      <div class="tooltip-row">
        <span class="tooltip-age ${ageClass}">${daysSince} days ago</span>
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

  // Last 5 cleanings by date
  if (sortedByDate.length > 0) {
    const lastFive = sortedByDate.slice(0, 5);
    html += `<div class="tooltip-section"><div class="tooltip-row"><span class="tooltip-label">Last 5 cleanings</span></div>`;
    lastFive.forEach(evt => {
      const icon = getMethodIcon(evt.cleaningMethod);
      html += `
        <div class="tooltip-row">
          <span class="tooltip-value">${formatDateTime(evt.cleanedAt)}</span>
          <span class="tooltip-method">${icon} ${escapeHtml(methodLabel(evt.cleaningMethod))}</span>
        </div>
      `;
    });
    html += `</div>`;
  }

  if (disabledHeatmapMethods.length > 0) {
    html += `
      <div class="tooltip-section">
        <div class="tooltip-row">
          <span class="tooltip-label">Not counted: ${escapeHtml(disabledHeatmapMethods.map(methodLabel).join(', '))}</span>
        </div>
      </div>
    `;
  }

  tooltip.innerHTML = html;

  // Make visible, then position using shared helper
  tooltip.classList.add('show');
  positionTooltipNearCursor(tooltip, e);
}

function hideSectionTooltip() {
  if (tooltip) tooltip.classList.remove('show');
}

/* ------------ eBird (EB module) cleaning dates ------------ */

/** Two-digit EB label, e.g. 5 -> "EB05". */
function ebLabel(ebNumber) {
  return `EB${String(ebNumber).padStart(2, '0')}`;
}

/** Cleaning entries for one eBird, newest first (state order). */
function ebEntriesFor(streamerId, ebNumber) {
  return ebCleanings.filter(entry => entry.streamerId === streamerId && entry.ebNumber === ebNumber);
}

/** "cleaned today" / "cleaned N days ago", shared by cell labels and tooltips. */
function cleanedAgoText(days) {
  return days === 0 ? 'cleaned today' : `cleaned ${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * Builds one EB cell. An eBird only counts as cleaned through an entry made for it;
 * scraping runs that pass it do not change it. With an entry the cell carries
 * data-eb-days and is coloured like a section; without one it keeps the plain EB look.
 * @param {number} streamerId
 * @param {number} ebNumber - 1-based along the streamer
 * @param {Map<string, string>} latestEbCleaning - "streamer:eb" -> newest cleanedAt
 * @returns {HTMLElement}
 */
function buildEbCell(streamerId, ebNumber, latestEbCleaning) {
  const cell = document.createElement('div');
  cell.className = 'hm-vcell hm-module';
  cell.textContent = ebLabel(ebNumber);
  cell.dataset.ebStreamer = streamerId;
  cell.dataset.ebNum = ebNumber;

  const last = latestEbCleaning.get(`${streamerId}:${ebNumber}`);
  let stateText = 'no cleaning date entered';
  if (last) {
    const days = daysSince(last);
    cell.dataset.ebDays = String(days);
    stateText = cleanedAgoText(days);
  }
  const label = `Streamer ${streamerId}, ${ebLabel(ebNumber)}: ${stateText}`;
  cell.title = label;
  cell.setAttribute('aria-label', label);
  return cell;
}

function showEBTooltip(e, streamerId, ebNumber) {
  const tip = createTooltip();
  const entries = ebEntriesFor(streamerId, ebNumber);
  let html = `<div class="tooltip-header">Streamer ${streamerId}, ${ebLabel(ebNumber)}</div>`;

  if (entries.length > 0) {
    const days = daysSince(entries[0].cleanedAt);
    html += `
      <div class="tooltip-row">
        <span class="tooltip-label">eBird Last Cleaned</span>
      </div>
      <div class="tooltip-row">
        <span class="tooltip-value">${formatDateTime(entries[0].cleanedAt)}</span>
      </div>
      <div class="tooltip-row">
        <span class="tooltip-age ${days > 7 ? 'old' : ''}">${days} days ago</span>
      </div>
    `;
    if (entries.length > 1) {
      html += `<div class="tooltip-section"><div class="tooltip-row"><span class="tooltip-label">Earlier dates</span></div>`;
      entries.slice(1, 5).forEach(entry => {
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
  html += `
    <div class="tooltip-section">
      <div class="tooltip-row">
        <span class="tooltip-label">${isAdminOrAbove() ? 'Click to enter a cleaning date' : 'Click to see cleaning dates'}</span>
      </div>
    </div>
  `;

  tip.innerHTML = html;
  tip.classList.add('show');
  positionTooltipNearCursor(tip, e);
}

/**
 * Hover tooltip and click-to-open on every EB cell, in both orientations.
 * Cells are rebuilt on each render, so listeners are attached per render.
 */
function attachEbCellListeners(wrapper) {
  wrapper.querySelectorAll('.hm-module[data-eb-num]').forEach(cell => {
    const streamerId = parseInt(cell.dataset.ebStreamer, 10);
    const ebNumber = parseInt(cell.dataset.ebNum, 10);
    if (!streamerId || !ebNumber) return;
    cell.addEventListener('mouseenter', (e) => { if (!dragState.active) showEBTooltip(e, streamerId, ebNumber); });
    cell.addEventListener('mousemove', (e) => { if (!dragState.active) showEBTooltip(e, streamerId, ebNumber); });
    cell.addEventListener('mouseleave', hideSectionTooltip);
    cell.addEventListener('click', () => openEbCleanModal(streamerId, ebNumber));
  });
}

/** Which eBird the cleaning dialog is showing: { streamerId, ebNumber } or null. */
let ebModalTarget = null;

function openEbCleanModal(streamerId, ebNumber) {
  ebModalTarget = { streamerId, ebNumber };
  hideSectionTooltip();

  const title = safeGet('eb-clean-modal-title');
  if (title) title.textContent = `eBird Cleaning: ${ebLabel(ebNumber)}`;
  const subtitle = safeGet('eb-clean-modal-subtitle');
  if (subtitle) subtitle.textContent = `Streamer ${streamerId}`;

  const now = new Date();
  const dateInput = safeGet('eb-clean-date');
  const timeInput = safeGet('eb-clean-time');
  if (dateInput) {
    dateInput.value = toDateInputValue(now);
    dateInput.max = toDateInputValue(now);
  }
  if (timeInput) timeInput.value = toTimeInputValue(now);

  renderEbCleanList();
  openModal('eb-clean-modal');
}

function closeEbCleanModal() {
  closeModal('eb-clean-modal');
  ebModalTarget = null;
}

/** Fills the dialog's list of dates already entered for the eBird it is showing. */
function renderEbCleanList() {
  const list = safeGet('eb-clean-list');
  const empty = safeGet('eb-clean-empty');
  if (!list || !ebModalTarget) return;

  const entries = ebEntriesFor(ebModalTarget.streamerId, ebModalTarget.ebNumber);
  if (empty) empty.classList.toggle('hidden', entries.length > 0);
  const canDelete = isAdminOrAbove();

  list.innerHTML = entries.map(entry => {
    const days = daysSince(entry.cleanedAt);
    const by = entry.addedByUsertag ? ` · by ${escapeHtml(entry.addedByUsertag)}` : '';
    const when = escapeHtml(formatDateTime(entry.cleanedAt));
    const deleteBtn = canDelete
      ? `<button type="button" class="btn btn-sm btn-outline-danger" data-eb-clean-delete="${entry.id}" aria-label="Delete cleaning date ${when}">Delete</button>`
      : '';
    return `
      <li class="eb-clean-item">
        <span class="eb-clean-item-text">
          <span class="eb-clean-item-date">${when}</span>
          <span class="eb-clean-item-meta">${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}${by}</span>
        </span>
        ${deleteBtn}
      </li>
    `;
  }).join('');
}

async function saveEbCleaning() {
  if (!ebModalTarget) return;
  if (!isAdminOrAbove()) {
    showAccessDeniedToast('add eBird cleaning dates');
    return;
  }

  const dateVal = safeGet('eb-clean-date')?.value;
  const timeVal = safeGet('eb-clean-time')?.value || '12:00';
  const cleanedAt = dateVal ? new Date(`${dateVal}T${timeVal}`) : null;
  if (!cleanedAt || isNaN(cleanedAt.getTime())) {
    showErrorToast('Date Needed', 'Enter the date the eBird was cleaned.');
    return;
  }
  if (cleanedAt.getTime() > Date.now()) {
    showErrorToast('Date In The Future', 'The cleaning date cannot be later than now.');
    return;
  }

  const { streamerId, ebNumber } = ebModalTarget;
  // Same project choice as section cleaning events, so the entry shows under the current filter.
  const activeProject = projects.find(p => p.isActive);
  const projectNumber = selectedProjectFilter || config.activeProjectNumber || (activeProject ? activeProject.projectNumber : null);

  const saveBtn = safeGet('btn-eb-clean-save');
  if (saveBtn) saveBtn.disabled = true;
  try {
    await API.createEbCleaning({ streamerId, ebNumber, cleanedAt: cleanedAt.toISOString(), projectNumber });
    closeEbCleanModal();
    await loadEbCleanings();
    await renderHeatmap();
    showSuccessToast('eBird date saved', `${ebLabel(ebNumber)} on streamer ${streamerId} marked as cleaned.`);
  } catch (err) {
    console.error(err);
    showErrorToast('Save Failed', err?.message || 'Failed to save the eBird cleaning date. Please try again.');
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

/**
 * Delete button in the dialog list. The first click arms the button ("Confirm delete"),
 * the second deletes, so one stray tap cannot remove a date.
 */
async function handleEbCleanListClick(e) {
  const btn = e.target.closest('[data-eb-clean-delete]');
  if (!btn) return;
  if (btn.dataset.armed !== '1') {
    btn.dataset.armed = '1';
    btn.textContent = 'Confirm delete';
    return;
  }
  btn.disabled = true;
  try {
    await API.deleteEbCleaning(btn.dataset.ebCleanDelete);
    await loadEbCleanings();
    renderEbCleanList();
    await renderHeatmap();
    showSuccessToast('eBird date deleted', 'The cleaning date was removed.');
  } catch (err) {
    console.error(err);
    btn.disabled = false;
    showErrorToast('Delete Failed', err?.message || 'Failed to delete the eBird cleaning date. Please try again.');
  }
}

/* ------------ Attach Tooltip Listeners ------------ */

function attachTooltipListeners() {
  const cells = document.querySelectorAll('.hm-vcell:not(.hm-module):not(.hm-channel-ref):not(.hm-tail-ref)');
  cells.forEach(cell => {
    cell.addEventListener('mouseenter', (e) => {
      if (!dragState.active) {
        const streamerId = parseInt(cell.dataset.streamer);
        const section = parseInt(cell.dataset.section, 10);
        if (streamerId && !isNaN(section)) {
          showSectionTooltip(e, streamerId, section);
        }
      }
    });

    cell.addEventListener('mousemove', (e) => {
      if (!dragState.active) {
        const streamerId = parseInt(cell.dataset.streamer);
        const section = parseInt(cell.dataset.section, 10);
        if (streamerId && !isNaN(section)) {
          showSectionTooltip(e, streamerId, section);
        }
      }
    });

    cell.addEventListener('mouseleave', () => {
      if (!dragState.active) {
        hideSectionTooltip();
      }
    });
  });
}

function getMethodIcon(method) {
  const icons = {
    rope: '🪢',
    scraper: '🛠️',
    'scraper-rope': '🪢🛠️',
    scue: '⚙️',
    knife: '🔪'
  };
  return icons[method] || '🔧';
}

/* ------------ Project API (see js/projects.js) ------------ */


async function loadEvents() {
  let url = 'api/events';
  if (selectedProjectFilter) {
    url += `?project=${encodeURIComponent(selectedProjectFilter)}`;
  }
  setEvents(await API.apiCall(url));
}

/**
 * Loads eBird cleaning dates for the same project scope as the events. A failure keeps
 * the dates already on screen: they are an extra on the heatmap and must not block it.
 */
async function loadEbCleanings() {
  try {
    setEbCleanings(await API.fetchEbCleanings(selectedProjectFilter ? { project: selectedProjectFilter } : {}));
  } catch (err) {
    console.debug('eBird cleaning dates fetch failed:', err?.message ?? err);
  }
}

/* ------------ Recent-clean check helpers ------------ */

let pendingCleaningPayload = null;
let adjacentMergeTarget = null;

const RECENT_CLEAN_WINDOW_MS = 24 * 60 * 60 * 1000;
const ADJACENT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Returns the most recent event overlapping the given range that was cleaned
 * within the 24-hour window before `cleanedAtIso`, or null if none found.
 */
function checkRecentCleanings(streamerId, startIndex, endIndex, cleanedAtIso) {
  const proposedTime = new Date(cleanedAtIso).getTime();
  let mostRecent = null;
  let smallestDiff = Infinity;

  for (const evt of events) {
    if (evt.streamerId !== streamerId) continue;
    if (evt.sectionIndexStart > endIndex || evt.sectionIndexEnd < startIndex) continue;

    const existingTime = new Date(evt.cleanedAt).getTime();
    const diff = proposedTime - existingTime;

    if (diff > 0 && diff < RECENT_CLEAN_WINDOW_MS && diff < smallestDiff) {
      smallestDiff = diff;
      mostRecent = { evt, diffMs: diff };
    }
  }

  return mostRecent;
}

/**
 * Returns the most recent event adjacent to the given range that shares the same
 * streamer and cleaning method, within 1 hour in either direction.
 * Only checks single-type ranges (active-only or tail-only); returns null for
 * ranges that span both active and tail.
 *
 * @param {number} streamerId
 * @param {number} startIndex - 0-based global start index
 * @param {number} endIndex - 0-based global end index (inclusive)
 * @param {string} cleaningMethod
 * @param {string} cleanedAtIso
 * @returns {{ evt, mergedStart, mergedEnd, sectionType, diffMs } | null}
 */
function checkAdjacentEvents(streamerId, startIndex, endIndex, cleaningMethod, cleanedAtIso) {
  const effectiveSectionsForStreamer = getEffectiveSectionsPerCable(streamerId);

  let proposedType;
  let proposedStart;
  let proposedEnd;

  if (endIndex < effectiveSectionsForStreamer) {
    proposedType = 'active';
    proposedStart = startIndex;
    proposedEnd = endIndex;
  } else if (startIndex >= effectiveSectionsForStreamer) {
    proposedType = 'tail';
    proposedStart = startIndex - effectiveSectionsForStreamer;
    proposedEnd = endIndex - effectiveSectionsForStreamer;
  } else {
    // Spans active + tail — skip merge suggestion for now
    return null;
  }

  const proposedTime = new Date(cleanedAtIso).getTime();
  let mostRecent = null;
  let smallestDiff = Infinity;

  for (const evt of events) {
    if (evt.streamerId !== streamerId) continue;
    if ((evt.sectionType || 'active') !== proposedType) continue;
    if (evt.cleaningMethod !== cleaningMethod) continue;

    const isAdjacent =
      evt.sectionIndexEnd + 1 === proposedStart ||
      proposedEnd + 1 === evt.sectionIndexStart;
    if (!isAdjacent) continue;

    const existingTime = new Date(evt.cleanedAt).getTime();
    const diff = Math.abs(proposedTime - existingTime);

    if (diff < ADJACENT_WINDOW_MS && diff < smallestDiff) {
      smallestDiff = diff;
      const mergedStart = Math.min(evt.sectionIndexStart, proposedStart);
      const mergedEnd = Math.max(evt.sectionIndexEnd, proposedEnd);
      mostRecent = { evt, mergedStart, mergedEnd, sectionType: proposedType, diffMs: diff };
    }
  }

  return mostRecent;
}

/** Formats a millisecond duration as a human-readable "X hrs Y min ago" string. */
function formatTimeAgo(ms) {
  const totalMins = Math.floor(ms / 60000);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours === 0) return `${mins} min ago`;
  if (mins === 0) return `${hours} hr${hours !== 1 ? 's' : ''} ago`;
  return `${hours} hr${hours !== 1 ? 's' : ''} ${mins} min ago`;
}

/** Populates and opens the recent-clean warning modal, storing the payload for deferred submit. */
function showRecentCleanWarning(recentClean, body) {
  const { evt, diffMs } = recentClean;
  const sectionType = evt.sectionType || 'active';
  const rangeLabel = `${formatSectionLabel(evt.sectionIndexStart, sectionType)}–${formatSectionLabel(evt.sectionIndexEnd, sectionType)}`;

  safeGet('recent-clean-headline').textContent =
    `Streamer ${evt.streamerId}, sections ${rangeLabel} was cleaned ${formatTimeAgo(diffMs)}.`;
  safeGet('recent-clean-detail').textContent =
    `Method: ${methodLabel(evt.cleaningMethod)} · Recorded: ${formatDateTime(evt.cleanedAt)}`;

  pendingCleaningPayload = body;
  openModal('recent-clean-warning-modal');
}

/** Populates and opens the adjacent-merge modal, storing the payload and merge target. */
function showAdjacentMergeModal(adjacentMatch, body) {
  const { evt, mergedStart, mergedEnd, sectionType, diffMs } = adjacentMatch;
  const effectiveSectionsForStreamer = getEffectiveSectionsPerCable(evt.streamerId ?? body.streamerId);

  const existingRange = `${formatSectionLabel(evt.sectionIndexStart, sectionType)}–${formatSectionLabel(evt.sectionIndexEnd, sectionType)}`;

  const proposedStart = sectionType === 'tail'
    ? body.sectionIndexStart - effectiveSectionsForStreamer
    : body.sectionIndexStart;
  const proposedEnd = sectionType === 'tail'
    ? body.sectionIndexEnd - effectiveSectionsForStreamer
    : body.sectionIndexEnd;
  const proposedRange = `${formatSectionLabel(proposedStart, sectionType)}–${formatSectionLabel(proposedEnd, sectionType)}`;
  const mergedRange = `${formatSectionLabel(mergedStart, sectionType)}–${formatSectionLabel(mergedEnd, sectionType)}`;

  safeGet('adjacent-merge-headline').textContent =
    `Streamer ${evt.streamerId}: "${methodLabel(evt.cleaningMethod)}" was applied to sections ${existingRange} ${formatTimeAgo(diffMs)}.`;
  safeGet('adjacent-merge-detail').textContent =
    `Your new event covers adjacent sections ${proposedRange}. Merge into one event covering ${mergedRange}?`;

  adjacentMergeTarget = adjacentMatch;
  pendingCleaningPayload = body;
  openModal('adjacent-merge-modal');
}

/** Merges the pending payload into the existing adjacent event by extending its section range. */
async function mergeAdjacentEvent() {
  closeModal('adjacent-merge-modal');
  if (!adjacentMergeTarget || !pendingCleaningPayload) return;

  const { evt, mergedStart, mergedEnd, sectionType } = adjacentMergeTarget;
  adjacentMergeTarget = null;
  pendingCleaningPayload = null;

  try {
    await API.updateEvent(evt.id, {
      streamerId: evt.streamerId,
      sectionIndexStart: mergedStart,
      sectionIndexEnd: mergedEnd,
      sectionType: sectionType,
      cleaningMethod: evt.cleaningMethod,
      cleanedAt: evt.cleanedAt,
      cleaningCount: evt.cleaningCount,
      projectNumber: evt.projectNumber,
      vesselTag: evt.vesselTag,
    });
    await refreshEverything();
    await renderHeatmap();
    await refreshStatsFiltered();
    showSuccessToast('Events merged', 'Cleaning events merged into one.');
  } catch (err) {
    console.error(err);
    showErrorToast('Merge Failed', 'Failed to merge events. Please try again.');
  }
}

/** Submits a cleaning event payload and refreshes all views. */
async function proceedWithCleaning(body) {
  try {
    const res = await API.apiCall('/api/events', {
      method: 'POST',
      body: JSON.stringify(body),
      action: 'add cleaning events'
    });
    await refreshEverything();
    await renderHeatmap();
    await refreshStatsFiltered();
    const count = Array.isArray(res?.created) ? res.created.length : 1;
    if (count === 2) {
      showSuccessToast('Events added', '2 events added (active + tail).');
    } else {
      showSuccessToast('Event added', 'Cleaning event saved.');
    }
  } catch (err) {
    console.error(err);
    showErrorToast('Save Failed', 'Failed to save cleaning event. Please try again.');
  }
}

async function addEvent() {
  const statusEl = safeGet("event-status");
  if (!isAdminOrAbove()) {
    setStatus(statusEl, "Admin access required", true);
    return;
  }

  try {
    const streamerNum = parseInt(safeGet("evt-streamer").value, 10);
    const startSection = parseInt(safeGet("evt-start").value, 10);
    const endSection = parseInt(safeGet("evt-end").value, 10);
    const method = safeGet("evt-method").value;
    const dateVal = safeGet("evt-date").value;
    const timeVal = safeGet("evt-time").value;

    if (!dateVal || !timeVal) {
      setStatus(statusEl, "Please select date and time", true);
      return;
    }

    // Use unified validation
    const validation = validateStreamerAndSections(streamerNum, startSection, endSection);
    if (!validation.valid) {
      setStatus(statusEl, validation.message, true);
      return;
    }

    const actualStart = Math.min(startSection, endSection) - 1;
    const actualEnd = Math.max(startSection, endSection) - 1;
    const datetimeIso = new Date(`${dateVal}T${timeVal}`).toISOString();
    const streamerId = streamerNum;

    const body = {
      streamerId: streamerId,
      sectionIndexStart: actualStart,
      sectionIndexEnd: actualEnd,
      cleaningMethod: method,
      cleanedAt: datetimeIso,
      cleaningCount: 1,
      vesselTag: config.vesselTag || 'TTN'
    };

    const recentClean = checkRecentCleanings(streamerId, actualStart, actualEnd, datetimeIso);
    if (recentClean) {
      showRecentCleanWarning(recentClean, body);
      return;
    }

    const adjacentMatch = checkAdjacentEvents(streamerId, actualStart, actualEnd, method, datetimeIso);
    if (adjacentMatch) {
      showAdjacentMergeModal(adjacentMatch, body);
      return;
    }

    await proceedWithCleaning(body);
    setStatus(statusEl, '✅ Event added');
  } catch (err) {
    console.error(err);
    setStatus(statusEl, 'Failed to add event', true);
  }
}

async function deleteEvent(id) {
  const evt = events.find(e => e.id === id);
  if (!evt) return;

  // Populate delete modal
  const streamerNum = evt.streamerId;

  safeGet('delete-event-id').value = evt.id;
  safeGet('delete-streamer-display').textContent = streamerNum;
  const sectionType = evt.sectionType || 'active';
  safeGet('delete-range-display').textContent = `${formatSectionLabel(evt.sectionIndexStart, sectionType)} – ${formatSectionLabel(evt.sectionIndexEnd, sectionType)}`;

  const ebRangeRaw = sectionType === 'tail'
    ? '—'
    : getEBRangeForSectionRange(evt.sectionIndexStart, evt.sectionIndexEnd, config);

  safeGet('delete-eb-display').textContent = ebRangeRaw;
  safeGet('delete-method-display').textContent = methodLabel(evt.cleaningMethod);
  safeGet('delete-date-display').textContent = formatDateTime(evt.cleanedAt);
  safeGet('delete-distance-display').textContent = `${eventDistance(evt)} m`;

  safeGet('delete-modal').classList.add('show');
}

function closeDeleteModal() {
  safeGet('delete-modal').classList.remove('show');
}

async function confirmDeleteEvent() {
  if (!isAdminOrAbove()) {
    showAccessDeniedToast('delete events');
    return;
  }
  
  const id = parseInt(safeGet('delete-event-id').value);
  
  try {
    await API.apiCall(`api/events/${id}`, {
      method: 'DELETE',
      action: 'delete events'
    });

    closeDeleteModal();
    await refreshEverything();
    await renderHeatmap();
    await refreshStatsFiltered();
  } catch (err) {
    console.error(err);
    showErrorToast('Delete Failed', 'Failed to delete event. Please try again.');
  }
}

function editEventPrompt(id) {
  const evt = events.find(e => e.id === id);
  if (!evt) return;

  const streamerNum = evt.streamerId;

  safeGet('edit-event-id').value = evt.id;
  safeGet('edit-streamer').value = streamerNum;
  safeGet('edit-start').value = evt.sectionIndexStart + 1;
  safeGet('edit-end').value = evt.sectionIndexEnd + 1;
  safeGet('edit-method').value = evt.cleaningMethod;
  safeGet("edit-project-number").value = evt.projectNumber || "";
  safeGet("edit-vessel-tag").value = evt.vesselTag || "TTN";

  // Both inputs are read back as LOCAL time, so fill both from local getters.
  const dateObj = new Date(evt.cleanedAt);
  safeGet('edit-date').value = toDateInputValue(dateObj);
  safeGet('edit-time').value = toTimeInputValue(dateObj);

  safeGet('edit-modal').classList.add('show');
}

function closeEditModal() {
  safeGet('edit-modal').classList.remove('show');
}

async function saveEditedEvent() {
  const id = parseInt(safeGet('edit-event-id').value);
  const streamerNum = parseInt(safeGet('edit-streamer').value);
  const startSection = parseInt(safeGet('edit-start').value);
  const endSection = parseInt(safeGet('edit-end').value);
  const method = safeGet('edit-method').value;
  const dateVal = safeGet('edit-date').value;
  const timeVal = safeGet('edit-time').value;
  const projectNumber = safeGet("edit-project-number").value || null;
  const vesselTag = safeGet("edit-vessel-tag").value || "TTN";
  // ✅ ADD VALIDATION WITH PROJECT AWARENESS
  const validation = validateStreamerAndSections(
    streamerNum, 
    startSection, 
    endSection, 
    projectNumber  // ← Use the event's project config!
  );
  
  if (!validation.valid) {
    showErrorToast("Out of Range", validation.message);
    return;
  }

  const actualStart = Math.min(startSection, endSection) - 1;
  const actualEnd = Math.max(startSection, endSection) - 1;
  const streamerId = streamerNum;
  const datetimeIso = new Date(`${dateVal}T${timeVal}`).toISOString();

  const body = {
    streamerId: streamerId,
    sectionIndexStart: actualStart,
    sectionIndexEnd: actualEnd,
    cleaningMethod: method,
    cleanedAt: datetimeIso,
    cleaningCount: 1,
    projectNumber: projectNumber,
    vesselTag: vesselTag,
  };

  await updateEvent(id, body);
  closeEditModal();
}

async function updateEvent(id, body) {
  if (!isAdminOrAbove()) {
    showAccessDeniedToast('edit events');
    return;
  }
  try {
    await API.apiCall(`api/events/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
      action: 'edit events'
    });

    await refreshEverything();
    await renderHeatmap();
    await refreshStatsFiltered();
  } catch (err) {
    console.error(err);
    showErrorToast('Update Failed', 'Failed to update event. Please try again.');
  }
}

// Show the clear all modal
function showClearAllModal() {
  if (!isSuperUser()) {
    showAccessDeniedToast('clear all events');
    return;
  }
  
  const activeProject = projects.find(p => p.isActive === true);
  if (!activeProject && !isGrandSuperUser()) {
    showWarningToast('No Active Project', 'Activate a project first. Only GrandSuperUser can clear events for all projects.');
    return;
  }
  const modal = safeGet('clear-all-modal');
  const scopeEl = safeGet('clear-all-scope');
  const countEl = safeGet('clear-all-count');
  const warningMsg = safeGet('clear-all-warning-message');
  const confirmInput = safeGet('clear-all-confirm-input');
  const confirmBtn = safeGet('btn-clear-all-confirm');
  
  if (!modal) return;
  
  // Set scope and count
  if (activeProject) {
    scopeEl.textContent = `Project: ${activeProject.projectNumber}`;
    const projectEvents = events.filter(e => e.projectNumber === activeProject.projectNumber);
    countEl.textContent = projectEvents.length;
    warningMsg.textContent = `All cleaning events for project ${activeProject.projectNumber} will be permanently deleted.`;
  } else {
    scopeEl.textContent = 'All Projects (Global)';
    countEl.textContent = events.length;
    warningMsg.textContent = 'All cleaning events from ALL projects will be permanently deleted from the database.';
  }
  
  // Reset input and disable button
  confirmInput.value = '';
  confirmBtn.disabled = true;
  
  
  
  modal.classList.add('show');
  
  // Focus the input
  setTimeout(() => confirmInput.focus(), 100);
}

// Close the modal
function closeClearAllModal() {
  const modal = safeGet('clear-all-modal');
  const confirmInput = safeGet('clear-all-confirm-input');
  
  if (modal) modal.classList.remove('show');
  if (confirmInput) confirmInput.value = '';
}

// Actually clear the events
async function confirmClearAllEvents() {
  const activeProject = projects.find(p => p.isActive === true);
  const confirmInput = safeGet('clear-all-confirm-input');
  
  if (confirmInput.value.trim().toUpperCase() !== 'DELETE') {
    return;
  }
  
  try {
    await API.clearEvents(activeProject ? activeProject.projectNumber : null);
    
    closeClearAllModal();
    
    if (activeProject) {
      showSuccessToast('Events Cleared', `All events deleted from project ${activeProject.projectNumber}.`);
    } else {
      showSuccessToast('All Events Cleared', 'All cleaning events have been permanently deleted.');
    }
    
    await refreshEverything();
    await renderHeatmap();
    await refreshStatsFiltered();
  } catch (err) {
    console.error(err);
    showErrorToast('Clear Failed', 'Failed to clear events. Please try again.');
  }
}

/* ------------ CSV Import/Export ------------ */

/** UTC calendar date for cleanedAt — aligns with SQLite DATE(cleaned_at) on ISO timestamps. */
function eventUtcDateKey(cleanedAt) {
  return new Date(cleanedAt).toISOString().slice(0, 10);
}

/** Same rules as backend buildEventsWhereClause: both → inclusive range; only start/end → open bound. */
function filterEventsByExportDateRange(eventList, startStr, endStr) {
  const start = (startStr || '').trim();
  const end = (endStr || '').trim();
  return eventList.filter((evt) => {
    const key = eventUtcDateKey(evt.cleanedAt);
    if (start && end) return key >= start && key <= end;
    if (start) return key >= start;
    if (end) return key <= end;
    return true;
  });
}

function buildExportCsvFilename(startStr, endStr) {
  const today = new Date().toISOString().split('T')[0];
  const projectSuffix = selectedProjectFilter ? `-${selectedProjectFilter}` : '';
  const s = (startStr || '').trim();
  const e = (endStr || '').trim();
  let range = '';
  if (s && e) range = `-${s}-to-${e}`;
  else if (s) range = `-from-${s}`;
  else if (e) range = `-to-${e}`;
  return `streamer-cleaning-events${projectSuffix}${range}-${today}.csv`;
}

function downloadEventsCsv(eventsForExport, startStr, endStr) {
  const header = 'Streamer Number,Section Type,First Section,Last Section,Cleaning Method,Date & Time,Project Number,Vessel Tag,Added By';
  const rows = [header];

  eventsForExport.forEach((evt) => {
    const streamerNum = evt.streamerId;
    const sectionType = evt.sectionType || 'active';
    const startSection = evt.sectionIndexStart + 1;
    const endSection = evt.sectionIndexEnd + 1;
    const dateStr = new Date(evt.cleanedAt).toISOString();
    const projectNum = evt.projectNumber || '';
    const vesselTag = evt.vesselTag || 'TTN';
    const addedBy = (evt.addedByUsertag || '').replace(/"/g, '""');
    rows.push(`${streamerNum},${sectionType},${startSection},${endSection},${evt.cleaningMethod},"${dateStr}","${projectNum}","${vesselTag}","${addedBy}"`);
  });

  const csv = rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  const filename = buildExportCsvFilename(startStr, endStr);

  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function openExportCsvModal() {
  const base = getFilteredEvents();
  if (!base.length) {
    showWarningToast('No Data', 'No events available to export.');
    return;
  }
  const statsStart = safeGet('filter-start')?.value ?? '';
  const statsEnd = safeGet('filter-end')?.value ?? '';
  const startInput = safeGet('csv-export-start');
  const endInput = safeGet('csv-export-end');
  if (startInput) startInput.value = statsStart;
  if (endInput) endInput.value = statsEnd;
  openModal('export-csv-modal');
}

function closeExportCsvModal() {
  closeModal('export-csv-modal');
}

function confirmExportCsv() {
  const startStr = safeGet('csv-export-start')?.value ?? '';
  const endStr = safeGet('csv-export-end')?.value ?? '';
  if (startStr && endStr && startStr > endStr) {
    showErrorToast('Invalid range', 'Start date must be on or before end date.');
    return;
  }
  const base = getFilteredEvents();
  if (!base.length) {
    showWarningToast('No Data', 'No events available to export.');
    return;
  }
  const filtered = filterEventsByExportDateRange(base, startStr, endStr);
  if (!filtered.length) {
    showWarningToast('No Data', 'No events fall in the selected date range.');
    return;
  }
  downloadEventsCsv(filtered, startStr, endStr);
  closeExportCsvModal();
}

function importCsv() {
  const input = safeGet('csv-input');
  input.value = '';
  input.click();
}

async function handleCsvFile(file) {
  if (!isAdminOrAbove()) {
    showAccessDeniedToast('import CSV data');
    return;
  }
  
  const reader = new FileReader();

  reader.onload = async (e) => {
    const content = e.target.result;
    const parsed = window.Papa.parse(content, { skipEmptyLines: true });
    const rows = parsed.data || [];

    if (rows.length < 2) {
      showErrorToast('Invalid File', 'CSV file seems empty or invalid.');
      return;
    }

    const importBtn = safeGet('btn-import-csv');
    const progressEl = safeGet('csv-import-progress');
    const dataRows = rows.slice(1).filter((row) => row.some((cell) => String(cell ?? "").trim()));

    // Parse and client-side-validate all rows first (see js/csv-import.js); collect valid ones for batch send.
    const { validRows, parseErrorCount } = parseCsvEventRows(dataRows, config);

    if (validRows.length === 0) {
      showErrorToast('Import Failed', `No valid rows found. ${parseErrorCount} row(s) could not be parsed.`);
      return;
    }

    if (importBtn) importBtn.disabled = true;
    if (progressEl) {
      progressEl.classList.remove('hidden');
      progressEl.textContent = `Importing ${validRows.length} events…`;
    }

    try {
      const result = await API.bulkCreateEvents(validRows);
      const successCount = result.successCount ?? validRows.length;
      const errorCount = (result.errorCount ?? 0) + parseErrorCount;

      await refreshEverything();
      await renderHeatmap();
      await refreshStatsFiltered();

      if (errorCount === 0) {
        showSuccessToast('Import Complete', `${successCount} events imported successfully.`);
      } else {
        showWarningToast('Import Complete', `${successCount} imported, ${errorCount} failed.`);
      }
    } catch (err) {
      showErrorToast('Import Failed', err.message || 'Failed to import events. Please try again.');
    } finally {
      if (importBtn) importBtn.disabled = false;
      if (progressEl) progressEl.classList.add('hidden');
    }
  };

  reader.readAsText(file);
}

/* ------------ Log rendering ------------ */

async function renderLog() {
  const tbody = safeGet('log-body');
  if (!tbody) return;

  tbody.innerHTML = '';

  const isAdminUser = isAdminOrAbove();
  const allEvents = getFilteredEvents();
  const totalRows = allEvents.length;

  // Clamp current page so it never points past the last page after a filter change.
  const totalPages = Math.max(1, Math.ceil(totalRows / logPageSize));
  if (logPage > totalPages) logPage = totalPages;

  const pageEvents = allEvents.slice(
    (logPage - 1) * logPageSize,
    logPage * logPageSize
  );

  // Calculate EB ranges locally using already-loaded config — no network calls needed
  pageEvents.forEach((evt) => {
    const tr = document.createElement('tr');
    const streamerNum = evt.streamerId;
    const sectionType = evt.sectionType || 'active';
    const rangeLabel = formatRangeLabel(evt);
    const ebRange = sectionType === 'tail'
      ? '—'
      : getEBRangeForSectionRange(evt.sectionIndexStart, evt.sectionIndexEnd, config);
    const distance = eventDistance(evt);
    // API text goes through escapeHtml: this row is built with innerHTML.
    const projectDisplay = evt.projectNumber ? escapeHtml(evt.projectNumber) : '<span style="color:#9ca3af">—</span>';
    const vesselDisplay = escapeHtml(evt.vesselTag || 'TTN');
    const addedByDisplay = escapeHtml(evt.addedByUsertag || '—');

    const actionButtons = isAdminUser
      ? `<button class="btn btn-outline btn-icon btn-edit" data-id="${evt.id}" aria-label="Edit event" title="Edit event">✏️</button>
         <button class="btn btn-outline btn-icon btn-delete" data-id="${evt.id}" aria-label="Delete event" title="Delete event">🗑️</button>`
      : '<span class="view-only-badge">View Only</span>';

    tr.innerHTML = `
      <td data-label="Date & Time">${formatDateTime(evt.cleanedAt)}</td>
      <td data-label="Project">${projectDisplay}</td>
      <td data-label="Vessel">${vesselDisplay}</td>
      <td data-label="Added by">${addedByDisplay}</td>
      <td data-label="Streamer">Streamer ${streamerNum}</td>
      <td data-label="Section Range">${rangeLabel}</td>
      <td data-label="EB Range">${ebRange}</td>
      <td data-label="Length">${distance} m</td>
      <td data-label="Method">${escapeHtml(methodLabel(evt.cleaningMethod))}</td>
      <td data-label="Action" class="log-actions-cell">${actionButtons}</td>
    `;
    tbody.appendChild(tr);
  });

  // Add event listeners for edit/delete buttons (only if admin)
  if (isAdminUser) {
    document.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => editEventPrompt(parseInt(btn.dataset.id)));
    });

    document.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteEvent(parseInt(btn.dataset.id)));
    });
  }

  renderLogPagination(totalRows);
}

/* ------------ Method selection ------------ */

function selectMethod(method) {
  setSelectedMethod(method);
  saveDefaultCleaningMethod(method);
  document.querySelectorAll('.method-tile').forEach(tile => {
    tile.classList.toggle('active', tile.dataset.method === method);
  });
}

/* ------------ Alerts ------------ */

async function renderAlerts(preloadedLastCleaned = null) {
  const container = safeGet('alerts-container');
  if (!container) return;

  container.innerHTML = '';

  try {
    let data;
    if (preloadedLastCleaned) {
      data = preloadedLastCleaned;
    } else {
      let url = 'api/last-cleaned';
      if (selectedProjectFilter) url += `?project=${encodeURIComponent(selectedProjectFilter)}`;
      data = await API.apiCall(url);
    }
    const lastCleaned = data.lastCleaned;

    let critical = 0;
    let warning = 0;
    let uncleaned = 0;

    Object.keys(lastCleaned).forEach(streamerId => {
      const sections = lastCleaned[streamerId];
      sections.forEach(date => {
        if (!date) {
          uncleaned++;
          return;
        }
        const days = Math.floor((Date.now() - new Date(date)) / (1000 * 60 * 60 * 24));
        if (days >= 14) critical++;
        else if (days >= 10) warning++;
      });
    });

    if (critical > 0) {
      const alert = document.createElement('div');
      alert.className = 'alert alert-critical';
      alert.innerHTML = `
        <div class="alert-icon">🚨</div>
        <div>
          <div class="alert-title">${critical} sections not cleaned in 14+ days</div>
          <div class="alert-sub">Critical Maintenance Required</div>
        </div>
      `;
      container.appendChild(alert);
    }

    if (warning > 0) {
      const alert = document.createElement('div');
      alert.className = 'alert alert-warning';
      alert.innerHTML = `
        <div class="alert-icon">⚠️</div>
        <div>
          <div class="alert-title">${warning} sections not cleaned in 10–13 days</div>
          <div class="alert-sub">Maintenance Warning</div>
        </div>
      `;
      container.appendChild(alert);
    }

    if (uncleaned > 0) {
      const alert = document.createElement('div');
      alert.className = 'alert alert-uncleaned';
      alert.innerHTML = `
        <div class="alert-icon">ℹ️</div>
        <div>
          <div class="alert-title">${uncleaned} sections have never been cleaned</div>
          <div class="alert-sub">Uncleaned Sections</div>
        </div>
      `;
      container.appendChild(alert);
    }
  } catch (err) {
    console.error(err);
    showErrorToast("Alerts Error", "Failed to load maintenance alert data.");
  }
}

/* ------------ Heat-map orientation ------------ */

const HEATMAP_ORIENTATION_KEY = 'heatmapOrientation';

function getHeatmapOrientation() {
  return localStorage.getItem(HEATMAP_ORIENTATION_KEY) || 'vertical';
}

function updateOrientationButtons() {
  const orientation = getHeatmapOrientation();
  const btnV = document.getElementById('btn-heatmap-vertical');
  const btnH = document.getElementById('btn-heatmap-horizontal');
  if (btnV) btnV.classList.toggle('active', orientation === 'vertical');
  if (btnH) btnH.classList.toggle('active', orientation === 'horizontal');
}

function initOrientationToggle() {
  document.getElementById('btn-heatmap-vertical')?.addEventListener('click', () => {
    localStorage.setItem(HEATMAP_ORIENTATION_KEY, 'vertical');
    updateOrientationButtons();
    renderHeatmap();
  });
  document.getElementById('btn-heatmap-horizontal')?.addEventListener('click', () => {
    localStorage.setItem(HEATMAP_ORIENTATION_KEY, 'horizontal');
    updateOrientationButtons();
    renderHeatmap();
  });
}

/* ------------ Heat-map rendering ------------ */

/** Bumped on every renderHeatmap call so a slow, older render cannot overwrite a newer one. */
let heatmapRenderSeq = 0;

async function renderHeatmap(preloadedLastCleaned = null, preloadedDeployments = null) {
  const container = safeGet('heatmap-container');
  if (!container) return;
  const renderSeq = ++heatmapRenderSeq;

  // Do NOT clear the container here — keep the previous render visible while
  // data loads so there is no blank-flash on re-render. innerHTML is cleared
  // below, after all data has been fetched.

  try {
    let data;
    if (preloadedLastCleaned && disabledHeatmapMethods.length === 0) {
      data = preloadedLastCleaned;
    } else {
      // Preloaded data counts every method (alerts and stats need that), so with a method
      // switched off the heatmap asks the server for its own filtered view.
      const params = {};
      if (selectedProjectFilter) params.project = selectedProjectFilter;
      if (disabledHeatmapMethods.length > 0) params.excludeMethods = disabledHeatmapMethods.join(',');
      data = await API.fetchLastCleaned(params);
    }
    const lastCleaned = data.lastCleaned;

    // Newest cleaning date per eBird; ebCleanings is sorted newest first.
    const latestEbCleaning = new Map();
    for (const entry of ebCleanings) {
      const key = `${entry.streamerId}:${entry.ebNumber}`;
      if (!latestEbCleaning.has(key)) latestEbCleaning.set(key, entry.cleanedAt);
    }

    let deployments = {};
    const activeProject = projects.find(p => p.isActive);
    if (activeProject) {
      if (preloadedDeployments) {
        deployments = preloadedDeployments;
      } else {
        try {
          deployments = await API.apiCall(`/api/projects/${activeProject.id}/streamer-deployments`);
        } catch (error) {
          // Deployment data optional for heatmap; log for debugging if needed
          console.debug('Streamer deployments fetch skipped:', error?.message ?? error);
        }
      }
    }

    // A newer render started while this one was waiting for data; let that one draw.
    if (renderSeq !== heatmapRenderSeq) return;

    // All data is ready — clear old render now to avoid a blank intermediate state.
    container.innerHTML = '';


    const sectionsPerCable = config.sectionsPerCable;
    const cableCount = config.numCables;
    const moduleFreq = config.moduleFrequency;
    const channelsPerSection = config.channelsPerSection;
    const useTailSections = !config.useRopeForTail;
    const tailSections = useTailSections ? 5 : 0;

    // Determine maximum section count across all streamers (project default or any override)
    const overrides = config.sectionsPerCableOverrides || {};
    const maxSectionsPerCable = Object.values(overrides).length > 0
      ? Math.max(sectionsPerCable, ...Object.values(overrides))
      : sectionsPerCable;

    // Compute actual EB module cell count to match rendering logic:
    // – always 1 at the first section
    // – 1 at every section where (sectionNumber-1) % moduleFreq === 0 and sectionNumber > 1
    // – always 1 at the last section (if not already a regular)
    const lastSectionIsRegular = (maxSectionsPerCable - 1) % moduleFreq === 0;
    const modulesCount = 1 + Math.floor((maxSectionsPerCable - 1) / moduleFreq) + (lastSectionIsRegular ? 0 : 1);
    const totalRows = maxSectionsPerCable + modulesCount + tailSections;

    const orientation = getHeatmapOrientation();
    const wrapper = document.createElement('div');

    if (orientation === 'horizontal') {
      // Horizontal layout: streamers as rows, sections as columns.
      // Cell height fits all streamer rows in ~55% of the viewport height.
      const availH = Math.max(300, window.innerHeight * 0.55);
      const cellHeight = Math.max(24, Math.min(40, Math.floor(availH / (cableCount + 1))));

      // Cell width: compute so ALL section columns fit the container without horizontal scroll.
      // totalRows columns + 1 label column = totalRows+1 items → totalRows gaps between them.
      // Use 1px gap between cells to maximise space for cells themselves.
      const LABEL_W = 40; // minimum readable width for the streamer label column
      const GAP_H = 1; // compact column gap (px)
      const containerContent = container.clientWidth - 16; // subtract container's 8px padding each side
      const cellWidth = Math.max(1, Math.floor((containerContent - LABEL_W) / totalRows - GAP_H));

      wrapper.className = 'hm-grid-horizontal';
      wrapper.style.width = '100%';
      wrapper.style.setProperty('--hm-cell-h', `${cellHeight}px`);
      wrapper.style.setProperty('--hm-cell-w', `${cellWidth}px`);
      wrapper.style.setProperty('--hm-label-w', `${LABEL_W}px`);
      wrapper.style.setProperty('--hm-row-gap', `${GAP_H}px`);
      // CH header is taller so channel ranges can run vertically in narrow columns.
      const chRowHeight = Math.max(48, Math.min(88, cellWidth * 14));
      wrapper.style.setProperty('--hm-ch-row-h', `${chRowHeight}px`);


      // CH row spans the full max-length grid so channel labels are always visible.
      const maxColTemplate = `var(--hm-label-w, 40px) repeat(${totalRows}, var(--hm-cell-w, 52px))`;

      // Helper: append the interleaved section/EB/tail cells for a single row.
      // sectionCount is the active section count for this row (determines loop bound
      // and last-EB placement). Returns total data cells appended (for gridTemplateColumns).
      function buildRowCells(row, cellFactory, sectionCount) {
        let moduleNum = 1;
        for (let s = 0; s < sectionCount; s++) {
          row.appendChild(cellFactory('section', s, null, null));

          if (shouldInsertModuleAfterSection(s + 1, sectionCount, moduleFreq)) {
            row.appendChild(cellFactory('module', s, moduleNum, null));
            moduleNum++;
          }
        }
        for (let t = 0; t < tailSections; t++) {
          row.appendChild(cellFactory('tail', null, null, t));
        }
        return countHeatmapColumnRows(sectionCount, moduleFreq, tailSections);
      }

      // CH row — channel range labels per section column (horizontal has no SEC row)
      const chRow = document.createElement('div');
      chRow.className = 'hm-row hm-row-ch';
      chRow.style.gridTemplateColumns = maxColTemplate;

      const chCorner = document.createElement('div');
      chCorner.className = 'hm-row-label';
      chCorner.textContent = 'CH';
      chRow.appendChild(chCorner);

      buildRowCells(chRow, (type, s, _modNum, tailIdx) => {
        const cell = document.createElement('div');
        if (type === 'section') {
          cell.className = 'hm-vcell hm-channel-ref hm-ch-range';
          const startCh = s * channelsPerSection + 1;
          const endCh = startCh + channelsPerSection - 1;
          cell.textContent = `${startCh}-${endCh}`;
          cell.title = `Channels ${startCh}–${endCh}`;
        } else if (type === 'module') {
          cell.className = 'hm-vcell hm-module-row';
          cell.textContent = '—';
        } else {
          cell.className = 'hm-vcell hm-channel-ref hm-tail-ref';
          cell.textContent = '---';
          cell.title = 'Tail Section (no channels)';
        }
        return cell;
      }, maxSectionsPerCable);
      wrapper.appendChild(chRow);

      // One row per streamer (S1 up to highest); each row is only as wide as
      // its own active sections + EBs + tails — no inactive padding before tails.
      for (let streamerId = 1; streamerId <= cableCount; streamerId++) {
        const sections = lastCleaned[streamerId] || [];
        const deployment = deployments[streamerId] || {};
        const effectiveSections = getEffectiveSectionsPerCable(streamerId);

        const row = document.createElement('div');
        row.className = 'hm-row';

        const streamerLabel = document.createElement('div');
        streamerLabel.className = 'hm-row-label hm-header';
        streamerLabel.textContent = `S${streamerId}`;
        streamerLabel.dataset.streamerId = streamerId;
        streamerLabel.dataset.deploymentDate = deployment.deploymentDate || '';
        streamerLabel.dataset.isCoated = deployment.isCoated === true ? 'true' : deployment.isCoated === false ? 'false' : 'unknown';
        row.appendChild(streamerLabel);

        const cellCount = buildRowCells(row, (type, s, modNum, tailIdx) => {
          if (type === 'module') return buildEbCell(streamerId, modNum, latestEbCleaning);
          const cell = document.createElement('div');
          if (type === 'section') {
            const lastDate = sections[s];
            let days = null;
            if (lastDate) {
              days = Math.floor((Date.now() - new Date(lastDate)) / (1000 * 60 * 60 * 24));
            }
            cell.className = 'hm-vcell hm-active-section';
            cell.dataset.streamer = streamerId;
            cell.dataset.section = s;
            cell.textContent = s + 1;
            cell.dataset.age = ageBucket(days);
            cell.dataset.scrapingDays = days !== null ? String(days) : "";
            const ageText = days === null ? 'never cleaned' : days === 0 ? 'cleaned today' : `cleaned ${days} day${days === 1 ? '' : 's'} ago`;
            cell.title = `Streamer ${streamerId}, Section ${s + 1}: ${ageText}`;
            cell.setAttribute('aria-label', `Streamer ${streamerId}, Section ${s + 1}: ${ageText}`);
          } else {
            const tailSectionIdx = effectiveSections + tailIdx;
            const lastDate = sections[tailSectionIdx] || null;
            let days = null;
            let bucket = 'never';
            if (lastDate) {
              days = Math.floor((Date.now() - new Date(lastDate)) / (1000 * 60 * 60 * 24));
              bucket = ageBucket(days);
            }
            cell.className = 'hm-vcell hm-tail-section';
            cell.dataset.streamer = streamerId;
            cell.dataset.section = tailSectionIdx;
            cell.dataset.isTail = 'true';
            cell.textContent = formatSectionLabel(tailIdx, 'tail');
            cell.dataset.age = bucket;
            cell.dataset.scrapingDays = days !== null ? String(days) : "";
            const tailAgeText = days === null ? 'never cleaned' : days === 0 ? 'cleaned today' : `cleaned ${days} day${days === 1 ? '' : 's'} ago`;
            cell.title = `Streamer ${streamerId}, Tail ${formatSectionLabel(tailIdx, 'tail')}: ${tailAgeText}`;
            cell.setAttribute('aria-label', `Streamer ${streamerId}, Tail ${formatSectionLabel(tailIdx, 'tail')}: ${tailAgeText}`);
          }
          return cell;
        }, effectiveSections);

        row.style.gridTemplateColumns = `var(--hm-label-w, 40px) repeat(${cellCount}, var(--hm-cell-w, 52px))`;
        wrapper.appendChild(row);
      }
    } else {
      // Vertical layout (default): streamers as columns, sections as rows.
      // Use CSS grid with fr units so all columns always fill the container
      // without overflow — no pixel calculations needed.
      wrapper.className = 'hm-grid-vertical';
      wrapper.style.width = '100%';
      wrapper.style.display = 'grid';
      wrapper.style.gridTemplateColumns = `repeat(${cableCount + 1}, minmax(var(--hm-col-min, auto), 1fr))`;
      wrapper.style.gap = '4px';
      wrapper.style.columnGap = '8px';
      // Signal cells to fill their column rather than using a fixed px width
      wrapper.style.setProperty('--hm-cell-w', '100%');
      wrapper.style.setProperty('--hm-cell-h', '32px');


      // Channel reference column (CH)
      const channelCol = document.createElement('div');
      channelCol.className = 'hm-col hm-col-channel';
      channelCol.style.gridTemplateRows = `36px repeat(${totalRows}, 32px)`;

      const channelLabel = document.createElement('div');
      channelLabel.className = 'hm-col-label hm-col-label-channel';
      channelLabel.textContent = 'CH';
      channelCol.appendChild(channelLabel);

      for (let s = 0; s < maxSectionsPerCable; s++) {
        const channelCell = document.createElement('div');
        channelCell.className = 'hm-vcell hm-channel-ref';
        const startCh = s * channelsPerSection + 1;
        const endCh = startCh + channelsPerSection - 1;
        channelCell.textContent = `${startCh}-${endCh}`;
        channelCell.title = `Channels ${startCh}–${endCh}`;
        channelCol.appendChild(channelCell);

        const sectionNumber = s + 1;
        const isFirstModule = sectionNumber === 1;
        const isRegularModule = sectionNumber > 1 && (sectionNumber - 1) % moduleFreq === 0;
        const isLastModule = sectionNumber === maxSectionsPerCable;

        if (isFirstModule || isRegularModule || isLastModule) {
          const moduleChannelCell = document.createElement('div');
          moduleChannelCell.className = 'hm-vcell hm-module-row';
          moduleChannelCell.textContent = '—';
          channelCol.appendChild(moduleChannelCell);
        }
      }

      for (let t = 0; t < tailSections; t++) {
        const tailChannelCell = document.createElement('div');
        tailChannelCell.className = 'hm-vcell hm-channel-ref hm-tail-ref';
        tailChannelCell.textContent = '---';
        tailChannelCell.title = 'Tail Section (no channels)';
        channelCol.appendChild(tailChannelCell);
      }

      wrapper.appendChild(channelCol);

      // Render each streamer column
      for (let streamerId = cableCount; streamerId >= 1; streamerId--) {
        const sections = lastCleaned[streamerId] || [];
        const deployment = deployments[streamerId] || {};
        const effectiveSections = getEffectiveSectionsPerCable(streamerId);

        const colRows = countHeatmapColumnRows(effectiveSections, moduleFreq, tailSections);
        const col = document.createElement('div');
        col.className = 'hm-col';
        col.style.gridTemplateRows = `36px repeat(${colRows}, 32px)`;

        // Streamer header (with deployment data for tooltip)
        const label = document.createElement('div');
        label.className = 'hm-col-label hm-header';
        label.textContent = `S${streamerId}`;
        label.dataset.streamerId = streamerId;
        label.dataset.deploymentDate = deployment.deploymentDate || '';
        label.dataset.isCoated = deployment.isCoated === true ? 'true' : deployment.isCoated === false ? 'false' : 'unknown';
        col.appendChild(label);

        let moduleNum = 1;

        for (let s = 0; s < effectiveSections; s++) {
          // Active section cell
          const cell = document.createElement('div');
          cell.className = 'hm-vcell hm-active-section';
          cell.dataset.streamer = streamerId;
          cell.dataset.section = s;
          cell.textContent = s + 1;

          const lastDate = sections[s];
          let days = null;
          if (lastDate) {
            days = Math.floor((Date.now() - new Date(lastDate)) / (1000 * 60 * 60 * 24));
          }
          const bucket = ageBucket(days);
          cell.dataset.age = bucket;
          cell.dataset.scrapingDays = days !== null ? String(days) : "";

          // Accessible label so screen readers and keyboard users are not
          // reliant on color alone to understand cleaning age.
          const ageText = days === null
            ? 'never cleaned'
            : days === 0 ? 'cleaned today' : `cleaned ${days} day${days === 1 ? '' : 's'} ago`;
          const cellLabel = `Streamer ${streamerId}, Section ${s + 1}: ${ageText}`;
          cell.title = cellLabel;
          cell.setAttribute('aria-label', cellLabel);

          col.appendChild(cell);

          if (shouldInsertModuleAfterSection(s + 1, effectiveSections, moduleFreq)) {
            col.appendChild(buildEbCell(streamerId, moduleNum, latestEbCleaning));
            moduleNum++;
          }
        }

        // Add tail sections if configured
        for (let t = 0; t < tailSections; t++) {
          const tailIdx = effectiveSections + t;
          const tailCell = document.createElement('div');
          tailCell.className = 'hm-vcell hm-tail-section';
          tailCell.dataset.streamer = streamerId;
          tailCell.dataset.section = tailIdx;
          tailCell.dataset.isTail = 'true';
          tailCell.textContent = formatSectionLabel(t, 'tail');

          const lastDate = sections[tailIdx] || null;
          let days = null;
          let bucket = 'never';
          if (lastDate) {
            days = Math.floor((Date.now() - new Date(lastDate)) / (1000 * 60 * 60 * 24));
            bucket = ageBucket(days);
          }
          tailCell.dataset.age = bucket;
          tailCell.dataset.scrapingDays = days !== null ? String(days) : "";

          const tailAgeText = days === null
            ? 'never cleaned'
            : days === 0 ? 'cleaned today' : `cleaned ${days} day${days === 1 ? '' : 's'} ago`;
          const tailLabel = `Streamer ${streamerId}, Tail ${formatSectionLabel(t, 'tail')}: ${tailAgeText}`;
          tailCell.title = tailLabel;
          tailCell.setAttribute('aria-label', tailLabel);

          col.appendChild(tailCell);
        }

        wrapper.appendChild(col);
      }
    }

    // Scroll listener — bound once; renderHeatmap runs every 45 s and on every filter
    // change, so re-adding it here would accumulate handlers for the life of the tab.
    function attachScrollListener() {
      const container = safeGet('heatmap-container');
      if (container.dataset.scrollListenerBound === '1') return;
      container.dataset.scrollListenerBound = '1';
      let scrollTimeout;
      container.addEventListener('scroll', () => {
        container.classList.add('scrolling');
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
          container.classList.remove('scrolling');
        }, 150); // Fade back after 150ms idle
      }, { passive: true });
    }

    attachScrollListener(); // Call once after heatmap rendered

    container.appendChild(wrapper);

    attachDragListeners();
    attachTooltipListeners();
    attachStreamerHeaderTooltips(wrapper, lastCleaned, deployments);
    attachEbCellListeners(wrapper);
    const legendPrefs = loadHeatmapLegendPrefs();
    paintScrapingAgeCells(container, legendPrefs);
    paintEbAgeCells(container, legendPrefs);
  } catch (err) {
    console.error(err);
    showErrorToast("Heatmap Error", "Failed to render the heatmap. Please try refreshing.");
  }
}

/**
 * Single floating tooltip for heatmap streamer column headers.
 * Shows deployment date, days from deployment to first scraping, coating, total cleanings, last cleaned.
 */
function attachStreamerHeaderTooltips(wrapper, lastCleaned, deployments) {
  let tooltipEl = document.getElementById('streamer-header-tooltip');
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'streamer-header-tooltip';
    tooltipEl.className = 'streamer-header-tooltip';
    tooltipEl.style.display = 'none';
    document.body.appendChild(tooltipEl);
  }

  const labels = wrapper.querySelectorAll('[data-streamer-id].hm-header');
  labels.forEach(label => {
    const streamerId = parseInt(label.dataset.streamerId, 10);
    if (!streamerId) return;

    const show = (e) => {
      // Use active project's events so "first scraping" matches deployment (same project); fallback to filtered events if no active project
      const activeProject = getActiveProject();
      const baseEvents = activeProject
        ? events.filter(ev => String(ev.projectNumber) === String(activeProject.projectNumber))
        : getFilteredEvents();
      const streamerEvents = filterEventsByMethod(baseEvents, disabledHeatmapMethods).filter(ev => ev.streamerId === streamerId);

      const data = computeStreamerTooltipData(streamerId, { deployments, lastCleaned, streamerEvents });
      const { daysToFirstScraping, lastCleanedDate, coatingLabel } = data;
      const deployment = data.deployment;

      let html = `<div class="streamer-tooltip-title">Streamer ${streamerId}</div>`;
      if (deployment.deploymentDate) {
        html += `<div class="streamer-tooltip-row">📅 Deployed: ${new Date(deployment.deploymentDate).toLocaleDateString()}</div>`;
        if (daysToFirstScraping !== null) {
          html += `<div class="streamer-tooltip-row">🌊 Days to first scraping: ${daysToFirstScraping}</div>`;
        } else if (streamerEvents.length === 0) {
          html += `<div class="streamer-tooltip-row">🌊 Days to first scraping: No scraping yet</div>`;
        } else {
          html += `<div class="streamer-tooltip-row">🌊 Days to first scraping: —</div>`;
        }
      } else {
        html += `<div class="streamer-tooltip-row">📅 No deployment date</div>`;
      }
      html += `<div class="streamer-tooltip-row">🛡️ Coating: ${coatingLabel}</div>`;
      html += `<div class="streamer-tooltip-row">🧹 Total cleanings: ${streamerEvents.length}</div>`;
      if (lastCleanedDate) {
        html += `<div class="streamer-tooltip-row">✅ Last cleaned: ${new Date(lastCleanedDate).toLocaleDateString()}</div>`;
      } else {
        html += `<div class="streamer-tooltip-row">✅ Last cleaned: Never</div>`;
      }

      tooltipEl.innerHTML = html;
      tooltipEl.style.display = 'block';
      // Use the same positioning logic as section tooltips
      positionTooltipNearCursor(tooltipEl, e);
    };

    const move = (e) => {
      if (tooltipEl.style.display === 'block') {
        positionTooltipNearCursor(tooltipEl, e);
      }
    };

    const hide = () => {
      tooltipEl.style.display = 'none';
    };

    label.addEventListener('mouseenter', show);
    label.addEventListener('mousemove', move);
    label.addEventListener('mouseleave', hide);
  });
}

/* ------------ Drag-to-select ------------ */

const SCROLL_ZONE = 80; // px from viewport edge that triggers auto-scroll during drag
const SCROLL_MAX = 12;  // max px scrolled per animation frame

let _scrollRAF = null;  // requestAnimationFrame handle for the scroll loop
let _mouseY = 0;        // last known mouse clientY, updated via mousemove

function _startScrollLoop() {
  if (_scrollRAF) return;
  function step() {
    if (!dragState.active) { _scrollRAF = null; return; }
    const vh = window.innerHeight;
    let delta = 0;
    if (_mouseY < SCROLL_ZONE) {
      delta = -SCROLL_MAX * (1 - _mouseY / SCROLL_ZONE);
    } else if (_mouseY > vh - SCROLL_ZONE) {
      delta = SCROLL_MAX * ((_mouseY - (vh - SCROLL_ZONE)) / SCROLL_ZONE);
    }
    if (delta !== 0) window.scrollBy(0, delta);
    _scrollRAF = requestAnimationFrame(step);
  }
  _scrollRAF = requestAnimationFrame(step);
}

function _stopScrollLoop() {
  if (_scrollRAF) { cancelAnimationFrame(_scrollRAF); _scrollRAF = null; }
}

let dragDocumentListenersBound = false;

/**
 * Document-level drag handlers are registered exactly once. Per-cell handlers are
 * re-attached on every render because the cells themselves are rebuilt.
 */
function bindDragDocumentListeners() {
  if (dragDocumentListenersBound) return;
  dragDocumentListenersBound = true;

  document.addEventListener('mousemove', (e) => {
    _mouseY = e.clientY;
    if (dragState.active) _startScrollLoop();
  });

  document.addEventListener('mouseup', () => {
    _stopScrollLoop();
    if (dragState.active) {
      showConfirmationModal();
    }
  });
}

function attachDragListeners() {
  bindDragDocumentListeners();
  const cells = document.querySelectorAll('.hm-vcell:not(.hm-module)');

  cells.forEach(cell => {
    cell.addEventListener('mousedown', (e) => {
      e.preventDefault();
      hideSectionTooltip();
      const streamerId = parseInt(cell.dataset.streamer);
      const section = parseInt(cell.dataset.section, 10);

      if (!streamerId || isNaN(section)) return;

      dragState.active = true;
      dragState.streamerId = streamerId;
      dragState.start = section;
      dragState.end = section;
      dragState.cells = Array.from(cells);
      updateDragHighlight();
    });

    cell.addEventListener('mouseenter', () => {
      if (!dragState.active) return;

      const streamerId = parseInt(cell.dataset.streamer);
      const section = parseInt(cell.dataset.section, 10);

      if (streamerId === dragState.streamerId && !isNaN(section)) {
        dragState.end = section;
        updateDragHighlight();
      }
    });
  });
}

function updateDragHighlight() {
  if (!dragState.cells) return;

  const { streamerId, start, end } = dragState;
  const min = Math.min(start, end);
  const max = Math.max(start, end);

  dragState.cells.forEach(cell => {
    const cellStreamer = parseInt(cell.dataset.streamer);
    const cellSection = parseInt(cell.dataset.section, 10);
    const inRange = cellStreamer === streamerId && cellSection >= min && cellSection <= max;
    cell.classList.toggle('dragging', inRange);
  });
}

function clearDragState() {
  _stopScrollLoop();
  if (dragState.cells) {
    dragState.cells.forEach(cell => {
      cell.classList.remove('dragging');
      cell.classList.remove('saved');
    });
  }

  setDragState({
    active: false,
    streamerId: null,
    start: null,
    end: null,
    cells: null,
  });
}

/* ------------ Modal Confirmation ------------ */

let confirmationModalTailOnly = false;

function showConfirmationModal() {
  if (!dragState.active || isFinalizing) return;
  dragState.active = false;
  
  const { streamerId, start, end } = dragState;
  const effectiveSectionsForStreamer = getEffectiveSectionsPerCable(streamerId);
  const min = Math.min(start, end);
  const max = Math.max(start, end);
  const streamerNum = streamerId;
  const streamerInput = safeGet('modal-streamer');
  const startInput = safeGet('modal-start');
  const endInput = safeGet('modal-end');
  const methodSelect = safeGet('modal-method');
  
  const totalSections = getSectionsPerCableWithTail(config, streamerId);
  const tailOnly = min >= effectiveSectionsForStreamer;

  streamerInput.max = config.numCables;
  startInput.min = 1;
  endInput.min = 1;
  if (tailOnly) {
    confirmationModalTailOnly = true;
    startInput.max = 5;
    endInput.max = 5;
    startInput.value = min - effectiveSectionsForStreamer + 1;  // Tail 1-based 1..5
    endInput.value = max - effectiveSectionsForStreamer + 1;
    safeGet('modal-first-section-label').childNodes[0].textContent = 'First Tail Section ';
    safeGet('modal-last-section-label').childNodes[0].textContent = 'Last Tail Section ';
  } else {
    confirmationModalTailOnly = false;
    startInput.max = totalSections;
    endInput.max = totalSections;
    startInput.value = min + 1;  // Global 1-based
    endInput.value = max + 1;
    safeGet('modal-first-section-label').childNodes[0].textContent = 'First Section ';
    safeGet('modal-last-section-label').childNodes[0].textContent = 'Last Section ';
  }
  streamerInput.value = streamerNum;
  methodSelect.value = selectedMethod;

  const now = new Date();
  safeGet('modal-date').value = toDateInputValue(now);
  safeGet('modal-time').value = toTimeInputValue(now);

  updateModalSummary();
  safeGet('confirmation-modal').classList.add('show');
  
  // Update summary when inputs change
  streamerInput.oninput = updateModalSummary;
  startInput.oninput = updateModalSummary;
  endInput.oninput = updateModalSummary;
  methodSelect.oninput = updateModalSummary;
}

function updateModalSummary() {
  const modalStreamerId = parseInt(safeGet('modal-streamer')?.value || '1', 10);
  const effectiveSectionsForStreamer = getEffectiveSectionsPerCable(modalStreamerId);
  let min;
  let max;
  if (confirmationModalTailOnly) {
    const startVal = parseInt(safeGet('modal-start').value || 1, 10) - 1;
    const endVal = parseInt(safeGet('modal-end').value || 1, 10) - 1;
    min = Math.min(startVal, endVal) + effectiveSectionsForStreamer;
    max = Math.max(startVal, endVal) + effectiveSectionsForStreamer;
  } else {
    const start = parseInt(safeGet('modal-start').value || 1, 10) - 1;
    const end = parseInt(safeGet('modal-end').value || 1, 10) - 1;
    min = Math.min(start, end);
    max = Math.max(start, end);
  }
  const labelFor = (s) =>
    s >= effectiveSectionsForStreamer
      ? formatSectionLabel(s - effectiveSectionsForStreamer, 'tail')
      : formatSectionLabel(s, 'active');
  const rangeText = `${labelFor(min)} – ${labelFor(max)}`;
  const channelStart = min < effectiveSectionsForStreamer ? getChannelRange(min).split('–')[0] : '—';
  const channelEnd = max < effectiveSectionsForStreamer ? getChannelRange(max).split('–')[1] : '—';
  const channelText = `${channelStart} – ${channelEnd}`;
  const distance = (max - min + 1) * config.sectionLength;

  safeGet('modal-summary-range').textContent = rangeText;
  safeGet('modal-summary-channels').textContent = channelText;
  safeGet('modal-summary-distance').textContent = `${distance} m`;
}

function closeConfirmationModal() {
  confirmationModalTailOnly = false;
  safeGet('confirmation-modal').classList.remove('show');
  clearDragState();
  setIsFinalizing(false);
}

async function confirmCleaning() {
  if (isFinalizing) return;
  if (!isAdminOrAbove()) {
    showAccessDeniedToast('add cleaning events');
    closeConfirmationModal();
    return;
  }
  
  setIsFinalizing(true);
  
  const streamerNum = parseInt(safeGet('modal-streamer').value, 10);
  const effectiveSectionsForStreamer = getEffectiveSectionsPerCable(streamerNum);
  let startSection = parseInt(safeGet('modal-start').value, 10);
  let endSection = parseInt(safeGet('modal-end').value, 10);
  if (confirmationModalTailOnly) {
    startSection = (startSection - 1) + effectiveSectionsForStreamer + 1;
    endSection = (endSection - 1) + effectiveSectionsForStreamer + 1;
  }
  const method = safeGet('modal-method').value;
  
  // Use project that matches current list filter so the new event appears (important for grand super user where multiple projects can be "active").
  const activeProject = projects.find(p => p.isActive);
  const projectNumber = selectedProjectFilter || config.activeProjectNumber || (activeProject ? activeProject.projectNumber : null);

  const validation = validateStreamerAndSections(streamerNum, startSection, endSection, projectNumber);
  if (!validation.valid) {
    showErrorToast('Out of Range', validation.message);
    setIsFinalizing(false);
    return;
  }
  
  const actualStart = Math.min(startSection, endSection) - 1;
  const actualEnd = Math.max(startSection, endSection) - 1;
  const streamerId = streamerNum;
  
  try {
    const dateVal = safeGet('modal-date').value;
    const timeVal = safeGet('modal-time').value;
    const cleanedAt = (dateVal && timeVal)
      ? new Date(`${dateVal}T${timeVal}`).toISOString()
      : new Date().toISOString();

    const body = {
      streamerId: streamerId,
      sectionIndexStart: actualStart,
      sectionIndexEnd: actualEnd,
      cleaningMethod: method,
      cleanedAt,
      cleaningCount: 1,
      projectNumber: projectNumber,
      vesselTag: config.vesselTag || 'TTN'
    };

    const recentClean = checkRecentCleanings(streamerId, actualStart, actualEnd, cleanedAt);
    if (recentClean) {
      setIsFinalizing(false);
      closeConfirmationModal();
      showRecentCleanWarning(recentClean, body);
      return;
    }

    const adjacentMatch = checkAdjacentEvents(streamerId, actualStart, actualEnd, method, cleanedAt);
    if (adjacentMatch) {
      setIsFinalizing(false);
      closeConfirmationModal();
      showAdjacentMergeModal(adjacentMatch, body);
      return;
    }

    closeConfirmationModal();
    await proceedWithCleaning(body);
  } catch (err) {
    console.error(err);
    showErrorToast('Save Failed', 'Failed to save cleaning event. Please try again.');
  } finally {
    setIsFinalizing(false);
  }
}

/* ------------ Statistics (imported from js/stats.js) ------------ */

async function refreshEverything(preloadedLastCleaned = null) {
  // A filter change always brings the user back to page 1 of the log.
  logPage = 1;

  // Fetch events + last-cleaned data in parallel (last-cleaned is needed by both
  // renderAlerts and renderStreamerCards, so fetch once and share the result).
  const lastCleanedPromise = preloadedLastCleaned
    ? Promise.resolve(preloadedLastCleaned)
    : API.fetchLastCleaned(selectedProjectFilter ? { project: selectedProjectFilter } : {});

  const [, lastCleanedData] = await Promise.all([
    loadEvents(),
    lastCleanedPromise,
    loadEbCleanings(),
  ]);

  // Render log, alerts, and streamer cards in parallel — they use already-loaded
  // state and touch separate DOM regions. allSettled so one failure doesn't cancel
  // the other renders.
  await Promise.allSettled([
    renderLog(),
    renderAlerts(lastCleanedData),
    renderStreamerCards(
      safeGet('filter-start')?.value || null,
      safeGet('filter-end')?.value || null
    ),
  ]);
}

/* ------------ Log Pagination ------------ */

// TODO: migrate to server-side LIMIT/OFFSET pagination on GET /api/events
//       once the dataset grows large enough to make the full fetch expensive.
//       Client-side pagination is a temporary layer — all events are already
//       in memory, so slicing here adds no network cost.

let logPage = 1;
let logPageSize = 50;

/**
 * Renders the Previous / Next controls + page indicator + page-size selector
 * into #log-pagination. Called by renderLog() after each render.
 */
function renderLogPagination(totalRows) {
  const container = document.getElementById("log-pagination");
  if (!container) return;

  const totalPages = Math.max(1, Math.ceil(totalRows / logPageSize));
  const start = totalRows === 0 ? 0 : (logPage - 1) * logPageSize + 1;
  const end = Math.min(logPage * logPageSize, totalRows);

  container.innerHTML = `
    <span class="pagination-info">
      ${totalRows === 0 ? "No events" : `${start}–${end} of ${totalRows}`}
    </span>
    <span class="page-size-label">Rows per page:</span>
    <select id="log-page-size">
      <option value="25" ${logPageSize === 25 ? "selected" : ""}>25</option>
      <option value="50" ${logPageSize === 50 ? "selected" : ""}>50</option>
      <option value="100" ${logPageSize === 100 ? "selected" : ""}>100</option>
    </select>
    <button class="btn btn-secondary" id="btn-log-prev" ${logPage <= 1 ? "disabled" : ""}>← Prev</button>
    <span>${logPage} / ${totalPages}</span>
    <button class="btn btn-secondary" id="btn-log-next" ${logPage >= totalPages ? "disabled" : ""}>Next →</button>
  `;

  document.getElementById("log-page-size")?.addEventListener("change", (e) => {
    logPageSize = Number(e.target.value);
    logPage = 1;
    renderLog();
  });

  document.getElementById("btn-log-prev")?.addEventListener("click", () => {
    if (logPage > 1) { logPage--; renderLog(); }
  });

  document.getElementById("btn-log-next")?.addEventListener("click", () => {
    if (logPage < totalPages) { logPage++; renderLog(); }
  });
}

/* ------------ Sorting ------------ */

let sortState = { column: 'date', ascending: false };

async function sortTable(column) {
  if (sortState.column === column) {
    sortState.ascending = !sortState.ascending;
  } else {
    sortState.column = column;
    sortState.ascending = true;
  }

  const sortedEvents = [...events].sort((a, b) => {
    let valA, valB;

    switch (column) {
      case 'date':
        valA = new Date(a.cleanedAt).getTime();
        valB = new Date(b.cleanedAt).getTime();
        break;
      case 'project':
        valA = a.projectNumber || '';
        valB = b.projectNumber || '';
        break;
      case 'streamer':
        valA = a.streamerId;
        valB = b.streamerId;
        break;
      case 'section':
        valA = a.sectionIndexStart;
        valB = b.sectionIndexStart;
        break;
      case 'distance':
        valA = eventDistance(a);
        valB = eventDistance(b);
        break;
      case 'method':
        valA = a.cleaningMethod;
        valB = b.cleaningMethod;
        break;
      case 'addedby':
        valA = (a.addedByUsertag || '').toLowerCase();
        valB = (b.addedByUsertag || '').toLowerCase();
        break;
      default:
        return 0;
    }

    if (valA < valB) return sortState.ascending ? -1 : 1;
    if (valA > valB) return sortState.ascending ? 1 : -1;
    return 0;
  });

  logPage = 1;
  setEvents(sortedEvents);
  await renderLog();
  updateSortIcons();
}

function updateSortIcons() {
  document.querySelectorAll('.sortable').forEach(th => {
    const icon = th.querySelector('.sort-icon');
    if (th.dataset.sort === sortState.column) {
      icon.textContent = sortState.ascending ? '↑' : '↓';
      th.classList.add('sorted');
    } else {
      icon.textContent = '↕';
      th.classList.remove('sorted');
    }
  });
}

/* ------------ Sidebar Navigation ------------ */

// ---------------------------------------------------------------------------
// Section routing — History API
//
// Maps sidebar section IDs ↔ clean URL paths.
// NOTE: /stats, /planning, /config are taken by server-side standalone pages,
// so the main-page stats section uses /overview to avoid a reload conflict.
// The server catch-all (app.get("*")) already serves index.html for unmatched
// paths, so /log and /overview work correctly on hard reload without any
// additional server changes.
// ---------------------------------------------------------------------------
const SECTION_TO_PATH = {
  'heatmap-section': '/',
  'log-section':     '/log',
  'stats-section':   '/overview',
};
const PATH_TO_SECTION = {
  '/':        'heatmap-section',
  '/log':     'log-section',
  '/overview': 'stats-section',
};
const DEFAULT_SECTION = 'heatmap-section';

/**
 * Scrolls to a section, updates the active nav state, and writes the URL.
 * @param {string} sectionId  - data-target value, e.g. 'log-section'
 * @param {object} opts
 * @param {boolean} opts.smooth   - smooth vs instant scroll (default true)
 * @param {boolean} opts.push     - pushState vs replaceState (default true)
 */
function activateNavSection(sectionId, { smooth = true, push = true } = {}) {
  const targetSection = document.getElementById(sectionId);
  if (!targetSection) return;

  targetSection.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant', block: 'start' });

  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  const navItem = document.querySelector(`.nav-item[data-target="${sectionId}"]`);
  if (navItem) navItem.classList.add('active');

  const path = SECTION_TO_PATH[sectionId] ?? '/';
  // Preserve any existing query params (e.g. ?project=) when updating the path.
  const fullPath = path + window.location.search;
  if (push) {
    history.pushState({ section: sectionId }, '', fullPath);
  } else {
    history.replaceState({ section: sectionId }, '', fullPath);
  }
}

function closeMobileNav() {
  document.body.classList.remove('nav-open');
  const toggle = document.getElementById('nav-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
}

function setupSidebarNavigation() {
  // Hamburger toggle for mobile
  const toggle = document.getElementById('nav-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const isOpen = document.body.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', String(isOpen));
    });
  }

  // Close mobile sidebar when tapping the backdrop
  document.addEventListener('click', (e) => {
    if (
      document.body.classList.contains('nav-open') &&
      !e.target.closest('.sidebar-nav') &&
      !e.target.closest('#nav-toggle')
    ) {
      closeMobileNav();
    }
  });

  // Nav item clicks + keyboard activation (Enter / Space)
  document.querySelectorAll('.nav-item').forEach(item => {
    const activate = () => {
      activateNavSection(item.dataset.target, { smooth: true, push: true });
      closeMobileNav();
    };
    item.addEventListener('click', activate);
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    });
  });

  // Browser back / forward — restore section from state or pathname
  window.addEventListener('popstate', (e) => {
    const sectionId =
      e.state?.section ??
      PATH_TO_SECTION[window.location.pathname] ??
      DEFAULT_SECTION;
    // replaceState so we don't stack a new entry on top of the one being restored
    activateNavSection(sectionId, { smooth: false, push: false });
  });

  // Initial page load — read the URL and activate the matching section.
  // Use replaceState so this does not add an extra history entry.
  const initialSection =
    PATH_TO_SECTION[window.location.pathname] ?? DEFAULT_SECTION;
  activateNavSection(initialSection, { smooth: false, push: false });
}

/* ------------ Event Listeners Setup ------------ */

function setupEventListeners() {
  // Config
  safeGet('btn-save-config')?.addEventListener('click', Projects.saveConfig);
  safeGet('btn-cleanup-streamers')?.addEventListener('click', Projects.cleanupOrphanedStreamers);

  // Method tiles — click + keyboard activation
  document.querySelectorAll('.method-tile').forEach(tile => {
    const activate = () => selectMethod(tile.dataset.method);
    tile.addEventListener('click', activate);
    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    });
  });

  // Manual event entry
  safeGet('btn-add-event')?.addEventListener('click', addEvent);

  // eBird cleaning dialog
  safeGet('btn-eb-clean-save')?.addEventListener('click', saveEbCleaning);
  safeGet('btn-eb-clean-cancel')?.addEventListener('click', closeEbCleanModal);
  safeGet('btn-eb-clean-close')?.addEventListener('click', closeEbCleanModal);
  document.querySelector('#eb-clean-modal .modal-overlay')?.addEventListener('click', closeEbCleanModal);
  safeGet('eb-clean-list')?.addEventListener('click', handleEbCleanListClick);

  // CSV
  safeGet('btn-export-csv')?.addEventListener('click', openExportCsvModal);
  safeGet('btn-export-csv-confirm')?.addEventListener('click', confirmExportCsv);
  safeGet('btn-export-csv-cancel')?.addEventListener('click', closeExportCsvModal);
  safeGet('btn-export-csv-close')?.addEventListener('click', closeExportCsvModal);
  document.querySelector('#export-csv-modal .modal-overlay')?.addEventListener('click', closeExportCsvModal);
  safeGet('btn-import-csv')?.addEventListener('click', importCsv);
  safeGet('csv-input')?.addEventListener('change', (e) => {
    if (e.target.files[0]) {
      handleCsvFile(e.target.files[0]);
    }
  });

  // Clear all events modal
  safeGet('btn-clear-all')?.addEventListener('click', showClearAllModal);
  safeGet('btn-clear-all-confirm')?.addEventListener('click', confirmClearAllEvents);
  safeGet('btn-clear-all-cancel')?.addEventListener('click', closeClearAllModal);
  safeGet('btn-clear-all-close')?.addEventListener('click', closeClearAllModal);
  document.querySelector('#clear-all-modal .modal-overlay')?.addEventListener('click', closeClearAllModal);
  safeGet('clear-all-confirm-input')?.addEventListener('input', () => {
    const btn = safeGet('btn-clear-all-confirm');
    const input = safeGet('clear-all-confirm-input');
    if (btn && input) {
      btn.disabled = input.value.trim().toUpperCase() !== 'DELETE';
    }
  });

  // Filter stats
  safeGet('btn-apply-filter')?.addEventListener('click', () => refreshStatsFiltered());
  safeGet('btn-reset-filter')?.addEventListener('click', resetFilter);

  // Project management
  safeGet('btn-create-project')?.addEventListener('click', Projects.createProject);
  safeGet('btn-activate-project')?.addEventListener('click', Projects.activateSelectedProject);
  safeGet('btn-clear-project')?.addEventListener('click', Projects.clearActiveProject);
  safeGet('btn-save-project-comments')?.addEventListener('click', Projects.saveProjectComments);

  // Project selector change event (for filtering)
  safeGet('project-selector')?.addEventListener('change', (e) => {
    Projects.setProjectFilter(e.target.value);
  });

  // Backup management
  safeGet('btn-create-backup')?.addEventListener('click', Projects.createBackup);
  safeGet('btn-refresh-backups')?.addEventListener('click', Projects.loadBackups);

  // Streamer deployment configuration
  safeGet('btn-save-streamer-deployments')?.addEventListener('click', Projects.saveStreamerDeployments);
  safeGet('btn-set-all-date')?.addEventListener('click', Projects.setAllDeploymentDates);
  safeGet('btn-set-all-coating')?.addEventListener('click', Projects.setAllCoatingStatus);
  safeGet('btn-clear-all-streamers')?.addEventListener('click', Projects.clearAllStreamerDeployments);

  // Modal - Set All Deployment Date
  safeGet('btn-set-all-date-close')?.addEventListener('click', Projects.closeSetAllDateModal);
  safeGet('btn-set-all-date-cancel')?.addEventListener('click', Projects.closeSetAllDateModal);
  safeGet('btn-set-all-date-apply')?.addEventListener('click', Projects.applySetAllDateModal);
  document.querySelector('#set-all-date-modal .modal-overlay')?.addEventListener('click', Projects.closeSetAllDateModal);

  // Modal - Set All Coating
  safeGet('btn-set-all-coating-close')?.addEventListener('click', Projects.closeSetAllCoatingModal);
  safeGet('btn-set-all-coating-cancel')?.addEventListener('click', Projects.closeSetAllCoatingModal);
  safeGet('btn-set-all-coating-apply')?.addEventListener('click', Projects.applySetAllCoatingModal);
  document.querySelector('#set-all-coating-modal .modal-overlay')?.addEventListener('click', Projects.closeSetAllCoatingModal);
  document.querySelectorAll('#set-all-coating-modal .coating-modal-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#set-all-coating-modal .coating-modal-option').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Modal - Clear All Deployments
  safeGet('btn-clear-all-deployments-close')?.addEventListener('click', Projects.closeClearAllDeploymentsModal);
  safeGet('btn-clear-all-deployments-cancel')?.addEventListener('click', Projects.closeClearAllDeploymentsModal);
  safeGet('btn-clear-all-deployments-confirm')?.addEventListener('click', Projects.confirmClearAllDeployments);
  document.querySelector('#clear-all-deployments-modal .modal-overlay')?.addEventListener('click', Projects.closeClearAllDeploymentsModal);

  // Modal - Clear One Streamer
  safeGet('btn-clear-one-deployment-close')?.addEventListener('click', Projects.closeClearOneDeploymentModal);
  safeGet('btn-clear-one-deployment-cancel')?.addEventListener('click', Projects.closeClearOneDeploymentModal);
  safeGet('btn-clear-one-deployment-confirm')?.addEventListener('click', () => Projects.confirmClearOneDeployment());
  document.querySelector('#clear-one-deployment-modal .modal-overlay')?.addEventListener('click', Projects.closeClearOneDeploymentModal);

  // Modal - Cleanup Orphaned Streamers
  safeGet('btn-cleanup-orphaned-close')?.addEventListener('click', Projects.closeCleanupOrphanedModal);
  safeGet('btn-cleanup-orphaned-cancel')?.addEventListener('click', Projects.closeCleanupOrphanedModal);
  safeGet('btn-cleanup-orphaned-confirm')?.addEventListener('click', async () => {
    await Projects.performCleanupOrphanedStreamers();
    Projects.closeCleanupOrphanedModal();
  });
  document.querySelector('#cleanup-orphaned-modal .modal-overlay')?.addEventListener('click', Projects.closeCleanupOrphanedModal);

  // Modal - Confirmation
  safeGet('btn-modal-close')?.addEventListener('click', closeConfirmationModal);
  safeGet('btn-modal-cancel')?.addEventListener('click', closeConfirmationModal);
  safeGet('btn-modal-confirm')?.addEventListener('click', confirmCleaning);
  safeGet('modal-overlay')?.addEventListener('click', closeConfirmationModal);

  // Modal - Delete
  safeGet('btn-delete-close')?.addEventListener('click', closeDeleteModal);
  safeGet('btn-delete-cancel')?.addEventListener('click', closeDeleteModal);
  safeGet('btn-delete-confirm')?.addEventListener('click', confirmDeleteEvent);
  document.querySelector('#delete-modal .modal-overlay')?.addEventListener('click', closeDeleteModal);

  // Modal - Force Delete Project
  safeGet('btn-force-delete-project-close')?.addEventListener('click', Projects.closeForceDeleteProjectModal);
  safeGet('btn-force-delete-project-cancel')?.addEventListener('click', Projects.closeForceDeleteProjectModal);
  document.querySelector('#force-delete-project-modal .modal-overlay')?.addEventListener('click', Projects.closeForceDeleteProjectModal);
  safeGet('force-delete-project-input')?.addEventListener('input', () => {
    const btn = safeGet('btn-force-delete-project-confirm');
    const inp = safeGet('force-delete-project-input');
    if (btn && inp) btn.disabled = inp.value.trim() !== 'DELETE';
  });
  safeGet('btn-force-delete-project-confirm')?.addEventListener('click', () => Projects.confirmForceDeleteProject());

  // Modal - Recent Clean Warning
  safeGet('btn-recent-clean-close')?.addEventListener('click', () => closeModal('recent-clean-warning-modal'));
  safeGet('btn-recent-clean-cancel')?.addEventListener('click', () => closeModal('recent-clean-warning-modal'));
  document.querySelector('#recent-clean-warning-modal .modal-overlay')
    ?.addEventListener('click', () => closeModal('recent-clean-warning-modal'));
  safeGet('btn-recent-clean-confirm')?.addEventListener('click', async () => {
    closeModal('recent-clean-warning-modal');
    if (pendingCleaningPayload) {
      const payload = pendingCleaningPayload;
      pendingCleaningPayload = null;
      await proceedWithCleaning(payload);
    }
  });

  // Modal - Adjacent Event Merge
  safeGet('btn-adjacent-merge-close')?.addEventListener('click', () => closeModal('adjacent-merge-modal'));
  safeGet('btn-adjacent-merge-cancel')?.addEventListener('click', () => {
    adjacentMergeTarget = null;
    pendingCleaningPayload = null;
    closeModal('adjacent-merge-modal');
  });
  document.querySelector('#adjacent-merge-modal .modal-overlay')
    ?.addEventListener('click', () => {
      adjacentMergeTarget = null;
      pendingCleaningPayload = null;
      closeModal('adjacent-merge-modal');
    });
  safeGet('btn-adjacent-merge-separate')?.addEventListener('click', async () => {
    closeModal('adjacent-merge-modal');
    adjacentMergeTarget = null;
    if (pendingCleaningPayload) {
      const payload = pendingCleaningPayload;
      pendingCleaningPayload = null;
      await proceedWithCleaning(payload);
    }
  });
  safeGet('btn-adjacent-merge-confirm')?.addEventListener('click', mergeAdjacentEvent);

  // Modal - Edit
  safeGet('btn-edit-close')?.addEventListener('click', closeEditModal);
  safeGet('btn-edit-cancel')?.addEventListener('click', closeEditModal);
  safeGet('btn-edit-save')?.addEventListener('click', saveEditedEvent);
  document.querySelector('#edit-modal .modal-overlay')?.addEventListener('click', closeEditModal);

  // Sortable table headers
  document.querySelectorAll('.sortable').forEach(th => {
    th.addEventListener('click', () => sortTable(th.dataset.sort));
  });
}


// ------------ Project Collapse Toggle ------------
function setupProjectCollapse() {
  const projectHeader = document.querySelector('.project-header');
  const projectContent = document.getElementById('project-content');
  const collapseIcon = document.getElementById('project-collapse-icon');
  
  if (projectHeader && projectContent && collapseIcon) {
    // Load saved state from localStorage
    const isCollapsed = localStorage.getItem('projectCollapsed') === 'true';
    
    if (isCollapsed) {
      projectContent.classList.add('collapsed');
      collapseIcon.classList.add('collapsed');
    }
    
    projectHeader.addEventListener('click', () => {
      const collapsed = projectContent.classList.toggle('collapsed');
      collapseIcon.classList.toggle('collapsed');
      
      // Save state to localStorage
      localStorage.setItem('projectCollapsed', collapsed);
    });
  }
}

/* ------------ Age legend controls ------------ */

/**
 * Populate the age gradient bar and threshold inputs from prefs, and register
 * input listeners so heatmap cells repaint immediately when the user adjusts
 * any breakpoint without requiring a data re-fetch.
 */
function initAgeLegendControls() {
  const barEl = safeGet("age-gradient-bar");
  const ticksEl = safeGet("age-legend-ticks");
  const resetBtn = safeGet("age-legend-reset-btn");

  function refreshAgeLegend(prefs) {
    if (barEl) barEl.style.background = scrapingAgeLegendGradient(prefs);
    if (ticksEl) renderAgeTicks(ticksEl, prefs);

    prefs.ageBreaks.forEach((val, i) => {
      const input = safeGet(`age-break-${i}`);
      if (input) input.value = val;
    });
  }

  refreshAgeLegend(loadHeatmapLegendPrefs());

  function onBreakInput() {
    const vals = [0, 1, 2, 3].map((i) => {
      const el = safeGet(`age-break-${i}`);
      return el && el.value !== "" ? Number(el.value) : NaN;
    });
    const valid = validateAgeBreaks(vals);
    if (!valid) return;

    valid.forEach((v, i) => {
      const el = safeGet(`age-break-${i}`);
      if (el && Number(el.value) !== v) el.value = v;
    });

    saveHeatmapLegendPrefs({ ageBreaks: valid });
    const newPrefs = loadHeatmapLegendPrefs();
    refreshAgeLegend(newPrefs);

    const container = safeGet("heatmap-container");
    if (container) {
      paintScrapingAgeCells(container, newPrefs);
      paintEbAgeCells(container, newPrefs);
    }
  }

  for (let i = 0; i < 4; i++) {
    safeGet(`age-break-${i}`)?.addEventListener("input", onBreakInput);
  }

  resetBtn?.addEventListener("click", () => {
    saveHeatmapLegendPrefs({ ageBreaks: [...DEFAULT_PREFS.ageBreaks] });
    const resetPrefs = loadHeatmapLegendPrefs();
    refreshAgeLegend(resetPrefs);

    const container = safeGet("heatmap-container");
    if (container) {
      paintScrapingAgeCells(container, resetPrefs);
      paintEbAgeCells(container, resetPrefs);
    }
  });
}

/**
 * Method toggles above the heatmap. Switching a method off re-renders the heatmap as if
 * events of that method did not exist; the choice is remembered on this device.
 */
function initHeatmapMethodFilter() {
  const buttons = document.querySelectorAll(".heatmap-method-toggle");
  const note = safeGet("heatmap-method-filter-note");

  function syncToggles() {
    buttons.forEach((btn) => {
      btn.setAttribute("aria-pressed", String(!disabledHeatmapMethods.includes(btn.dataset.method)));
    });
    if (!note) return;
    const filtered = disabledHeatmapMethods.length > 0;
    note.textContent = filtered
      ? `Not counted: ${disabledHeatmapMethods.map(methodLabel).join(", ")}. Colours and days show the last cleaning by the other methods.`
      : "";
    note.classList.toggle("hidden", !filtered);
  }

  syncToggles();

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = toggleDisabledMethod(disabledHeatmapMethods, btn.dataset.method);
      if (next === null) {
        showWarningToast("One Method Needed", "At least one cleaning method must stay switched on.");
        return;
      }
      disabledHeatmapMethods = saveDisabledMethods(next) ?? next;
      syncToggles();
      renderHeatmap();
    });
  });
}

/* ------------ Init ------------ */

function showAppLoadingOverlay() {
  const overlay = document.getElementById("app-loading-overlay");
  if (overlay) overlay.classList.remove("hidden");
}

function hideAppLoadingOverlay() {
  const overlay = document.getElementById("app-loading-overlay");
  if (overlay) overlay.classList.add("hidden");
}

/** How often to refresh log + heatmap + stats while the tab is visible (hybrid with visibility refresh). */
const DASHBOARD_REFRESH_INTERVAL_MS = 45_000;

let dashboardRefreshTimerId = null;
let dashboardVisibilityHandler = null;
let dashboardRefreshInFlight = false;

/**
 * Fetches events, last-cleaned, deployments, and overall KPI stats in one round-trip pattern
 * shared by initial load and background refresh. Date-filtered stats are fetched inside
 * refreshStatsFiltered() so the active filter-start/filter-end inputs are always respected.
 */
async function fetchDashboardDataBundle() {
  const projectParam = selectedProjectFilter ? encodeURIComponent(selectedProjectFilter) : null;
  const lastCleanedUrl = projectParam
    ? `api/last-cleaned?project=${projectParam}`
    : "api/last-cleaned";
  const statsUrl = projectParam ? `/api/stats?project=${projectParam}` : "/api/stats";
  const active = getActiveProject();
  const deploymentsPromise = active
    ? API.apiCall(`/api/projects/${active.id}/streamer-deployments`).catch(() => ({}))
    : Promise.resolve({});

  const [, lastCleanedData, deployments, overallStats] = await Promise.all([
    loadEvents(),
    API.apiCall(lastCleanedUrl),
    deploymentsPromise,
    API.apiCall(statsUrl),
    loadEbCleanings(),
  ]);

  return { lastCleanedData, deployments, overallStats };
}

function stopDashboardAutoRefresh() {
  if (dashboardRefreshTimerId != null) {
    clearInterval(dashboardRefreshTimerId);
    dashboardRefreshTimerId = null;
  }
  if (dashboardVisibilityHandler) {
    document.removeEventListener("visibilitychange", dashboardVisibilityHandler);
    dashboardVisibilityHandler = null;
  }
}

/**
 * Re-fetches dashboard data and re-renders log, heatmap, alerts, and stats without
 * resetting log pagination — for background tabs returning to foreground and periodic sync.
 */
async function silentRefreshDashboardData() {
  if (!authToken || document.visibilityState !== "visible") return;
  if (dashboardRefreshInFlight) return;
  dashboardRefreshInFlight = true;
  try {
    const { lastCleanedData, deployments, overallStats } = await fetchDashboardDataBundle();
    await Promise.allSettled([
      renderLog(),
      renderAlerts(lastCleanedData),
      renderHeatmap(lastCleanedData, deployments),
      refreshStatsFiltered(lastCleanedData, deployments, overallStats),
    ]);
  } catch (err) {
    console.debug("Background dashboard refresh failed:", err?.message ?? err);
  } finally {
    dashboardRefreshInFlight = false;
  }
}

function startDashboardAutoRefresh() {
  stopDashboardAutoRefresh();

  const tick = () => {
    if (document.visibilityState === "visible") {
      void silentRefreshDashboardData();
    }
  };

  dashboardVisibilityHandler = () => {
    if (document.visibilityState === "visible") {
      void silentRefreshDashboardData();
    }
  };
  document.addEventListener("visibilitychange", dashboardVisibilityHandler);

  dashboardRefreshTimerId = setInterval(tick, DASHBOARD_REFRESH_INTERVAL_MS);
}

async function initApp() {
  showAppLoadingOverlay();
  // Enforce a minimum visible time so the overlay never flashes on fast connections.
  const minVisible = new Promise((resolve) => setTimeout(resolve, 300));

  try {
    await initAppContent();
  } finally {
    await minVisible;
    hideAppLoadingOverlay();
  }
}

/**
 * initAppContent runs on every successful showApp() (initial session or each login).
 * These helpers use addEventListener; without a guard, listeners stack and one user
 * action (e.g. CSV change) runs multiple times.
 */
let dashboardDomListenersBound = false;

async function initAppContent() {
  // Read ?project= from the URL immediately — before any history.replaceState call
  // (setupSidebarNavigation does a replaceState on init). Capturing it here ensures
  // the param is never lost even if replaceState runs before we process it.
  const urlProjectParam = new URLSearchParams(window.location.search).get('project');

  Projects.initProjects({
    refreshEverything,
    renderHeatmap,
    refreshStatsFiltered,
  });

  // Load config and projects in parallel — they are independent requests.
  await Promise.all([Projects.loadConfig(), Projects.loadProjects()]);

  // Determine the project filter. URL param takes priority over the active-project
  // default so that bookmarked/shared URLs open in the correct context.
  const active = getActiveProject();
  if (urlProjectParam) {
    setSelectedProjectFilter(urlProjectParam);
  } else if (active?.projectNumber) {
    setSelectedProjectFilter(String(active.projectNumber));
  }

  // Sync the project selector dropdown to the resolved filter value so the UI
  // reflects the URL on a hard reload.
  const selectorEl = safeGet('project-selector');
  if (selectorEl && selectedProjectFilter) {
    selectorEl.value = selectedProjectFilter;
  }

  // Apply the user's remembered default cleaning method (falls back to scraper-rope).
  selectMethod(loadDefaultCleaningMethod());
  const evtMethodEl = safeGet('evt-method');
  if (evtMethodEl) evtMethodEl.value = selectedMethod;

  const { lastCleanedData, deployments, overallStats } = await fetchDashboardDataBundle();

  // Render using pre-fetched data — no duplicate network calls.
  await renderLog();
  await renderAlerts(lastCleanedData);
  await renderHeatmap(lastCleanedData, deployments);
  await refreshStatsFiltered(lastCleanedData, deployments, overallStats);

  // Set default date/time for manual entry
  const now = new Date();
  const dateStr = toDateInputValue(now);
  const timeStr = toTimeInputValue(now);
  const evtDate = safeGet('evt-date');
  const evtTime = safeGet('evt-time');
  if (evtDate) evtDate.value = dateStr;
  if (evtTime) evtTime.value = timeStr;

  updateOrientationButtons();

  if (!dashboardDomListenersBound) {
    dashboardDomListenersBound = true;
    initModals();
    initCleaningEventsKpiModal();
    setupEventListeners();
    setupSidebarNavigation();
    setupProjectCollapse();
    initAgeLegendControls();
    initHeatmapMethodFilter();
    initOrientationToggle();
  }

  // Update UI based on role after everything is loaded
  updateUIForRole();
  
  initPDFGeneration();

  startDashboardAutoRefresh();
}

/* ------------ Initialization ------------ */

async function init() {
  // Any authenticated request that gets a 401 (server restart wiped the session
  // Map) will call this — skip initApp entirely and drop back to the login screen.
  API.setUnauthorizedHandler(() => {
    stopDashboardAutoRefresh();
    clearSession();
    showLogin();
  });

  document.addEventListener("streamer-maintenance:session-end", stopDashboardAutoRefresh);

  setOnShowAppCallback(async () => {
    await initApp();
  });

  const loginForm = safeGet("login-form");
  if (loginForm) loginForm.addEventListener("submit", handleLogin);


  const logoutBtn = safeGet("logout-btn");
  if (logoutBtn) logoutBtn.addEventListener("click", handleLogout);

  setupPasswordToggle();

  if (loadSession()) {
    const isValid = await validateSession();
    if (isValid) {
      showApp();
      return;
    }
  }

  showLogin();
}

init();
