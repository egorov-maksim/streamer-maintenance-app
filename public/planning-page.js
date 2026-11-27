import { safeGet, showErrorToast, showSuccessToast } from "./js/ui.js";
import {
  setOnShowAppCallback,
  loadSession,
  validateSession,
  showLogin,
  showApp,
  handleLogin,
  handleLogout,
  updateUIForRole,
  setupPasswordToggle,
  isGrandSuperUser,
  isAdminOrAbove,
  isSuperUser,
} from "./js/auth.js";
import * as Projects from "./js/projects.js";
import * as API from "./js/api.js";
import { closeModal, initModals, openModal } from "./js/modals.js";
import {
  config,
  currentUser,
  projects,
  setSelectedProjectFilter,
  selectedProjectFilter,
  getActiveProject,
  noiseData,
  setNoiseData,
  noiseUploads,
  setNoiseUploads,
} from "./js/state.js";
import {
  ageBucket,
  formatEB,
  formatSectionLabel,
  getEBRangeForSectionRange,
  getChannelRangeForSectionRange,
  getConfigForProject,
  getEffectiveSectionsPerCable,
} from "./js/streamer-utils.js";
import { validateNoiseCsv } from "./js/noise-validation.js";
import { buildSectionTooltipHtml } from "./js/section-tooltip.js";
import { loadTooltipRecentCount, initTooltipRecentCountInput } from "./js/tooltip-history-prefs.js";
import { latestEbCleaningMap, applyEbCleaningStatus, buildEbTooltipHtml } from "./js/eb-status.js";
import { aggregateNoiseDatasets } from "./js/noise-aggregate.js";
import { toDateTimeLocalInputValue, dateTimeLocalInputToIso } from "./js/date-utils.js";
import {
  shouldInsertModuleAfterSection,
  countHeatmapColumnRows,
} from "./js/heatmap-layout.js";
import {
  DEFAULT_PREFS,
  loadHeatmapLegendPrefs,
  saveHeatmapLegendPrefs,
  validateAgeBreaks,
  rmsToColor,
  rmsTextColor,
  paintScrapingAgeCells,
  paintEbAgeCells,
  scrapingAgeLegendGradient,
  noiseLegendGradient,
  renderAgeTicks,
  renderNoiseTicks,
} from "./js/heatmap-legend.js";

/* ------------ Noise utilities ------------ */

/**
 * Parse the standard RMS CSV file.
 * CSV format: first column is section number (1-based), remaining columns are cables.
 * Zero values mean the section is not deployed on that cable — excluded from results.
 * @param {string} text - raw CSV text
 * @returns {{ [cableNum: string]: { [sectionNum: string]: number } }}
 */
function parseNoiseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("CSV has no data rows");

  // Parse header: "Active,Cable 01,Cable 02,..." → map column index → cable number
  const headers = lines[0].split(",");
  const cableColumns = []; // [{ colIndex, cableNum }]
  for (let i = 1; i < headers.length; i++) {
    const cableNum = parseInt(headers[i].replace(/[^0-9]/g, ""), 10);
    if (!isNaN(cableNum)) cableColumns.push({ colIndex: i, cableNum });
  }

  const result = {};
  for (let r = 1; r < lines.length; r++) {
    const cols = lines[r].split(",");
    const sectionNum = parseInt(cols[0], 10);
    if (isNaN(sectionNum)) continue;

    for (const { colIndex, cableNum } of cableColumns) {
      const rms = parseFloat(cols[colIndex]);
      if (isNaN(rms) || rms <= 0) continue;
      const cableKey = String(cableNum);
      if (!result[cableKey]) result[cableKey] = {};
      result[cableKey][String(sectionNum)] = rms;
    }
  }
  return result;
}

/**
 * Apply noise-overlay colours and RMS text to all active section cells.
 * @param {HTMLElement} container
 * @param {{ [cableNum: string]: number[] }} nd - noiseData from state
 */
function applyNoiseOverlay(container, nd) {
  const prefs = loadHeatmapLegendPrefs();
  const cells = container.querySelectorAll(".hm-vcell.hm-active-section.hm-planning-cell");
  cells.forEach(cell => {
    const streamerId = cell.dataset.streamer;
    const sectionIndex = parseInt(cell.dataset.section, 10);
    const rms = nd?.[streamerId]?.[sectionIndex] ?? 0;
    const bg = rmsToColor(rms, prefs);
    if (bg) {
      cell.style.backgroundColor = bg;
      cell.style.color = rmsTextColor(rms, prefs);
      cell.style.borderColor = bg;
      cell.textContent = rms.toFixed(1);
    } else {
      cell.style.backgroundColor = "#e5e7eb";
      cell.style.color = "#6b7280";
      cell.style.borderColor = "#d1d5db";
      cell.textContent = "—";
    }
  });
}

/**
 * Remove noise overlay and restore age-mode colours and days text.
 * Re-applies the continuous scraping-age gradient so the heatmap immediately
 * reflects any breakpoint changes made while the noise overlay was active.
 * @param {HTMLElement} container
 */
function removeNoiseOverlay(container) {
  const cells = container.querySelectorAll(".hm-vcell.hm-active-section.hm-planning-cell");
  cells.forEach(cell => {
    cell.textContent = cell.dataset.daysText ?? "—";
  });
  paintScrapingAgeCells(container, loadHeatmapLegendPrefs());
}

/* ------------ Noise UI helpers ------------ */

/**
 * Populate the upload-history selector with past uploads.
 * Dates shown are the sequence time when entered, otherwise the upload time.
 * @param {Array<{ id: number, label: string|null, uploadedAt: string, measuredAt?: string }>} uploads
 */
function populateUploadSelector(uploads) {
  const selector = safeGet("noise-upload-selector");
  if (!selector) return;

  selector.innerHTML = "";
  uploads.forEach(u => {
    const opt = document.createElement("option");
    opt.value = u.id;
    const date = new Date(u.measuredAt || u.uploadedAt).toLocaleDateString();
    opt.textContent = u.label ? `${date} — ${u.label}` : date;
    selector.appendChild(opt);
  });
}

function setNoiseSelectorValue(uploadId) {
  const selector = safeGet("noise-upload-selector");
  if (selector && uploadId != null) selector.value = String(uploadId);
}

/**
 * Render the sequence checkboxes for averaging. Drops ticks for uploads that no longer exist.
 * @param {Array<{ id: number, label: string|null, uploadedAt: string, measuredAt?: string }>} uploads
 * @returns {number[]} ids still ticked after pruning
 */
function populateComparePicker(uploads) {
  const panel = safeGet("noise-compare-panel");
  const list = safeGet("noise-compare-list");
  const available = new Set(uploads.map((u) => u.id));
  [selectedNoiseUploadIds, pendingNoiseUploadIds].forEach((ids) => {
    [...ids].forEach((id) => {
      if (!available.has(id)) ids.delete(id);
    });
  });

  if (list) {
    list.replaceChildren();
    uploads.forEach((u) => {
      const label = document.createElement("label");
      label.className = "noise-compare-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = String(u.id);
      checkbox.checked = pendingNoiseUploadIds.has(u.id);
      // Label first (what crews call the sequence), date second and muted.
      const date = new Date(u.measuredAt || u.uploadedAt).toLocaleDateString();
      const name = document.createElement("span");
      name.className = "noise-compare-option-name";
      name.textContent = u.label || date;
      label.append(checkbox, name);
      if (u.label) {
        const dateEl = document.createElement("span");
        dateEl.className = "noise-compare-option-date";
        dateEl.textContent = date;
        label.append(dateEl);
      }
      list.appendChild(label);
    });
  }

  if (uploads.length === 0 && panel) panel.open = false;
  panel?.classList.toggle("hidden", uploads.length === 0);
  updateComparePickerSummary();
  return [...selectedNoiseUploadIds];
}

/**
 * Sync everything the picker shows. The count badge on the button and the upload selector
 * describe what the heatmap shows; the rows, status line and footer buttons describe the
 * ticks, which only reach the heatmap on "Show on heatmap".
 */
function updateComparePickerSummary() {
  const panel = safeGet("noise-compare-panel");
  if (!panel) return;
  const count = selectedNoiseUploadIds.size;
  const averaging = count >= 2;
  const overlayOn = isNoiseToggleOn();
  const tickedCount = pendingNoiseUploadIds.size;
  const pendingChanges = hasPendingNoiseChanges();

  panel.classList.toggle("is-active", averaging);
  const selector = document.getElementById("noise-upload-selector");
  if (selector) {
    selector.classList.toggle("is-overridden", averaging);
    selector.title = averaging
      ? "An average of several sequences is shown. Choose an upload here to go back to a single one."
      : "Select a historical noise upload to display";
  }

  const countEl = document.getElementById("noise-compare-count");
  if (countEl) {
    countEl.textContent = String(count);
    countEl.classList.toggle("hidden", !averaging);
  }
  panel.querySelector("summary")?.setAttribute(
    "aria-label",
    averaging ? `Average of ${count} sequences` : "Average sequences"
  );

  panel.querySelectorAll(".noise-compare-option").forEach((row) => {
    row.classList.toggle("is-checked", row.querySelector("input")?.checked === true);
  });

  const statusEl = document.getElementById("noise-compare-status");
  if (statusEl) {
    if (tickedCount === 0) statusEl.textContent = pendingChanges ? "None ticked. Show on heatmap to stop averaging." : "None ticked";
    else if (tickedCount === 1) statusEl.textContent = "1 ticked. Tick one more to average.";
    else if (pendingChanges) statusEl.textContent = `${tickedCount} ticked. Show on heatmap to apply.`;
    else statusEl.textContent = overlayOn ? `Averaging ${tickedCount} sequences` : `${tickedCount} ticked. Noise overlay is off.`;
  }

  const clearBtn = document.getElementById("noise-compare-clear");
  if (clearBtn) clearBtn.disabled = tickedCount === 0;
  // Changed ticks, or an average ready with the overlay off: the main button shows them.
  const doneBtn = document.getElementById("noise-compare-done");
  if (doneBtn) {
    doneBtn.textContent = pendingChanges || (tickedCount >= 2 && !overlayOn) ? "Show on heatmap" : "Done";
  }
}

/** Close the sequence picker and return focus to its button. */
function closeComparePicker({ restoreFocus = true } = {}) {
  const panel = safeGet("noise-compare-panel");
  if (!panel?.open) return;
  panel.open = false;
  if (restoreFocus) panel.querySelector("summary")?.focus();
}

function getSelectedNoiseUploadId() {
  const selector = safeGet("noise-upload-selector");
  return selector?.value ? Number(selector.value) : null;
}

function canManageNoiseUploads() {
  return isAdminOrAbove() && !currentUser?.isGlobal;
}

function syncNoiseActionButtons() {
  const renameBtn = safeGet("noise-rename-btn");
  const deleteBtn = safeGet("noise-delete-btn");
  const canManage = canManageNoiseUploads();
  const hasSelection = getSelectedNoiseUploadId() !== null;
  const shouldShow = canManage && noiseUploads.length > 0;

  [renameBtn, deleteBtn].forEach((btn) => {
    if (!btn) return;
    btn.classList.toggle("hidden", !shouldShow);
    btn.disabled = !hasSelection;
  });
}

function updateNoiseToolbarStatus(message = null) {
  const statusEl = safeGet("noise-toolbar-status");
  const waterSpeedEl = safeGet("noise-water-speed-display");
  const overlayOn = isNoiseToggleOn();

  if (!statusEl) return;

  if (message) {
    statusEl.textContent = message;
    statusEl.classList.toggle("hidden", !overlayOn);
    if (waterSpeedEl) waterSpeedEl.classList.add("hidden");
    return;
  }

  if (selectedNoiseUploadIds.size >= 2) {
    statusEl.textContent = `Average of ${selectedNoiseUploadIds.size} sequences. Range is shown in the section tooltip.`;
    statusEl.classList.toggle("hidden", !overlayOn);
    if (waterSpeedEl) waterSpeedEl.classList.add("hidden");
    return;
  }

  if (!noiseUploads.length) {
    statusEl.textContent = "";
    statusEl.classList.add("hidden");
    if (waterSpeedEl) waterSpeedEl.classList.add("hidden");
    return;
  }

  const selectedUploadId = getSelectedNoiseUploadId();
  const selectedUpload = noiseUploads.find((upload) => upload.id === selectedUploadId) || noiseUploads[0];
  if (!selectedUpload) {
    statusEl.textContent = "";
    statusEl.classList.add("hidden");
    if (waterSpeedEl) waterSpeedEl.classList.add("hidden");
    return;
  }

  const date = new Date(selectedUpload.measuredAt || selectedUpload.uploadedAt).toLocaleDateString();
  const label = selectedUpload.label ? ` - ${selectedUpload.label}` : "";
  // Without a sequence time the date is only when the file was uploaded.
  const dateNote = selectedUpload.recordedAt ? "" : " (upload date; no sequence time entered)";
  statusEl.textContent = `Showing RMS upload from ${date}${dateNote}${label}.`;
  statusEl.classList.toggle("hidden", !overlayOn);

  // Show water speed summary near the toggle when the overlay is active
  if (waterSpeedEl) {
    const hasStart = selectedUpload.waterSpeedStart != null;
    const hasEnd = selectedUpload.waterSpeedEnd != null;
    if (overlayOn && (hasStart || hasEnd)) {
      const parts = [];
      if (hasStart) parts.push(`Start: ${selectedUpload.waterSpeedStart} kts`);
      if (hasEnd) parts.push(`End: ${selectedUpload.waterSpeedEnd} kts`);
      waterSpeedEl.textContent = `Water speed — ${parts.join(" · ")}`;
      waterSpeedEl.classList.remove("hidden");
    } else {
      waterSpeedEl.classList.add("hidden");
    }
  }
}

function updateNoiseUploadHelperText() {
  const helperEl = safeGet("noise-upload-helper-text");
  if (!helperEl) return;

  if (!noiseUploads.length) {
    helperEl.textContent = "";
    helperEl.classList.add("hidden");
    return;
  }

  helperEl.textContent = "";
  helperEl.classList.add("hidden");
}

function closeNoiseWaterSpeedModal() {
  pendingUploadState = null;
  const startInput = safeGet("noise-upload-speed-start");
  const endInput = safeGet("noise-upload-speed-end");
  if (startInput) startInput.value = "";
  if (endInput) endInput.value = "";
  const recordedAtInput = safeGet("noise-upload-recorded-at");
  if (recordedAtInput) recordedAtInput.value = "";
  closeModal("noise-water-speed-modal");
}

function closeNoiseRenameModal() {
  const renameInput = safeGet("noise-rename-input");
  if (renameInput) {
    renameInput.value = "";
    delete renameInput.dataset.uploadId;
  }
  const speedStart = safeGet("noise-rename-speed-start");
  const speedEnd = safeGet("noise-rename-speed-end");
  if (speedStart) speedStart.value = "";
  if (speedEnd) speedEnd.value = "";
  closeModal("noise-rename-modal");
}

function closeNoiseDeleteModal() {
  pendingNoiseDeleteUploadId = null;
  closeModal("noise-delete-modal");
}

function isNoiseToggleOn() {
  const toggle = safeGet("noise-toggle");
  return toggle ? toggle.checked : false;
}

function enableNoiseToggle(hasData) {
  const toggle = safeGet("noise-toggle");
  const label = safeGet("noise-toggle-label");
  if (toggle) toggle.disabled = !hasData;
  if (label) label.title = hasData
    ? "Switch heatmap to RMS noise coloring"
    : "Upload a noise CSV to enable this overlay";
  // Keep the sidebar noise shortcut visually in sync with disabled/enabled state
  syncNoiseNavItem();
}

function updatePlanningHeatmapCardTitle() {
  const el = safeGet("planning-heatmap-card-title");
  if (!el) return;
  el.textContent = isNoiseToggleOn() && noiseData
    ? "📋 Average RMS per section"
    : "📋 Days Since Last Scraping";
  updateNoiseToolbarStatus();
}

/* ------------ Tooltip ------------ */

let tooltipEl = null;
/** Cleaning events for the selected project, loaded with the heatmap. */
let planningEvents = [];
/** eBird cleaning entries for the EB tooltips, newest first. */
let planningEbCleanings = [];

function getTooltip() {
  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.className = "section-tooltip";
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

// Mirrors positionTooltipNearCursor in app.js exactly.
// .section-tooltip uses position:fixed, so coordinates are viewport-relative —
// never add window.scrollX/scrollY here.
function positionTooltip(el, event) {
  const baseX = event.clientX + 15;
  const baseY = event.clientY + 15;

  const rect = el.getBoundingClientRect();
  const x = baseX + rect.width > window.innerWidth ? baseX - rect.width - 30 : baseX;
  const y = baseY + rect.height > window.innerHeight ? baseY - rect.height - 30 : baseY;
  // Keep a tall tooltip on screen instead of letting it run off the top or left edge.

  el.style.left = `${Math.max(8, x)}px`;
  el.style.top = `${Math.max(8, y)}px`;
}

function hideTooltip() {
  if (tooltipEl) tooltipEl.classList.remove("show");
}

function attachSectionTooltips(container) {
  const cells = container.querySelectorAll(".hm-vcell.hm-planning-cell");

  cells.forEach(cell => {
    cell.addEventListener("mouseenter", (e) => {
      const streamerId = parseInt(cell.dataset.streamer, 10);
      const sectionIndex = parseInt(cell.dataset.section, 10);
      const isTail = cell.dataset.isTail === "true";
      const effectiveSectionsForStreamer = getEffectiveSectionsPerCable(streamerId);

      const relIndex = isTail ? sectionIndex - effectiveSectionsForStreamer : sectionIndex;
      const sectionLabel = formatSectionLabel(relIndex, isTail ? "tail" : "active");

      // RMS noise for active sections, shown alongside the cleaning history
      let rmsHtml = "";
      if (!isTail && noiseData) {
        const rms = noiseData[streamerId]?.[sectionIndex] ?? 0;
        if (rms > 0) {
          const label = noiseRange ? "Average RMS" : "RMS noise";
          rmsHtml += `<div class="tooltip-row"><span class="tooltip-label">${label}</span><span class="tooltip-value">${rms.toFixed(2)}</span></div>`;
          const range = noiseRange?.[streamerId]?.[sectionIndex];
          if (range && range.count >= 2) {
            rmsHtml += `<div class="tooltip-row"><span class="tooltip-label">Range</span><span class="tooltip-value">${range.min.toFixed(2)}–${range.max.toFixed(2)} (${range.count} sequences)</span></div>`;
          }
        }
      }

      const tip = getTooltip();
      // Planning cells are coloured from api/last-cleaned, which counts every method,
      // so the tooltip counts every method too.
      const html = buildSectionTooltipHtml({
        streamerId,
        sectionIndex,
        isTail,
        relIndex,
        sectionLabel,
        events: planningEvents,
        extraHtml: rmsHtml,
        recentCount: loadTooltipRecentCount(),
      });

      tip.innerHTML = html;
      // Show first so getBoundingClientRect() returns real dimensions for clamping
      tip.classList.add("show");
      positionTooltip(tip, e);
    });

    cell.addEventListener("mousemove", (e) => {
      if (tooltipEl && tooltipEl.classList.contains("show")) {
        positionTooltip(tooltipEl, e);
      }
    });

    cell.addEventListener("mouseleave", hideTooltip);
  });
}

/**
 * Hover tooltip on every EB cell, matching the main page. EB cells are read-only here;
 * cleaning dates are entered from the main page.
 */
function attachEbTooltips(container) {
  container.querySelectorAll(".hm-vcell.hm-module[data-eb-num]").forEach(cell => {
    const streamerId = parseInt(cell.dataset.ebStreamer, 10);
    const ebNumber = parseInt(cell.dataset.ebNum, 10);
    if (!streamerId || !ebNumber) return;

    cell.addEventListener("mouseenter", (e) => {
      const tip = getTooltip();
      tip.innerHTML = buildEbTooltipHtml({
        streamerId,
        ebNumber,
        entries: planningEbCleanings.filter(entry => entry.streamerId === streamerId && entry.ebNumber === ebNumber),
        hint: "Cleaning dates are entered on the main page",
        recentCount: loadTooltipRecentCount(),
      });
      tip.classList.add("show");
      positionTooltip(tip, e);
    });
    cell.addEventListener("mousemove", (e) => {
      if (tooltipEl && tooltipEl.classList.contains("show")) positionTooltip(tooltipEl, e);
    });
    cell.addEventListener("mouseleave", hideTooltip);
  });
}

/* ------------ Cleaning suggestions table ------------ */

// Fallback used when neither the active project nor config has set a threshold yet.
const DEFAULT_DAYS_THRESHOLD = 10;
const NEVER_DAYS = 9999;

// Persists the last-computed suggestions so header clicks can re-sort without refetching.
let currentSuggestions = [];
let sortState = { column: null, direction: "asc" };
let pendingNoiseDeleteUploadId = null;

// Holds parsed CSV data while the water speed modal is open, cleared after upload or cancel.
let pendingUploadState = null;

// Cached last-cleaned data so threshold changes can recompute without re-fetching.
let currentLastCleaned = null;

/**
 * Build an array of contiguous section ranges that need cleaning, sorted by
 * urgency (most days since last scraping first).
 * @param {{ [streamerId: string]: (string|null)[] }} lastCleaned
 * @param {Object} cfg - config with sectionsPerCable, channelsPerSection, moduleFrequency, useRopeForTail, numCables
 * @param {number} [threshold] - minimum days since last cleaning for a section to be included; defaults to DEFAULT_DAYS_THRESHOLD
 * @returns {Array<{ streamerId, startSection, endSection, isTail, maxDays, sectionsRange, ebRange, channelRange }>}
 */
function computeCleaningSuggestions(lastCleaned, cfg, threshold) {
  const daysThreshold = (Number.isFinite(threshold) && threshold >= 1) ? threshold : DEFAULT_DAYS_THRESHOLD;
  const tailSections = cfg.useRopeForTail ? 0 : 5;

  const suggestions = [];

  Object.keys(lastCleaned).forEach((streamerIdStr) => {
    const streamerId = parseInt(streamerIdStr, 10);
    const sections = lastCleaned[streamerIdStr] || [];
    const effectiveSections = getEffectiveSectionsPerCable(streamerId, cfg);
    const totalSections = effectiveSections + tailSections;

    // Process active sections and tail sections as separate groups (never merge across boundary)
    const groups = [
      { start: 0, end: effectiveSections - 1, isTail: false },
    ];
    if (tailSections > 0) {
      groups.push({ start: effectiveSections, end: totalSections - 1, isTail: true });
    }

    groups.forEach(({ start, end, isTail }) => {
      let rangeStart = null;
      let rangeDays = [];

      for (let s = start; s <= end; s++) {
        const date = sections[s] || null;
        const days = date
          ? Math.floor((Date.now() - new Date(date)) / (1000 * 60 * 60 * 24))
          : null;
        const needsCleaning = days === null || days >= daysThreshold;

        if (needsCleaning) {
          if (rangeStart === null) rangeStart = s;
          rangeDays.push(days === null ? NEVER_DAYS : days);
        } else {
          if (rangeStart !== null) {
            const rangeEnd = s - 1;
            suggestions.push(buildSuggestion(streamerId, rangeStart, rangeEnd, isTail, rangeDays, cfg, effectiveSections));
            rangeStart = null;
            rangeDays = [];
          }
        }
      }
      // Flush trailing range
      if (rangeStart !== null) {
        const rangeEnd = end;
        suggestions.push(buildSuggestion(streamerId, rangeStart, rangeEnd, isTail, rangeDays, cfg, effectiveSections));
      }
    });
  });

  return suggestions.sort((a, b) => b.maxDays - a.maxDays);
}

function buildSuggestion(streamerId, startSection, endSection, isTail, rangeDays, cfg, sectionsPerCable) {
  const maxDays = Math.max(...rangeDays);

  const relStart = isTail ? startSection - sectionsPerCable : startSection;
  const relEnd = isTail ? endSection - sectionsPerCable : endSection;
  const sectionType = isTail ? "tail" : "active";

  const startLabel = formatSectionLabel(relStart, sectionType);
  const endLabel = formatSectionLabel(relEnd, sectionType);
  const sectionsRange = startLabel === endLabel ? startLabel : `${startLabel}–${endLabel}`;

  const ebRange = isTail ? "—" : getEBRangeForSectionRange(startSection, endSection, cfg);
  const channelRange = isTail ? "—" : getChannelRangeForSectionRange(startSection, endSection, cfg);

  // Compute average noise for this range from current noise state
  let avgNoise = null;
  if (!isTail && noiseData) {
    const cableKey = String(streamerId);
    const cableNoise = noiseData[cableKey];
    if (cableNoise) {
      const values = [];
      for (let s = startSection; s <= endSection; s++) {
        const rms = cableNoise[s];
        if (rms && rms > 0) values.push(rms);
      }
      if (values.length > 0) {
        avgNoise = values.reduce((sum, v) => sum + v, 0) / values.length;
      }
    }
  }

  return { streamerId, startSection, endSection, isTail, maxDays, sectionsRange, ebRange, channelRange, avgNoise };
}

function formatDaysCell(maxDays) {
  if (maxDays >= NEVER_DAYS) return { text: "Never", bucket: "never" };
  if (maxDays >= 14) return { text: `${maxDays}d`, bucket: "14plus" };
  if (maxDays >= 10) return { text: `${maxDays}d`, bucket: "10plus" };
  if (maxDays >= 7) return { text: `${maxDays}d`, bucket: "7plus" };
  return { text: `${maxDays}d`, bucket: "4plus" };
}

/**
 * Parse the start channel number from a channelRange string like "Ch 1–240".
 * Returns Infinity for tail "—" rows so they sort to the end.
 * @param {string} channelRange
 * @returns {number}
 */
function parseChannelRangeStart(channelRange) {
  if (!channelRange || channelRange === "—") return Infinity;
  const match = channelRange.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : Infinity;
}

/**
 * Sort suggestions array by the given column and direction.
 * Returns a new sorted array; does not mutate the input.
 * @param {Array} suggestions
 * @param {string|null} column - "streamer" | "channelRange" | "avgNoise" | null
 * @param {"asc"|"desc"} direction
 * @returns {Array}
 */
function sortSuggestions(suggestions, column, direction) {
  if (!column) return suggestions;

  const dir = direction === "asc" ? 1 : -1;

  return [...suggestions].sort((a, b) => {
    let va, vb;

    if (column === "streamer") {
      va = a.streamerId;
      vb = b.streamerId;
    } else if (column === "channelRange") {
      va = parseChannelRangeStart(a.channelRange);
      vb = parseChannelRangeStart(b.channelRange);
    } else if (column === "avgNoise") {
      // Null noise (no data) sorts to the end regardless of direction
      if (a.avgNoise === null && b.avgNoise === null) return 0;
      if (a.avgNoise === null) return 1;
      if (b.avgNoise === null) return -1;
      va = a.avgNoise;
      vb = b.avgNoise;
    } else {
      return 0;
    }

    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });
}

/**
 * Update the visual sort indicators in the suggestions table header.
 * @param {string|null} activeColumn
 * @param {"asc"|"desc"} direction
 */
function updateSortIcons(activeColumn, direction) {
  const table = safeGet("cleaning-suggestions-table");
  if (!table) return;

  table.querySelectorAll("th[data-sort]").forEach(th => {
    const col = th.dataset.sort;
    const icon = th.querySelector(".sort-icon");
    if (col === activeColumn) {
      th.classList.add("sorted");
      if (icon) icon.textContent = direction === "asc" ? "↑" : "↓";
    } else {
      th.classList.remove("sorted");
      if (icon) icon.textContent = "↕";
    }
  });
}

/**
 * Attach click listeners to sortable column headers in the suggestions table.
 * Safe to call once on page init.
 */
function initSuggestionsSortHandlers() {
  const table = safeGet("cleaning-suggestions-table");
  if (!table) return;

  table.querySelectorAll("th[data-sort]").forEach(th => {
    th.addEventListener("click", () => {
      const col = th.dataset.sort;
      if (sortState.column === col) {
        sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
      } else {
        sortState.column = col;
        sortState.direction = "asc";
      }
      const sorted = sortSuggestions(currentSuggestions, sortState.column, sortState.direction);
      renderCleaningSuggestions(sorted);
    });
  });
}

/**
 * Populate the threshold display/input from the active project config and wire the save button.
 * The threshold is stored per project via PUT /api/projects/:id, not in global app config.
 * For superusers the input is editable; for others the edit row is hidden via .superuser-only.
 * Called after loadConfig() and loadProjects() complete so config and projects state are ready.
 */
function initSuggestionsThresholdControl() {
  const displayEl = safeGet("suggestions-threshold-display");
  const inputEl = safeGet("suggestions-threshold-input");
  const saveBtn = safeGet("suggestions-threshold-save");

  const currentThreshold = config?.suggestedCleaningThresholdDays ?? DEFAULT_DAYS_THRESHOLD;

  if (displayEl) {
    displayEl.textContent = `${currentThreshold} days`;
    // Editors see the same number in the input next to it.
    displayEl.classList.toggle("hidden", isSuperUser());
  }
  if (inputEl) inputEl.value = currentThreshold;

  if (!saveBtn) return;

  saveBtn.addEventListener("click", async () => {
    const raw = inputEl ? Number(inputEl.value) : NaN;
    if (!Number.isFinite(raw) || raw < 1 || raw > 365 || !Number.isInteger(raw)) {
      showErrorToast("Invalid threshold", "Enter a whole number between 1 and 365.");
      return;
    }

    const activeProject = getActiveProject();
    if (!activeProject) {
      showErrorToast("No active project", "Activate a project before changing the threshold.");
      return;
    }

    saveBtn.disabled = true;
    try {
      // Persist threshold on the project record, preserving all other project fields.
      const body = {
        projectName: activeProject.projectName || null,
        vesselTag: activeProject.vesselTag || "TTN",
        numCables: activeProject.numCables ?? config.numCables,
        sectionsPerCable: activeProject.sectionsPerCable ?? config.sectionsPerCable,
        sectionLength: activeProject.sectionLength ?? config.sectionLength,
        moduleFrequency: activeProject.moduleFrequency ?? config.moduleFrequency,
        channelsPerSection: activeProject.channelsPerSection ?? config.channelsPerSection,
        useRopeForTail: activeProject.useRopeForTail,
        ebFront: activeProject.ebFront,
        comments: activeProject.comments || null,
        suggestedCleaningThresholdDays: raw,
      };
      await API.updateProject(activeProject.id, body);

      // Update shared config state so computeCleaningSuggestions picks it up immediately.
      if (config) config.suggestedCleaningThresholdDays = raw;
      if (displayEl) displayEl.textContent = `${raw} days`;

      // Recompute suggestions from cached data without re-fetching the heatmap.
      if (currentLastCleaned) {
        const effectiveCfg = {
          sectionsPerCable: config.sectionsPerCable,
          channelsPerSection: config.channelsPerSection,
          moduleFrequency: config.moduleFrequency,
          useRopeForTail: config.useRopeForTail,
          ebFront: config.ebFront,
          numCables: config.numCables,
          sectionsPerCableOverrides: config.sectionsPerCableOverrides || {},
        };
        currentSuggestions = computeCleaningSuggestions(currentLastCleaned, effectiveCfg, raw);
        const toRender = sortSuggestions(currentSuggestions, sortState.column, sortState.direction);
        renderCleaningSuggestions(toRender);
      }

      showSuccessToast("Threshold saved", `Suggestions will now show sections not cleaned in ${raw}+ days.`);
    } catch (err) {
      console.error("Failed to save suggestions threshold", err);
      showErrorToast(err.message || "Failed to save threshold");
    } finally {
      saveBtn.disabled = false;
    }
  });
}

function renderCleaningSuggestions(suggestions) {
  const tbody = safeGet("cleaning-suggestions-tbody");
  const table = safeGet("cleaning-suggestions-table");
  if (!tbody) return;

  // Show or hide the noise column based on whether noise data is loaded
  const hasNoise = !!noiseData;
  if (table) table.classList.toggle("has-noise-data", hasNoise);

  updateSortIcons(sortState.column, sortState.direction);

  tbody.innerHTML = "";

  if (suggestions.length === 0) {
    const colspan = hasNoise ? 6 : 5;
    const threshold = config?.suggestedCleaningThresholdDays || DEFAULT_DAYS_THRESHOLD;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="${colspan}" style="text-align:center;color:var(--muted)">No sections due for cleaning — all fresh (within ${threshold - 1} days).</td>`;
    tbody.appendChild(tr);
    return;
  }

  suggestions.forEach(({ streamerId, isTail, maxDays, sectionsRange, ebRange, channelRange, avgNoise }) => {
    const { text: daysText, bucket } = formatDaysCell(maxDays);
    const noiseCellHtml = buildNoiseBadgeHtml(avgNoise, isTail);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="suggestion-days-badge suggestion-days-${bucket}">${daysText}</span></td>
      <td>S${streamerId}${isTail ? " (tail)" : ""}</td>
      <td>${sectionsRange}</td>
      <td>${ebRange}</td>
      <td>${channelRange}</td>
      <td class="noise-col">${noiseCellHtml}</td>
    `;
    tbody.appendChild(tr);
  });
}

function buildNoiseBadgeHtml(avgNoise, isTail) {
  if (isTail || avgNoise === null) return '<span style="color:var(--muted)">—</span>';
  const prefs = loadHeatmapLegendPrefs();
  const bg = rmsToColor(avgNoise, prefs) || "#e5e7eb";
  const color = rmsTextColor(avgNoise, prefs);
  return `<span class="noise-rms-badge" style="background:${bg};color:${color}">${avgNoise.toFixed(1)}</span>`;
}

/* ------------ Heat map orientation ------------ */

const PLANNING_HEATMAP_ORIENTATION_KEY = 'planningHeatmapOrientation';

function getPlanningHeatmapOrientation() {
  return localStorage.getItem(PLANNING_HEATMAP_ORIENTATION_KEY) || 'vertical';
}

function updatePlanningOrientationButtons() {
  const orientation = getPlanningHeatmapOrientation();
  const btnV = document.getElementById('btn-planning-heatmap-vertical');
  const btnH = document.getElementById('btn-planning-heatmap-horizontal');
  if (btnV) btnV.classList.toggle('active', orientation === 'vertical');
  if (btnH) btnH.classList.toggle('active', orientation === 'horizontal');
}

function initPlanningOrientationToggle() {
  document.getElementById('btn-planning-heatmap-vertical')?.addEventListener('click', () => {
    localStorage.setItem(PLANNING_HEATMAP_ORIENTATION_KEY, 'vertical');
    updatePlanningOrientationButtons();
    renderPlanningHeatmap();
  });
  document.getElementById('btn-planning-heatmap-horizontal')?.addEventListener('click', () => {
    localStorage.setItem(PLANNING_HEATMAP_ORIENTATION_KEY, 'horizontal');
    updatePlanningOrientationButtons();
    renderPlanningHeatmap();
  });
}

/* ------------ Heat map rendering ------------ */

async function renderPlanningHeatmap() {
  const container = safeGet("planning-heatmap-container");
  if (!container) return;

  container.innerHTML = "";

  try {
    const projectQuery = selectedProjectFilter ? `?project=${encodeURIComponent(selectedProjectFilter)}` : "";
    const [data, loadedEvents, loadedEbCleanings] = await Promise.all([
      API.apiCall(`api/last-cleaned${projectQuery}`),
      // Cleaning history for the section tooltips; the heatmap still renders without it.
      API.apiCall(`api/events${projectQuery}`).catch(err => {
        console.debug("Cleaning events fetch failed:", err?.message ?? err);
        return [];
      }),
      // eBird cleaning dates, same scope as the main page; EB cells stay plain without them.
      API.fetchEbCleanings(selectedProjectFilter ? { project: selectedProjectFilter } : {}).catch(err => {
        console.debug("eBird cleaning dates fetch failed:", err?.message ?? err);
        return [];
      }),
    ]);
    planningEvents = Array.isArray(loadedEvents) ? loadedEvents : [];
    planningEbCleanings = Array.isArray(loadedEbCleanings) ? loadedEbCleanings : [];
    const latestEbCleaning = latestEbCleaningMap(planningEbCleanings);
    const lastCleaned = data.lastCleaned;
    currentLastCleaned = lastCleaned;

    const effectiveCfg = {
      sectionsPerCable: config.sectionsPerCable,
      channelsPerSection: config.channelsPerSection,
      moduleFrequency: config.moduleFrequency,
      useRopeForTail: config.useRopeForTail,
      ebFront: config.ebFront,
      numCables: config.numCables,
      sectionsPerCableOverrides: config.sectionsPerCableOverrides || {},
    };
    const threshold = config?.suggestedCleaningThresholdDays || DEFAULT_DAYS_THRESHOLD;
    currentSuggestions = computeCleaningSuggestions(lastCleaned, effectiveCfg, threshold);
    const toRender = sortSuggestions(currentSuggestions, sortState.column, sortState.direction);
    renderCleaningSuggestions(toRender);

    const sectionsPerCable = config.sectionsPerCable;
    const cableCount = config.numCables;
    const moduleFreq = config.moduleFrequency;
    const ebFront = !!config.ebFront;
    const channelsPerSection = config.channelsPerSection;
    const useTailSections = !config.useRopeForTail;
    const tailSections = useTailSections ? 5 : 0;
    const overrides = config.sectionsPerCableOverrides || {};
    const maxSectionsPerCable = Object.values(overrides).length > 0
      ? Math.max(sectionsPerCable, ...Object.values(overrides))
      : sectionsPerCable;

    // Calculate total rows = sections + modules + tail sections (based on max sections across all streamers)
    const lastSectionIsRegular = (maxSectionsPerCable - 1) % moduleFreq === 0;
    const modulesCount = 1 + Math.floor((maxSectionsPerCable - 1) / moduleFreq) + (lastSectionIsRegular ? 0 : 1) + (ebFront ? 1 : 0);
    const totalRows = maxSectionsPerCable + modulesCount + tailSections;

    const orientation = getPlanningHeatmapOrientation();
    const wrapper = document.createElement("div");

    if (orientation === 'horizontal') {
      // Horizontal layout: streamers as rows, sections as columns.
      // Cell height fits all streamer rows in ~55% of the viewport height.
      const availH = Math.max(300, window.innerHeight * 0.55);
      const cellHeight = Math.max(24, Math.min(40, Math.floor(availH / (cableCount + 1))));

      // Cell width: compute so ALL section columns fit the container without horizontal scroll.
      const LABEL_W = 40;
      const GAP_H = 1;
      const containerContent = container.clientWidth - 16;
      const cellWidth = Math.max(1, Math.floor((containerContent - LABEL_W) / totalRows - GAP_H));

      wrapper.className = 'hm-grid-horizontal';
      wrapper.style.width = '100%';
      wrapper.style.setProperty('--hm-cell-h', `${cellHeight}px`);
      wrapper.style.setProperty('--hm-cell-w', `${cellWidth}px`);
      wrapper.style.setProperty('--hm-label-w', `${LABEL_W}px`);
      wrapper.style.setProperty('--hm-row-gap', `${GAP_H}px`);
      const chRowHeight = Math.max(48, Math.min(88, cellWidth * 14));
      wrapper.style.setProperty('--hm-ch-row-h', `${chRowHeight}px`);

      const maxColTemplate = `var(--hm-label-w, 40px) repeat(${totalRows}, var(--hm-cell-w, 52px))`;

      // Build interleaved section/EB/tail cells for a single row.
      function buildRowCells(row, cellFactory, sectionCount) {
        if (ebFront) row.appendChild(cellFactory('module', -1, 1, null));
        let moduleNum = ebFront ? 2 : 1;
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
        return countHeatmapColumnRows(sectionCount, moduleFreq, tailSections, ebFront);
      }

      // CH row — channel range labels per section column
      const chRow = document.createElement('div');
      chRow.className = 'hm-row hm-row-ch';
      chRow.style.gridTemplateColumns = maxColTemplate;

      const chCorner = document.createElement('div');
      chCorner.className = 'hm-row-label';
      chCorner.textContent = 'CH';
      chRow.appendChild(chCorner);

      buildRowCells(chRow, (type, s, _modNum, _tailIdx) => {
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

      // One row per streamer (S1 up to highest)
      for (let streamerId = 1; streamerId <= cableCount; streamerId++) {
        const sections = lastCleaned[streamerId] || [];
        const effectiveSections = getEffectiveSectionsPerCable(streamerId);

        const row = document.createElement('div');
        row.className = 'hm-row';

        const streamerLabel = document.createElement('div');
        streamerLabel.className = 'hm-row-label hm-header';
        streamerLabel.textContent = `S${streamerId}`;
        row.appendChild(streamerLabel);

        const cellCount = buildRowCells(row, (type, s, modNum, tailIdx) => {
          const cell = document.createElement('div');
          if (type === 'section') {
            const lastDate = sections[s];
            let days = null;
            if (lastDate) {
              days = Math.floor((Date.now() - new Date(lastDate)) / (1000 * 60 * 60 * 24));
            }
            const daysText = days !== null ? String(days) : "—";
            cell.className = 'hm-vcell hm-active-section hm-planning-cell';
            cell.dataset.streamer = streamerId;
            cell.dataset.section = s;
            cell.dataset.age = ageBucket(days);
            cell.dataset.daysText = daysText;
            cell.textContent = daysText;
          } else if (type === 'module') {
            cell.className = 'hm-vcell hm-module';
            cell.textContent = formatEB(modNum);
            applyEbCleaningStatus(cell, streamerId, modNum, latestEbCleaning);
          } else {
            const tailSectionIdx = effectiveSections + tailIdx;
            const lastDate = sections[tailSectionIdx] || null;
            let days = null;
            if (lastDate) {
              days = Math.floor((Date.now() - new Date(lastDate)) / (1000 * 60 * 60 * 24));
            }
            const tailDaysText = days !== null ? String(days) : "—";
            cell.className = 'hm-vcell hm-tail-section hm-planning-cell';
            cell.dataset.streamer = streamerId;
            cell.dataset.section = tailSectionIdx;
            cell.dataset.isTail = 'true';
            cell.dataset.age = days !== null ? ageBucket(days) : 'never';
            cell.dataset.daysText = tailDaysText;
            cell.textContent = tailDaysText;
          }
          return cell;
        }, effectiveSections);

        row.style.gridTemplateColumns = `var(--hm-label-w, 40px) repeat(${cellCount}, var(--hm-cell-w, 52px))`;
        wrapper.appendChild(row);
      }
    } else {
      // Vertical layout (default): streamers as columns, sections as rows.
      // CSS grid with fr units so all columns fill the container width — same as main page.
      wrapper.className = "hm-grid-vertical";
      wrapper.style.width = "100%";
      wrapper.style.display = "grid";
      wrapper.style.gridTemplateColumns = `repeat(${cableCount + 1}, minmax(var(--hm-col-min, auto), 1fr))`;
      wrapper.style.gap = "4px";
      wrapper.style.columnGap = "8px";
      wrapper.style.setProperty("--hm-cell-w", "100%");
      wrapper.style.setProperty("--hm-cell-h", "32px");

      // Channel reference column (CH)
      const channelCol = document.createElement("div");
      channelCol.className = "hm-col hm-col-channel";
      channelCol.style.gridTemplateRows = `36px repeat(${totalRows}, 32px)`;

      const channelLabel = document.createElement("div");
      channelLabel.className = "hm-col-label hm-col-label-channel";
      channelLabel.textContent = "CH";
      channelCol.appendChild(channelLabel);

      if (ebFront) {
        const frontChannelCell = document.createElement("div");
        frontChannelCell.className = "hm-vcell hm-module-row";
        frontChannelCell.textContent = "—";
        channelCol.appendChild(frontChannelCell);
      }

      for (let s = 0; s < maxSectionsPerCable; s++) {
        const channelCell = document.createElement("div");
        channelCell.className = "hm-vcell hm-channel-ref";
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
          const moduleChannelCell = document.createElement("div");
          moduleChannelCell.className = "hm-vcell hm-module-row";
          moduleChannelCell.textContent = "—";
          channelCol.appendChild(moduleChannelCell);
        }
      }

      for (let t = 0; t < tailSections; t++) {
        const tailChannelCell = document.createElement("div");
        tailChannelCell.className = "hm-vcell hm-channel-ref hm-tail-ref";
        tailChannelCell.textContent = "---";
        tailChannelCell.title = "Tail Section (no channels)";
        channelCol.appendChild(tailChannelCell);
      }

      wrapper.appendChild(channelCol);

      // Render each streamer column (right-to-left: S12..S1)
      for (let streamerId = cableCount; streamerId >= 1; streamerId--) {
        const sections = lastCleaned[streamerId] || [];
        const effectiveSections = getEffectiveSectionsPerCable(streamerId);

        const colRows = countHeatmapColumnRows(effectiveSections, moduleFreq, tailSections, ebFront);
        const col = document.createElement("div");
        col.className = "hm-col";
        col.style.gridTemplateRows = `36px repeat(${colRows}, 32px)`;

        const label = document.createElement("div");
        label.className = "hm-col-label hm-header";
        label.textContent = `S${streamerId}`;
        col.appendChild(label);

        if (ebFront) {
          const frontCell = document.createElement("div");
          frontCell.className = "hm-vcell hm-module";
          frontCell.textContent = formatEB(1);
          applyEbCleaningStatus(frontCell, streamerId, 1, latestEbCleaning);
          col.appendChild(frontCell);
        }
        let moduleNum = ebFront ? 2 : 1;

        for (let s = 0; s < effectiveSections; s++) {
          const lastDate = sections[s];
          let days = null;
          if (lastDate) {
            days = Math.floor((Date.now() - new Date(lastDate)) / (1000 * 60 * 60 * 24));
          }
          const daysText = days !== null ? String(days) : "—";

          const cell = document.createElement("div");
          cell.className = "hm-vcell hm-active-section hm-planning-cell";
          cell.dataset.streamer = streamerId;
          cell.dataset.section = s;
          cell.dataset.age = ageBucket(days);
          cell.dataset.daysText = daysText;
          cell.textContent = daysText;

          col.appendChild(cell);

          if (shouldInsertModuleAfterSection(s + 1, effectiveSections, moduleFreq)) {
            const moduleCell = document.createElement("div");
            moduleCell.className = "hm-vcell hm-module";
            moduleCell.textContent = formatEB(moduleNum);
            applyEbCleaningStatus(moduleCell, streamerId, moduleNum, latestEbCleaning);
            col.appendChild(moduleCell);
            moduleNum++;
          }
        }

        // Tail sections
        for (let t = 0; t < tailSections; t++) {
          const tailIdx = effectiveSections + t;
          const lastDate = sections[tailIdx] || null;
          let days = null;
          if (lastDate) {
            days = Math.floor((Date.now() - new Date(lastDate)) / (1000 * 60 * 60 * 24));
          }
          const tailDaysText = days !== null ? String(days) : "—";

          const tailCell = document.createElement("div");
          tailCell.className = "hm-vcell hm-tail-section hm-planning-cell";
          tailCell.dataset.streamer = streamerId;
          tailCell.dataset.section = tailIdx;
          tailCell.dataset.isTail = "true";
          tailCell.dataset.age = days !== null ? ageBucket(days) : "never";
          tailCell.dataset.daysText = tailDaysText;
          tailCell.textContent = tailDaysText;

          col.appendChild(tailCell);
        }

        wrapper.appendChild(col);
      }
    }

    container.appendChild(wrapper);
    attachSectionTooltips(container);
    attachEbTooltips(container);

    if (isNoiseToggleOn() && noiseData) {
      applyNoiseOverlay(container, noiseData);
    } else {
      // Apply continuous age gradient whenever noise overlay is not active
      paintScrapingAgeCells(container, loadHeatmapLegendPrefs());
    }
    // eBirds have no noise reading, so they always show cleaning age, as on the main page.
    paintEbAgeCells(container, loadHeatmapLegendPrefs());

    updatePlanningHeatmapCardTitle();
  } catch (err) {
    console.error("renderPlanningHeatmap failed:", err);
    showErrorToast(err.message || "Failed to load planning heat map");
  }
}

/* ------------ Noise data loading ------------ */

// Uploads the heatmap is averaging. Two or more are averaged per section.
const selectedNoiseUploadIds = new Set();
// Uploads ticked in the sequence picker. They reach the heatmap only on "Show on heatmap".
const pendingNoiseUploadIds = new Set();
// Per-section min/max/count across the averaged sequences; null in single-upload view.
let noiseRange = null;

/** True when the picker's ticks differ from what the heatmap shows. */
function hasPendingNoiseChanges() {
  if (pendingNoiseUploadIds.size !== selectedNoiseUploadIds.size) return true;
  return [...pendingNoiseUploadIds].some((id) => !selectedNoiseUploadIds.has(id));
}

/** Tick the picker checkboxes to match the pending ticks. */
function syncComparePickerChecks() {
  document.querySelectorAll("#noise-compare-list input[type='checkbox']").forEach((cb) => {
    cb.checked = pendingNoiseUploadIds.has(Number(cb.value));
  });
  updateComparePickerSummary();
}

/** Drop ticks that were never shown, so the picker matches the heatmap again. */
function discardPendingNoiseChanges() {
  if (!hasPendingNoiseChanges()) return;
  pendingNoiseUploadIds.clear();
  selectedNoiseUploadIds.forEach((id) => pendingNoiseUploadIds.add(id));
  syncComparePickerChecks();
}

function clearNoiseSelection() {
  selectedNoiseUploadIds.clear();
  pendingNoiseUploadIds.clear();
  noiseRange = null;
  syncComparePickerChecks();
}

async function loadNoiseData(uploadId, projectNumber) {
  try {
    const result = await API.getNoiseData(uploadId, projectNumber);
    setNoiseData(result.noiseData || null);
    return result;
  } catch (err) {
    console.error("loadNoiseData failed:", err);
    setNoiseData(null);
    return null;
  }
}

async function loadNoiseUploads(projectNumber) {
  try {
    const uploads = await API.getNoiseUploads(projectNumber);
    setNoiseUploads(uploads);
    return uploads;
  } catch (err) {
    console.error("loadNoiseUploads failed:", err);
    setNoiseUploads([]);
    return [];
  }
}

/**
 * Load every ticked sequence and show their per-section average and range.
 * With fewer than two ticked sequences this does nothing; callers load the single upload.
 */
async function applyNoiseSelection() {
  const ids = [...selectedNoiseUploadIds];
  if (ids.length < 2) {
    noiseRange = null;
    return;
  }
  try {
    const results = await Promise.all(ids.map((id) => API.getNoiseData(id, selectedProjectFilter)));
    const { mean, range } = aggregateNoiseDatasets(results.map((r) => r.noiseData || {}));
    setNoiseData(mean);
    noiseRange = range;
  } catch (err) {
    console.error("Averaging RMS sequences failed:", err);
    showErrorToast("Could not average sequences", "Showing the selected upload instead.");
    clearNoiseSelection();
    await loadNoiseData(getSelectedNoiseUploadId(), selectedProjectFilter);
  }
}

/**
 * Show the picker's ticks on the heatmap: load and average them, then redraw.
 */
async function applyComparePickerTicks() {
  selectedNoiseUploadIds.clear();
  pendingNoiseUploadIds.forEach((id) => selectedNoiseUploadIds.add(id));
  const ids = [...selectedNoiseUploadIds];
  if (ids.length >= 2) {
    await applyNoiseSelection();
  } else {
    noiseRange = null;
    const singleId = ids.length === 1 ? ids[0] : getSelectedNoiseUploadId();
    if (ids.length === 1) setNoiseSelectorValue(ids[0]);
    await loadNoiseData(singleId, selectedProjectFilter);
  }
  updateComparePickerSummary();
  updateNoiseToolbarStatus();
  updatePlanningHeatmapCardTitle();
  await renderPlanningHeatmap();
}

/**
 * Reload all noise controls for the given project.
 * Called on init and whenever the project filter changes.
 * @param {string|null} projectNumber
 */
async function refreshNoiseForProject(projectNumber, preferredUploadId = null) {
  const selector = safeGet("noise-upload-selector");
  const toggle = safeGet("noise-toggle");

  if (!projectNumber) {
    // No project selected — clear noise state and disable controls
    setNoiseData(null);
    clearNoiseSelection();
    populateComparePicker([]);
    setNoiseUploads([]);
    selector?.classList.add("hidden");
    syncNoiseActionButtons();
    updateNoiseUploadHelperText();
    updateNoiseToolbarStatus("Select an active project to view RMS noise data.");
    enableNoiseToggle(false);
    // Turn off toggle visually and restore age overlay if it was active
    if (toggle?.checked) {
      toggle.checked = false;
      const container = safeGet("planning-heatmap-container");
      if (container) {
        removeNoiseOverlay(container);
        safeGet("age-legend")?.classList.remove("hidden");
        safeGet("noise-legend")?.classList.add("hidden");
      }
    }
    await renderPlanningHeatmap();
    return;
  }

  const uploads = await loadNoiseUploads(projectNumber);

  if (uploads.length > 0) {
    populateUploadSelector(uploads);
    selector?.classList.remove("hidden");
    const tickedIds = populateComparePicker(uploads);
    const hasPreferredUpload = preferredUploadId != null
      && uploads.some((upload) => upload.id === preferredUploadId);
    const nextUploadId = tickedIds.length === 1
      ? tickedIds[0]
      : (hasPreferredUpload ? preferredUploadId : null);
    if (tickedIds.length >= 2) {
      await applyNoiseSelection();
    } else {
      noiseRange = null;
      const activeUpload = await loadNoiseData(nextUploadId, projectNumber);
      if (activeUpload?.uploadId) setNoiseSelectorValue(activeUpload.uploadId);
    }

    enableNoiseToggle(true);
  } else {
    setNoiseData(null);
    clearNoiseSelection();
    populateComparePicker([]);
    selector?.classList.add("hidden");
    enableNoiseToggle(false);
    // Turn off toggle if it was on
    if (toggle?.checked) {
      toggle.checked = false;
      const container = safeGet("planning-heatmap-container");
      if (container) {
        removeNoiseOverlay(container);
        safeGet("age-legend")?.classList.remove("hidden");
        safeGet("noise-legend")?.classList.add("hidden");
      }
    }
  }

  syncNoiseActionButtons();
  updateNoiseUploadHelperText();
  updateNoiseToolbarStatus();
  await renderPlanningHeatmap();
}

/**
 * Set up noise control event listeners (called once on page init).
 */
function initNoiseControls() {
  const selector = safeGet("noise-upload-selector");
  const toggle = safeGet("noise-toggle");
  const renameBtn = safeGet("noise-rename-btn");
  const deleteBtn = safeGet("noise-delete-btn");
  const renameInput = safeGet("noise-rename-input");
  const renameModalSaveBtn = safeGet("noise-rename-confirm-btn");
  const deleteModalConfirmBtn = safeGet("noise-delete-confirm-btn");
  const renameModalCloseIds = [
    "noise-rename-modal-close",
    "noise-rename-cancel-btn",
    "noise-rename-modal-overlay",
  ];
  const deleteModalCloseIds = [
    "noise-delete-modal-close",
    "noise-delete-cancel-btn",
    "noise-delete-modal-overlay",
  ];
  const waterSpeedModalCloseIds = [
    "noise-water-speed-modal-close",
    "noise-water-speed-cancel-btn",
    "noise-water-speed-modal-overlay",
  ];

  renameModalCloseIds.forEach((id) => {
    safeGet(id)?.addEventListener("click", closeNoiseRenameModal);
  });
  deleteModalCloseIds.forEach((id) => {
    safeGet(id)?.addEventListener("click", closeNoiseDeleteModal);
  });
  waterSpeedModalCloseIds.forEach((id) => {
    safeGet(id)?.addEventListener("click", closeNoiseWaterSpeedModal);
  });

  // Toggle handler
  toggle?.addEventListener("change", () => {
    updateComparePickerSummary();
    const container = safeGet("planning-heatmap-container");
    if (!container) return;
    const ageLegend = safeGet("age-legend");
    const noiseLegend = safeGet("noise-legend");

    if (toggle.checked) {
      if (noiseData) {
        applyNoiseOverlay(container, noiseData);
        ageLegend?.classList.add("hidden");
        noiseLegend?.classList.remove("hidden");
      } else {
        toggle.checked = false;
        showErrorToast("No noise data available. Upload a noise CSV first.");
      }
    } else {
      removeNoiseOverlay(container);
      ageLegend?.classList.remove("hidden");
      noiseLegend?.classList.add("hidden");
    }

    updatePlanningHeatmapCardTitle();
  });

  // Sequence picker handler — tick/untick sequences to average them
  safeGet("noise-compare-list")?.addEventListener("change", (e) => {
    const checkbox = e.target;
    if (!(checkbox instanceof HTMLInputElement) || checkbox.type !== "checkbox") return;
    const id = Number(checkbox.value);
    // Ticks wait in the picker; the heatmap only changes on "Show on heatmap".
    if (checkbox.checked) pendingNoiseUploadIds.add(id);
    else pendingNoiseUploadIds.delete(id);
    updateComparePickerSummary();
  });

  // Clear: untick everything; "Show on heatmap" then goes back to the single selected upload
  safeGet("noise-compare-clear")?.addEventListener("click", () => {
    if (!pendingNoiseUploadIds.size) return;
    pendingNoiseUploadIds.clear();
    syncComparePickerChecks();
  });

  // Closing the picker any other way drops ticks that were never shown
  safeGet("noise-compare-panel")?.addEventListener("toggle", (e) => {
    if (!e.currentTarget.open) discardPendingNoiseChanges();
  });

  // Done / Show on heatmap: close, apply changed ticks, and switch the overlay on for an average
  safeGet("noise-compare-done")?.addEventListener("click", async () => {
    const toggleEl = safeGet("noise-toggle");
    const pendingChanges = hasPendingNoiseChanges();
    const turnOverlayOn =
      pendingNoiseUploadIds.size >= 2 && toggleEl && !toggleEl.checked && !toggleEl.disabled;
    // Commit the ticks before closing, so closing does not discard them.
    const apply = pendingChanges ? applyComparePickerTicks() : null;
    // Close first so focus returns to the picker button before the overlay switches on.
    closeComparePicker();
    if (apply) await apply;
    if (turnOverlayOn && selectedNoiseUploadIds.size >= 2) toggleEl.click();
  });

  // The picker is a dropdown: Escape and a click outside close it
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && safeGet("noise-compare-panel")?.open) closeComparePicker();
  });
  document.addEventListener("click", (e) => {
    const panel = document.getElementById("noise-compare-panel");
    if (panel?.open && e.target instanceof Node && !panel.contains(e.target)) {
      closeComparePicker({ restoreFocus: false });
    }
  });

  // Upload selector handler — load chosen batch and re-render
  selector?.addEventListener("change", async (e) => {
    const uploadId = e.target.value;
    syncNoiseActionButtons();
    if (!uploadId) return;
    // Choosing a single upload leaves the averaging view
    if (selectedNoiseUploadIds.size) clearNoiseSelection();
    await loadNoiseData(uploadId, selectedProjectFilter);
    updateNoiseToolbarStatus();
    await renderPlanningHeatmap();
  });

  renameBtn?.addEventListener("click", () => {
    const uploadId = getSelectedNoiseUploadId();
    if (!uploadId || !selectedProjectFilter) return;

    const selectedUpload = noiseUploads.find((upload) => upload.id === uploadId);
    if (!renameInput) return;

    renameInput.value = selectedUpload?.label || "";
    renameInput.dataset.uploadId = String(uploadId);

    const speedStartInput = safeGet("noise-rename-speed-start");
    const speedEndInput = safeGet("noise-rename-speed-end");
    if (speedStartInput) speedStartInput.value = selectedUpload?.waterSpeedStart ?? "";
    if (speedEndInput) speedEndInput.value = selectedUpload?.waterSpeedEnd ?? "";
    const recordedAtInput = safeGet("noise-rename-recorded-at");
    if (recordedAtInput) {
      recordedAtInput.value = selectedUpload?.recordedAt
        ? toDateTimeLocalInputValue(new Date(selectedUpload.recordedAt))
        : "";
    }

    openModal("noise-rename-modal");
    requestAnimationFrame(() => {
      renameInput.focus();
      renameInput.select();
    });
  });

  renameModalSaveBtn?.addEventListener("click", async () => {
    const uploadId = Number(renameInput?.dataset.uploadId || "");
    const trimmedLabel = renameInput?.value.trim() || "";
    if (!uploadId || !selectedProjectFilter) return;

    if (!trimmedLabel) {
      showErrorToast("Invalid name", "Enter a label for the RMS upload.");
      renameInput?.focus();
      return;
    }

    const speedStartRaw = safeGet("noise-rename-speed-start")?.value.trim();
    const speedEndRaw = safeGet("noise-rename-speed-end")?.value.trim();
    const waterSpeedStart = speedStartRaw !== "" ? parseFloat(speedStartRaw) : null;
    const waterSpeedEnd = speedEndRaw !== "" ? parseFloat(speedEndRaw) : null;

    renameModalSaveBtn.disabled = true;
    try {
      // An empty sequence time clears it, so the upload time is used again.
      const recordedAt = dateTimeLocalInputToIso(safeGet("noise-rename-recorded-at")?.value);
      await API.updateNoiseUpload(uploadId, { label: trimmedLabel, waterSpeedStart, waterSpeedEnd, recordedAt });
      closeNoiseRenameModal();
      await refreshNoiseForProject(selectedProjectFilter, uploadId);
      showSuccessToast("Noise upload updated", `Saved as "${trimmedLabel}"`);
    } catch (err) {
      console.error("Update noise upload failed:", err);
      showErrorToast("Save failed", err.message || "Failed to update noise upload");
    } finally {
      renameModalSaveBtn.disabled = false;
      syncNoiseActionButtons();
    }
  });

  renameInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      renameModalSaveBtn?.click();
    }
  });

  deleteBtn?.addEventListener("click", () => {
    const uploadId = getSelectedNoiseUploadId();
    if (!uploadId || !selectedProjectFilter) return;

    const selectedUpload = noiseUploads.find((upload) => upload.id === uploadId);
    const uploadLabel = selectedUpload?.label || "this RMS upload";
    const messageEl = safeGet("noise-delete-modal-message");
    pendingNoiseDeleteUploadId = uploadId;
    if (messageEl) {
      messageEl.textContent = `Are you sure you want to delete "${uploadLabel}"?`;
    }
    openModal("noise-delete-modal");
  });

  deleteModalConfirmBtn?.addEventListener("click", async () => {
    const uploadId = pendingNoiseDeleteUploadId;
    if (!uploadId || !selectedProjectFilter) return;

    const selectedUpload = noiseUploads.find((upload) => upload.id === uploadId);
    const uploadLabel = selectedUpload?.label || "this RMS upload";

    deleteModalConfirmBtn.disabled = true;
    try {
      await API.deleteNoiseUpload(uploadId);
      closeNoiseDeleteModal();
      await refreshNoiseForProject(selectedProjectFilter);
      showSuccessToast("Noise upload deleted", `"${uploadLabel}" was removed.`);
    } catch (err) {
      console.error("Delete noise upload failed:", err);
      showErrorToast("Delete failed", err.message || "Failed to delete noise upload");
    } finally {
      deleteModalConfirmBtn.disabled = false;
      syncNoiseActionButtons();
    }
  });

  // Upload CSV handler — validate file then open water speed modal before uploading
  const csvInput = safeGet("noise-csv-input");
  csvInput?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    csvInput.value = ""; // reset so same file can be re-uploaded

    if (!selectedProjectFilter) {
      showErrorToast("Select a project first before uploading noise data.");
      return;
    }

    try {
      const text = await file.text();

      const effectiveConfig = getConfigForProject(selectedProjectFilter);
      const validation = validateNoiseCsv(text, effectiveConfig);
      if (!validation.valid) {
        showErrorToast("CSV validation failed", validation.errors.join(" | "));
        return;
      }

      const parsedNoise = parseNoiseCsv(text);
      const label = file.name.replace(/\.csv$/i, "");

      // Store parsed data and open the water speed prompt before uploading
      pendingUploadState = { label, parsedNoise };
      const filenameEl = safeGet("noise-water-speed-modal-filename");
      if (filenameEl) filenameEl.textContent = `File: ${file.name}`;
      openModal("noise-water-speed-modal");
    } catch (err) {
      console.error("Noise CSV read/validate failed:", err);
      showErrorToast(err.message || "Failed to read noise CSV");
    }
  });

  // Water speed modal confirm — complete the upload with optional speed values
  const waterSpeedConfirmBtn = safeGet("noise-water-speed-confirm-btn");
  waterSpeedConfirmBtn?.addEventListener("click", async () => {
    if (!pendingUploadState || !selectedProjectFilter) {
      closeNoiseWaterSpeedModal();
      return;
    }

    const { label, parsedNoise } = pendingUploadState;

    const speedStartRaw = safeGet("noise-upload-speed-start")?.value.trim();
    const speedEndRaw = safeGet("noise-upload-speed-end")?.value.trim();
    const waterSpeedStart = speedStartRaw !== "" ? parseFloat(speedStartRaw) : null;
    const waterSpeedEnd = speedEndRaw !== "" ? parseFloat(speedEndRaw) : null;

    waterSpeedConfirmBtn.disabled = true;
    try {
      await API.uploadNoiseData({
        projectNumber: selectedProjectFilter,
        label,
        noiseData: parsedNoise,
        waterSpeedStart,
        waterSpeedEnd,
        recordedAt: dateTimeLocalInputToIso(safeGet("noise-upload-recorded-at")?.value),
      });
      closeNoiseWaterSpeedModal();
      showSuccessToast("Noise data uploaded", `Saved ${Object.keys(parsedNoise).length} cables from "${label}"`);
      await refreshNoiseForProject(selectedProjectFilter);
    } catch (err) {
      console.error("Noise CSV upload failed:", err);
      showErrorToast(err.message || "Failed to upload noise data");
    } finally {
      waterSpeedConfirmBtn.disabled = false;
    }
  });
}

/* ------------ Legend controls (age + noise thresholds) ------------ */

/**
 * Populate both legend bars and threshold inputs from persisted prefs, and register
 * input event listeners for immediate heatmap repaint and noise-overlay refresh.
 * Called once on page init so event listeners are attached before data loads.
 */
function initLegendControls() {
  const ageBarEl  = safeGet("age-gradient-bar");
  const ageTickEl = safeGet("age-legend-ticks");
  const pivotInput = safeGet("noise-clean-pivot");
  const maxInput   = safeGet("noise-max");

  function updateAgeLegend(prefs) {
    if (ageBarEl) ageBarEl.style.background = scrapingAgeLegendGradient(prefs);
    if (ageTickEl) renderAgeTicks(ageTickEl, prefs);
  }

  function updateNoiseLegendBar(prefs) {
    const noiseBarEl  = safeGet("noise-gradient-bar");
    const noiseTickEl = safeGet("noise-legend-ticks");
    if (noiseBarEl) noiseBarEl.style.background = noiseLegendGradient(prefs);
    if (noiseTickEl) renderNoiseTicks(noiseTickEl, prefs);
  }

  function syncLegendInputs(prefs) {
    prefs.ageBreaks.forEach((val, i) => {
      const input = safeGet(`age-break-${i}`);
      if (input) input.value = val;
    });
    if (pivotInput) pivotInput.value = prefs.noiseCleanPivot;
    if (maxInput) maxInput.value = prefs.noisyMax;
  }

  function repaintPlanningHeatmap(prefs) {
    const container = safeGet("planning-heatmap-container");
    if (!container) return;

    paintEbAgeCells(container, prefs);

    if (isNoiseToggleOn() && noiseData) {
      applyNoiseOverlay(container, noiseData);
      return;
    }

    if (!isNoiseToggleOn()) {
      paintScrapingAgeCells(container, prefs);
    }
  }

  function refreshLegendUI(prefs) {
    updateAgeLegend(prefs);
    updateNoiseLegendBar(prefs);
    syncLegendInputs(prefs);
  }

  refreshLegendUI(loadHeatmapLegendPrefs());

  function onAgeBreakInput() {
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
    refreshLegendUI(newPrefs);
    repaintPlanningHeatmap(newPrefs);
  }

  for (let i = 0; i < 4; i++) {
    safeGet(`age-break-${i}`)?.addEventListener("input", onAgeBreakInput);
  }

  function onNoiseInput() {
    const pivotVal = pivotInput && pivotInput.value !== "" ? Number(pivotInput.value) : NaN;
    const maxVal   = maxInput   && maxInput.value   !== "" ? Number(maxInput.value)   : NaN;

    if (!isFinite(pivotVal) || !isFinite(maxVal)) return;
    if (pivotVal <= 0 || maxVal <= pivotVal) return;

    saveHeatmapLegendPrefs({ noiseCleanPivot: pivotVal, noisyMax: maxVal });
    const newPrefs = loadHeatmapLegendPrefs();
    refreshLegendUI(newPrefs);
    repaintPlanningHeatmap(newPrefs);
  }

  pivotInput?.addEventListener("input", onNoiseInput);
  maxInput?.addEventListener("input", onNoiseInput);

  function resetLegendPrefs() {
    saveHeatmapLegendPrefs({
      ageBreaks: [...DEFAULT_PREFS.ageBreaks],
      noiseCleanPivot: DEFAULT_PREFS.noiseCleanPivot,
      noisyMax: DEFAULT_PREFS.noisyMax,
    });
    const resetPrefs = loadHeatmapLegendPrefs();
    refreshLegendUI(resetPrefs);
    repaintPlanningHeatmap(resetPrefs);
  }

  safeGet("age-legend-reset-btn")?.addEventListener("click", resetLegendPrefs);
  safeGet("noise-legend-reset-btn")?.addEventListener("click", resetLegendPrefs);
}

/* ------------ Active project display ------------ */

function showActiveProject() {
  const display = safeGet("planning-active-project-display");
  if (!display) return;
  const activeProject = getActiveProject();
  if (activeProject) {
    const label = activeProject.projectName
      ? `${activeProject.projectNumber} – ${activeProject.projectName}`
      : String(activeProject.projectNumber);
    display.textContent = label;
    setSelectedProjectFilter(String(activeProject.projectNumber));
  } else {
    display.textContent = "No active project set for this vessel.";
  }
}

/* ------------ Sidebar navigation ------------ */

// Mirrors the interaction pattern from app.js (scroll + active state +
// mobile drawer) but without route/history manipulation. The noise nav
// item is a special action item — it proxies #noise-toggle so all overlay
// validation, legend swapping, and title updates remain in initNoiseControls().

const PLANNING_DEFAULT_SECTION = 'planning-active-project-section';

function activatePlanningNavSection(sectionId, smooth = true) {
  const target = document.getElementById(sectionId);
  if (!target) return;

  target.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant', block: 'start' });

  document.querySelectorAll('.nav-item[data-target]').forEach(i => i.classList.remove('active'));
  const navItem = document.querySelector(`.nav-item[data-target="${sectionId}"]`);
  if (navItem) navItem.classList.add('active');
}

function closePlanningMobileNav() {
  document.body.classList.remove('nav-open');
  const toggle = document.getElementById('nav-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
}

function syncNoiseNavItem() {
  const noiseCheckbox = document.getElementById('noise-toggle');
  const noiseNavItem = document.getElementById('nav-noise-toggle');
  if (!noiseNavItem || !noiseCheckbox) return;

  const isOn = noiseCheckbox.checked;
  const isDisabled = noiseCheckbox.disabled;

  noiseNavItem.classList.toggle('active', isOn);
  noiseNavItem.setAttribute('aria-pressed', String(isOn));
  noiseNavItem.style.opacity = isDisabled ? '0.4' : '';
  noiseNavItem.style.cursor = isDisabled ? 'not-allowed' : '';
}

function setupPlanningNavigation() {
  const hamburger = document.getElementById('nav-toggle');
  if (hamburger) {
    hamburger.addEventListener('click', () => {
      const isOpen = document.body.classList.toggle('nav-open');
      hamburger.setAttribute('aria-expanded', String(isOpen));
    });
  }

  // Close mobile sidebar when tapping the backdrop
  document.addEventListener('click', (e) => {
    if (
      document.body.classList.contains('nav-open') &&
      !e.target.closest('.sidebar-nav') &&
      !e.target.closest('#nav-toggle')
    ) {
      closePlanningMobileNav();
    }
  });

  // Scroll-anchored nav items
  document.querySelectorAll('.nav-item[data-target]').forEach(item => {
    const activate = () => {
      activatePlanningNavSection(item.dataset.target);
      closePlanningMobileNav();
    };
    item.addEventListener('click', activate);
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    });
  });

  // Noise toggle action item — proxies the existing #noise-toggle checkbox
  const noiseNavItem = document.getElementById('nav-noise-toggle');
  if (noiseNavItem) {
    const triggerNoiseToggle = () => {
      const checkbox = document.getElementById('noise-toggle');
      if (!checkbox || checkbox.disabled) return;
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      closePlanningMobileNav();
    };
    noiseNavItem.addEventListener('click', triggerNoiseToggle);
    noiseNavItem.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); triggerNoiseToggle(); }
    });

    // Keep the noise nav item visual state in sync whenever the checkbox changes
    const noiseCheckbox = document.getElementById('noise-toggle');
    noiseCheckbox?.addEventListener('change', syncNoiseNavItem);
  }

  // Keep scroll-anchored items in sync as the user scrolls
  const sectionIds = Array.from(document.querySelectorAll('.nav-item[data-target]'))
    .map(i => i.dataset.target)
    .filter(Boolean);

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          document.querySelectorAll('.nav-item[data-target]').forEach(i => i.classList.remove('active'));
          const navItem = document.querySelector(`.nav-item[data-target="${entry.target.id}"]`);
          if (navItem) navItem.classList.add('active');
        }
      }
    },
    { threshold: 0.25 }
  );

  sectionIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  });

  activatePlanningNavSection(PLANNING_DEFAULT_SECTION, false);
  syncNoiseNavItem();
}

/* ------------ Bootstrap ------------ */

async function initPlanningApp() {
  Projects.initProjects({});
  await Projects.loadConfig();
  await Projects.loadProjects();

  if (isGrandSuperUser()) {
    safeGet("planning-restricted")?.classList.remove("hidden");
    document.querySelectorAll("main > section").forEach((s) => s.classList.add("hidden"));
    updateUIForRole();
    return;
  }

  showActiveProject();
  initModals();
  initLegendControls(); // populates gradient bars and attaches threshold input listeners
  initTooltipRecentCountInput(safeGet("tooltip-recent-count"));
  initSuggestionsThresholdControl(); // populates threshold input and wires save button
  initNoiseControls();  // registers noise toggle/upload event listeners
  initSuggestionsSortHandlers();
  initPlanningOrientationToggle();
  updatePlanningOrientationButtons();
  setupPlanningNavigation(); // left-rail sidebar nav (must run after initNoiseControls)

  // Initial data load — refreshNoiseForProject calls renderPlanningHeatmap internally
  await refreshNoiseForProject(selectedProjectFilter);

  updateUIForRole();
}

async function init() {
  setOnShowAppCallback(async () => {
    await initPlanningApp();
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
