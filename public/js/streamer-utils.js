/**
 * Domain helpers that depend on config/projects (streamer sections, validation, formatting).
 */

import { config, projects } from "./state.js";
import { getModuleLayout } from "./heatmap-layout.js";

export function sectionCount(evt) {
  return evt.sectionIndexEnd - evt.sectionIndexStart + 1;
}

export function eventDistance(evt) {
  return sectionCount(evt) * (config?.sectionLength || 1);
}

export function ageBucket(days) {
  if (days === null) return "never";
  if (days <= 0) return "fresh";
  if (days >= 14) return "14plus";
  if (days >= 10) return "10plus";
  if (days >= 7) return "7plus";
  if (days >= 4) return "4plus";
  return "fresh";
}

export function fmtKm(meters) {
  return `${(meters / 1000).toFixed(1)} km`;
}

export function getChannelRange(sectionIndex) {
  const channelsPerSection = config?.channelsPerSection;
  const startChannel = sectionIndex * channelsPerSection + 1;
  const endChannel = startChannel + channelsPerSection - 1;
  return `Ch ${startChannel}–${endChannel}`;
}

export function formatAS(sectionIndex) {
  return `AS${String(sectionIndex + 1).padStart(2, "0")}`;
}

/**
 * Format section label by type: active -> AS01..AS107, tail -> Tail 1..Tail 5.
 * @param {number} sectionIndex - 0-based (active 0..N-1 or tail-relative 0..4)
 * @param {'active'|'tail'} sectionType
 * @returns {string}
 */
export function formatSectionLabel(sectionIndex, sectionType) {
  if (sectionType === "tail") {
    return `Tail ${sectionIndex + 1}`;
  }
  return formatAS(sectionIndex);
}

/**
 * "AS05–AS10" / "Tail 1–Tail 3": start label first, then end label. Shared by the
 * log table, the recent-events modal and the modals so every view agrees.
 * @param {{ sectionIndexStart: number, sectionIndexEnd: number, sectionType?: string }} evt
 * @returns {string}
 */
export function formatRangeLabel(evt) {
  const sectionType = evt.sectionType || "active";
  return `${formatSectionLabel(evt.sectionIndexStart, sectionType)}–${formatSectionLabel(evt.sectionIndexEnd, sectionType)}`;
}

export function formatEB(num) {
  return `EB${String(num).padStart(2, "0")}`;
}

/**
 * Calculate EB range label for a contiguous section range (active sections only).
 * Ports the logic from backend/utils/eb.js to run client-side without an API call.
 * Returns "—" for tail sections (startSection >= sectionsPerCable).
 * @param {number} startSection - 0-based start section index
 * @param {number} endSection - 0-based end section index
 * @param {Object} cfg - config with moduleFrequency, sectionsPerCable and ebFront
 * @returns {string}
 */
export function getEBRangeForSectionRange(startSection, endSection, cfg) {
  const moduleFreq = cfg?.moduleFrequency || 4;
  const sectionsPerCable = cfg?.sectionsPerCable || 107;

  if (startSection >= sectionsPerCable || endSection >= sectionsPerCable) {
    return "—";
  }

  const allModules = getModuleLayout(sectionsPerCable, moduleFreq, Boolean(cfg?.ebFront));

  // A module sits at or before section 0 and a closing module sits at the last active section,
  // so a module always exists on both sides of a range within the active sections. With a front
  // eBird the module in front must lie strictly in front of the start (AS01 alone is "EB02 – EB01").
  const frontLimit = cfg?.ebFront ? startSection - 1 : startSection;
  const before = allModules
    .filter((m) => m.afterSection <= frontLimit)
    .sort((a, b) => b.afterSection - a.afterSection)[0];
  const after = allModules
    .filter((m) => m.afterSection >= endSection)
    .sort((a, b) => a.afterSection - b.afterSection)[0];

  if (before.num === after.num) return formatEB(before.num);
  return `${formatEB(Math.max(before.num, after.num))} – ${formatEB(Math.min(before.num, after.num))}`;
}

/**
 * EB range label for a logged event. Only the front-eBird flag is taken from the event's own
 * project (the layout is otherwise the active config's), so flag-off output is unchanged.
 * @param {Object} evt - event with sectionIndexStart, sectionIndexEnd and projectNumber
 * @param {Object} cfg - active config
 * @returns {string}
 */
export function getEBRangeForEvent(evt, cfg) {
  const ebFront = Boolean(getConfigForProject(evt.projectNumber)?.ebFront);
  return getEBRangeForSectionRange(evt.sectionIndexStart, evt.sectionIndexEnd, { ...cfg, ebFront });
}

/**
 * Calculate channel range label for a contiguous section range (active sections only).
 * Returns "—" for tail sections (startSection >= sectionsPerCable).
 * @param {number} startSection - 0-based start section index
 * @param {number} endSection - 0-based end section index
 * @param {Object} cfg - config with channelsPerSection and sectionsPerCable
 * @returns {string}
 */
export function getChannelRangeForSectionRange(startSection, endSection, cfg) {
  const channelsPerSection = cfg?.channelsPerSection || 8;
  const sectionsPerCable = cfg?.sectionsPerCable || 107;

  if (startSection >= sectionsPerCable || endSection >= sectionsPerCable) {
    return "—";
  }

  const startCh = startSection * channelsPerSection + 1;
  const endCh = (endSection + 1) * channelsPerSection;
  return `Ch ${startCh}–${endCh}`;
}

export function getConfigForProject(projectNumber) {
  const projectNumberTrimmed = (projectNumber || "").trim();
  if (projectNumberTrimmed && Array.isArray(projects)) {
    const project = projects.find((proj) => proj.projectNumber === projectNumberTrimmed);
    if (project) {
      // Include per-streamer overrides when this project is the active one (overrides come from GET /api/config).
      const isActiveProject = project.projectNumber === config?.activeProjectNumber;
      return {
        numCables: project.numCables || config.numCables,
        sectionsPerCable: project.sectionsPerCable || config.sectionsPerCable,
        sectionLength: project.sectionLength || config.sectionLength,
        moduleFrequency: project.moduleFrequency || config.moduleFrequency,
        channelsPerSection: project.channelsPerSection || config.channelsPerSection,
        useRopeForTail:
          project.useRopeForTail !== null && project.useRopeForTail !== undefined
            ? project.useRopeForTail === true || project.useRopeForTail === 1
            : config.useRopeForTail,
        ebFront: project.ebFront === true || project.ebFront === 1,
        suggestedCleaningThresholdDays: project.suggestedCleaningThresholdDays ?? 10,
        sectionsPerCableOverrides: isActiveProject ? (config?.sectionsPerCableOverrides || {}) : {},
      };
    }
  }
  return config;
}

/**
 * Returns the effective sections per cable for a specific streamer, checking
 * per-streamer overrides in config.sectionsPerCableOverrides before falling back to the default.
 * @param {number} streamerId - 1-based streamer number
 * @param {Object} [cfg] - config object (defaults to global config)
 * @returns {number}
 */
export function getEffectiveSectionsPerCable(streamerId, cfg = config) {
  const overrides = cfg?.sectionsPerCableOverrides || {};
  return overrides[streamerId] ?? cfg?.sectionsPerCable ?? 107;
}

export function getSectionsPerCableWithTail(cfg = config, streamerId = null) {
  const base = streamerId != null ? getEffectiveSectionsPerCable(streamerId, cfg) : (cfg?.sectionsPerCable || 0);
  const tail = cfg?.useRopeForTail ? 0 : 5;
  return base + tail;
}

export function getMaxSectionIndex(cfg = config, streamerId = null) {
  return getSectionsPerCableWithTail(cfg, streamerId);
}

export function validateStreamerAndSections(streamerNum, startSection, endSection, projectNumber = null) {
  const eventConfig = getConfigForProject(projectNumber);
  const maxStreamer = eventConfig?.numCables;
  const maxSection = getMaxSectionIndex(eventConfig, streamerNum);

  if (
    Number.isNaN(streamerNum) ||
    streamerNum < 1 ||
    streamerNum > maxStreamer ||
    Number.isNaN(startSection) ||
    startSection < 1 ||
    startSection > maxSection ||
    Number.isNaN(endSection) ||
    endSection < 1 ||
    endSection > maxSection
  ) {
    return {
      valid: false,
      maxStreamer,
      maxSection,
      message: `Streamer must be 1-${maxStreamer}, sections must be 1-${maxSection}.`,
    };
  }
  return { valid: true, maxStreamer, maxSection };
}

// ── Coverage counting helpers ─────────────────────────────────────────────────

/**
 * Convert an ISO timestamp string to a local YYYY-MM-DD string.
 * Avoids UTC day boundary shifts that occur with toISOString().split("T")[0].
 */
function isoToLocalDay(isoString) {
  const d = new Date(isoString);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Count unique section slots touched by at least one event in [startDate, endDate].
 * Mirrors the Set-dedup logic in /api/stats/filter for the "unique-in-period" mode,
 * enabling per-streamer gap analysis (untouched = totalPerCable − unique).
 * @param {Array} allEvents - events array (any streamer, any date)
 * @param {number} streamerId - which streamer to tally
 * @param {number} effectiveSections - active section count; tail base offset for key
 * @param {string|null} startDate - YYYY-MM-DD lower bound, or null
 * @param {string|null} endDate - YYYY-MM-DD upper bound, or null
 * @returns {{ total: number, active: number, tail: number }}
 */
export function countUniqueSectionsInPeriod(allEvents, streamerId, effectiveSections, startDate, endDate) {
  const uniqueActive = new Set();
  const uniqueTail = new Set();
  for (const evt of allEvents) {
    if (evt.streamerId !== streamerId) continue;
    if (startDate || endDate) {
      const evtDay = isoToLocalDay(evt.cleanedAt);
      if (startDate && evtDay < startDate) continue;
      if (endDate && evtDay > endDate) continue;
    }
    const isTail = evt.sectionType === "tail";
    for (let s = evt.sectionIndexStart; s <= evt.sectionIndexEnd; s++) {
      if (isTail) {
        uniqueTail.add(effectiveSections + s);
      } else {
        uniqueActive.add(s);
      }
    }
  }
  return {
    total: uniqueActive.size + uniqueTail.size,
    active: uniqueActive.size,
    tail: uniqueTail.size,
  };
}
