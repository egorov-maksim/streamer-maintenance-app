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
} from "./js/auth.js";
import * as Projects from "./js/projects.js";
import * as API from "./js/api.js";
import {
  config,
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
} from "./js/streamer-utils.js";
import { validateNoiseCsv } from "./js/noise-validation.js";

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
 * Convert an RMS value to a background colour using a two-segment gradient:
 *   0 → dark blue (#1e3a8a), 5 → white (#ffffff), 20+ → deep red (#dc2626)
 * Returns null for zero/missing values (no data).
 * @param {number} rms
 * @returns {string|null}
 */
function rmsToColor(rms) {
  if (!rms || rms <= 0) return null;
  const val = Math.min(rms, 20);
  if (val <= 5) {
    const t = val / 5;
    const r = Math.round(30 + t * (255 - 30));
    const g = Math.round(58 + t * (255 - 58));
    const b = Math.round(138 + t * (255 - 138));
    return `rgb(${r},${g},${b})`;
  }
  const t = (val - 5) / 15;
  const r = Math.round(255 + t * (220 - 255));
  const g = Math.round(255 + t * (38 - 255));
  const b = Math.round(255 + t * (38 - 255));
  return `rgb(${r},${g},${b})`;
}

/**
 * Pick a readable text colour for a given RMS value.
 * @param {number} rms
 * @returns {string}
 */
function rmsTextColor(rms) {
  if (!rms || rms <= 0) return "#6b7280";
  if (rms <= 2.5) return "#ffffff"; // dark blue bg
  if (rms <= 8) return "#1a1a1a";   // near-white / light-orange bg
  return "#ffffff";                   // orange-red bg
}

/**
 * Apply noise-overlay colours and RMS text to all active section cells.
 * @param {HTMLElement} container
 * @param {{ [cableNum: string]: number[] }} nd - noiseData from state
 */
function applyNoiseOverlay(container, nd) {
  const cells = container.querySelectorAll(".hm-vcell.hm-active-section.hm-planning-cell");
  cells.forEach(cell => {
    const streamerId = cell.dataset.streamer;
    const sectionIndex = parseInt(cell.dataset.section, 10);
    const rms = nd?.[streamerId]?.[sectionIndex] ?? 0;
    const bg = rmsToColor(rms);
    if (bg) {
      cell.style.backgroundColor = bg;
      cell.style.color = rmsTextColor(rms);
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
 * @param {HTMLElement} container
 */
function removeNoiseOverlay(container) {
  const cells = container.querySelectorAll(".hm-vcell.hm-active-section.hm-planning-cell");
  cells.forEach(cell => {
    cell.style.backgroundColor = "";
    cell.style.color = "";
    cell.style.borderColor = "";
    cell.textContent = cell.dataset.daysText ?? "—";
  });
}

/* ------------ Noise UI helpers ------------ */

/**
 * Populate the upload-history selector with past uploads.
 * @param {Array<{ id: number, label: string|null, uploadedAt: string }>} uploads
 */
function populateUploadSelector(uploads) {
  const selector = safeGet("noise-upload-selector");
  if (!selector) return;

  selector.innerHTML = "";
  uploads.forEach(u => {
    const opt = document.createElement("option");
    opt.value = u.id;
    const date = new Date(u.uploadedAt).toLocaleDateString();
    opt.textContent = u.label ? `${date} — ${u.label}` : date;
    selector.appendChild(opt);
  });
}

function setNoiseSelectorValue(uploadId) {
  const selector = safeGet("noise-upload-selector");
  if (selector && uploadId != null) selector.value = String(uploadId);
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
}

/* ------------ Tooltip ------------ */

let tooltipEl = null;

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

  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

function hideTooltip() {
  if (tooltipEl) tooltipEl.classList.remove("show");
}

function attachSectionTooltips(container, lastCleaned) {
  const cells = container.querySelectorAll(".hm-vcell.hm-planning-cell");

  cells.forEach(cell => {
    cell.addEventListener("mouseenter", (e) => {
      const streamerId = parseInt(cell.dataset.streamer, 10);
      const sectionIndex = parseInt(cell.dataset.section, 10);
      const isTail = cell.dataset.isTail === "true";
      const sectionsPerCable = config.sectionsPerCable;

      const relIndex = isTail ? sectionIndex - sectionsPerCable : sectionIndex;
      const sectionLabel = formatSectionLabel(relIndex, isTail ? "tail" : "active");

      const sections = lastCleaned[streamerId] || [];
      const lastDate = sections[sectionIndex] || null;

      let daysSince = null;
      if (lastDate) {
        daysSince = Math.floor((Date.now() - new Date(lastDate)) / (1000 * 60 * 60 * 24));
      }

      const tip = getTooltip();
      let html = `<div class="tooltip-header">Streamer ${streamerId}, Section ${sectionLabel}</div>`;
      if (lastDate) {
        html += `<div class="tooltip-row">Last cleaned: ${new Date(lastDate).toLocaleDateString()}</div>`;
        html += `<div class="tooltip-row">Days since: ${daysSince}</div>`;
      } else {
        html += `<div class="tooltip-row">Never cleaned</div>`;
      }

      // Append RMS noise value if data is available for this active section
      if (!isTail && noiseData) {
        const rms = noiseData[streamerId]?.[sectionIndex] ?? 0;
        if (rms > 0) {
          html += `<div class="tooltip-row">RMS noise: <strong>${rms.toFixed(2)}</strong></div>`;
        }
      }

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

/* ------------ Cleaning suggestions table ------------ */

const DAYS_THRESHOLD = 4;
const NEVER_DAYS = 9999;

// Persists the last-computed suggestions so header clicks can re-sort without refetching.
let currentSuggestions = [];
let sortState = { column: null, direction: "asc" };

/**
 * Build an array of contiguous section ranges that need cleaning, sorted by
 * urgency (most days since last scraping first).
 * @param {{ [streamerId: string]: (string|null)[] }} lastCleaned
 * @param {Object} cfg - config with sectionsPerCable, channelsPerSection, moduleFrequency, useRopeForTail, numCables
 * @returns {Array<{ streamerId, startSection, endSection, isTail, maxDays, sectionsRange, ebRange, channelRange }>}
 */
function computeCleaningSuggestions(lastCleaned, cfg) {
  const sectionsPerCable = cfg.sectionsPerCable || 107;
  const tailSections = cfg.useRopeForTail ? 0 : 5;
  const totalSections = sectionsPerCable + tailSections;

  const suggestions = [];

  Object.keys(lastCleaned).forEach((streamerIdStr) => {
    const streamerId = parseInt(streamerIdStr, 10);
    const sections = lastCleaned[streamerIdStr] || [];

    // Process active sections and tail sections as separate groups (never merge across boundary)
    const groups = [
      { start: 0, end: sectionsPerCable - 1, isTail: false },
    ];
    if (tailSections > 0) {
      groups.push({ start: sectionsPerCable, end: totalSections - 1, isTail: true });
    }

    groups.forEach(({ start, end, isTail }) => {
      let rangeStart = null;
      let rangeDays = [];

      for (let s = start; s <= end; s++) {
        const date = sections[s] || null;
        const days = date
          ? Math.floor((Date.now() - new Date(date)) / (1000 * 60 * 60 * 24))
          : null;
        const needsCleaning = days === null || days >= DAYS_THRESHOLD;

        if (needsCleaning) {
          if (rangeStart === null) rangeStart = s;
          rangeDays.push(days === null ? NEVER_DAYS : days);
        } else {
          if (rangeStart !== null) {
            const rangeEnd = s - 1;
            suggestions.push(buildSuggestion(streamerId, rangeStart, rangeEnd, isTail, rangeDays, cfg, sectionsPerCable));
            rangeStart = null;
            rangeDays = [];
          }
        }
      }
      // Flush trailing range
      if (rangeStart !== null) {
        const rangeEnd = end;
        suggestions.push(buildSuggestion(streamerId, rangeStart, rangeEnd, isTail, rangeDays, cfg, sectionsPerCable));
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
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="${colspan}" style="text-align:center;color:var(--muted)">No sections due for cleaning — all fresh (within ${DAYS_THRESHOLD - 1} days).</td>`;
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
  const bg = rmsToColor(avgNoise) || "#e5e7eb";
  const color = rmsTextColor(avgNoise);
  return `<span class="noise-rms-badge" style="background:${bg};color:${color}">${avgNoise.toFixed(1)}</span>`;
}

/* ------------ Heat map rendering ------------ */

async function renderPlanningHeatmap() {
  const container = safeGet("planning-heatmap-container");
  if (!container) return;

  container.innerHTML = "";

  try {
    let url = "api/last-cleaned";
    if (selectedProjectFilter) {
      url += `?project=${encodeURIComponent(selectedProjectFilter)}`;
    }
    const data = await API.apiCall(url);
    const lastCleaned = data.lastCleaned;

    const effectiveCfg = {
      sectionsPerCable: config.sectionsPerCable,
      channelsPerSection: config.channelsPerSection,
      moduleFrequency: config.moduleFrequency,
      useRopeForTail: config.useRopeForTail,
      numCables: config.numCables,
    };
    currentSuggestions = computeCleaningSuggestions(lastCleaned, effectiveCfg);
    const toRender = sortSuggestions(currentSuggestions, sortState.column, sortState.direction);
    renderCleaningSuggestions(toRender);

    const sectionsPerCable = config.sectionsPerCable;
    const cableCount = config.numCables;
    const moduleFreq = config.moduleFrequency;
    const channelsPerSection = config.channelsPerSection;
    const useTailSections = !config.useRopeForTail;
    const tailSections = useTailSections ? 5 : 0;

    // Calculate total rows = sections + modules + tail sections
    const modulesCount = Math.floor(sectionsPerCable / moduleFreq);
    const totalRows = sectionsPerCable + modulesCount + tailSections;

    const wrapper = document.createElement("div");
    wrapper.className = "hm-grid-vertical";

    // Channel reference column (CH)
    const channelCol = document.createElement("div");
    channelCol.className = "hm-col hm-col-channel";
    channelCol.style.gridTemplateRows = `36px repeat(${totalRows}, 32px)`;

    const channelLabel = document.createElement("div");
    channelLabel.className = "hm-col-label hm-col-label-channel";
    channelLabel.textContent = "CH";
    channelCol.appendChild(channelLabel);

    for (let s = 0; s < sectionsPerCable; s++) {
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
      const isLastModule = sectionNumber === sectionsPerCable;

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

      const col = document.createElement("div");
      col.className = "hm-col";
      col.style.gridTemplateRows = `36px repeat(${totalRows}, 32px)`;

      const label = document.createElement("div");
      label.className = "hm-col-label hm-header";
      label.textContent = `S${streamerId}`;
      col.appendChild(label);

      let moduleNum = 1;

      for (let s = 0; s < sectionsPerCable; s++) {
        const lastDate = sections[s];
        let days = null;
        if (lastDate) {
          days = Math.floor((Date.now() - new Date(lastDate)) / (1000 * 60 * 60 * 24));
        }
        const bucket = ageBucket(days);

        const cell = document.createElement("div");
        cell.className = "hm-vcell hm-active-section hm-planning-cell";
        cell.dataset.streamer = streamerId;
        cell.dataset.section = s;
        cell.dataset.age = bucket;
        // Store days text so noise toggle can restore it
        const daysText = days !== null ? String(days) : "—";
        cell.dataset.daysText = daysText;
        cell.textContent = daysText;

        col.appendChild(cell);

        const sectionNumber = s + 1;
        const isFirstModule = sectionNumber === 1;
        const isRegularModule = sectionNumber > 1 && (sectionNumber - 1) % moduleFreq === 0;
        const isLastModule = sectionNumber === sectionsPerCable;

        if (isFirstModule || isRegularModule || isLastModule) {
          const moduleCell = document.createElement("div");
          moduleCell.className = "hm-vcell hm-module";
          moduleCell.textContent = formatEB(moduleNum);
          moduleCell.title = `Equipment Box ${String(moduleNum).padStart(2, "0")}`;
          col.appendChild(moduleCell);
          moduleNum++;
        }
      }

      // Tail sections
      for (let t = 0; t < tailSections; t++) {
        const tailIdx = sectionsPerCable + t;
        const lastDate = sections[tailIdx] || null;
        let days = null;
        if (lastDate) {
          days = Math.floor((Date.now() - new Date(lastDate)) / (1000 * 60 * 60 * 24));
        }
        const bucket = days !== null ? ageBucket(days) : "never";

        const tailCell = document.createElement("div");
        tailCell.className = "hm-vcell hm-tail-section hm-planning-cell";
        tailCell.dataset.streamer = streamerId;
        tailCell.dataset.section = tailIdx;
        tailCell.dataset.isTail = "true";
        tailCell.dataset.age = bucket;
        const tailDaysText = days !== null ? String(days) : "—";
        tailCell.dataset.daysText = tailDaysText;
        tailCell.textContent = tailDaysText;

        col.appendChild(tailCell);
      }

      wrapper.appendChild(col);
    }

    container.appendChild(wrapper);
    attachSectionTooltips(container, lastCleaned);

    // Re-apply noise overlay if the toggle is currently active
    if (isNoiseToggleOn() && noiseData) {
      applyNoiseOverlay(container, noiseData);
    }

  } catch (err) {
    console.error("renderPlanningHeatmap failed:", err);
    showErrorToast(err.message || "Failed to load planning heat map");
  }
}

/* ------------ Noise data loading ------------ */

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
 * Reload all noise controls for the given project.
 * Called on init and whenever the project filter changes.
 * @param {string|null} projectNumber
 */
async function refreshNoiseForProject(projectNumber) {
  const selector = safeGet("noise-upload-selector");
  const toggle = safeGet("noise-toggle");

  if (!projectNumber) {
    // No project selected — clear noise state and disable controls
    setNoiseData(null);
    setNoiseUploads([]);
    selector?.classList.add("hidden");
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

    const latest = await loadNoiseData(null, projectNumber);
    if (latest?.uploadId) setNoiseSelectorValue(latest.uploadId);

    enableNoiseToggle(true);
  } else {
    setNoiseData(null);
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

  await renderPlanningHeatmap();
}

/**
 * Set up noise control event listeners (called once on page init).
 */
function initNoiseControls() {
  const selector = safeGet("noise-upload-selector");
  const toggle = safeGet("noise-toggle");

  // Toggle handler
  toggle?.addEventListener("change", () => {
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
  });

  // Upload selector handler — load chosen batch and re-render
  selector?.addEventListener("change", async (e) => {
    const uploadId = e.target.value;
    if (!uploadId) return;
    await loadNoiseData(uploadId, selectedProjectFilter);
    await renderPlanningHeatmap();
  });

  // Upload CSV handler
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
      await API.uploadNoiseData({ projectNumber: selectedProjectFilter, label, noiseData: parsedNoise });
      showSuccessToast("Noise data uploaded", `Saved ${Object.keys(parsedNoise).length} cables from "${label}"`);

      // Refresh the upload list and load the new batch for the current project
      await refreshNoiseForProject(selectedProjectFilter);
    } catch (err) {
      console.error("Noise CSV upload failed:", err);
      showErrorToast(err.message || "Failed to upload noise data");
    }
  });
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
  initNoiseControls(); // registers event listeners only (no async data loading)
  initSuggestionsSortHandlers();

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

  const loginBtn = safeGet("login-submit");
  if (loginBtn) loginBtn.addEventListener("click", handleLogin);

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
