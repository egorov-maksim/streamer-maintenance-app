/**
 * Domain helpers that depend on config/projects (streamer sections, validation, formatting).
 */

import { config, projects } from "./state.js";

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

export function formatEB(num) {
  return `EB${String(num).padStart(2, "0")}`;
}

/**
 * Calculate EB range label for a contiguous section range (active sections only).
 * Ports the logic from backend/utils/eb.js to run client-side without an API call.
 * Returns "—" for tail sections (startSection >= sectionsPerCable).
 * @param {number} startSection - 0-based start section index
 * @param {number} endSection - 0-based end section index
 * @param {Object} cfg - config with moduleFrequency and sectionsPerCable
 * @returns {string}
 */
export function getEBRangeForSectionRange(startSection, endSection, cfg) {
  const moduleFreq = cfg?.moduleFrequency || 4;
  const sectionsPerCable = cfg?.sectionsPerCable || 107;

  if (startSection >= sectionsPerCable || endSection >= sectionsPerCable) {
    return "—";
  }

  const allModules = [{ num: 1, section: 0 }];
  for (let si = moduleFreq; si < sectionsPerCable; si += moduleFreq) {
    allModules.push({ num: Math.floor(si / moduleFreq) + 1, section: si });
  }
  const lastBuilt = allModules[allModules.length - 1];
  if (lastBuilt.section !== sectionsPerCable - 1) {
    allModules.push({ num: lastBuilt.num + 1, section: sectionsPerCable - 1 });
  }

  const before = allModules
    .filter((m) => m.section <= startSection)
    .sort((a, b) => b.section - a.section)[0];
  const after = allModules
    .filter((m) => m.section >= endSection)
    .sort((a, b) => a.section - b.section)[0];
  const effectiveAfter = after || allModules[allModules.length - 1];

  if (before && effectiveAfter) {
    if (before.num === effectiveAfter.num) return formatEB(before.num);
    return `${formatEB(Math.max(before.num, effectiveAfter.num))} – ${formatEB(Math.min(before.num, effectiveAfter.num))}`;
  } else if (before) {
    return `Tail Adaptor – ${formatEB(before.num)}`;
  } else if (effectiveAfter) {
    return formatEB(effectiveAfter.num);
  }
  return "—";
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
      };
    }
  }
  return config;
}

export function getSectionsPerCableWithTail(cfg = config) {
  const base = cfg?.sectionsPerCable || 0;
  const tail = cfg?.useRopeForTail ? 0 : 5;
  return base + tail;
}

export function getMaxSectionIndex(cfg = config) {
  return getSectionsPerCableWithTail(cfg);
}

export function validateStreamerAndSections(streamerNum, startSection, endSection, projectNumber = null) {
  const eventConfig = getConfigForProject(projectNumber);
  const maxStreamer = eventConfig?.numCables;
  const maxSection = getMaxSectionIndex(eventConfig);

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
