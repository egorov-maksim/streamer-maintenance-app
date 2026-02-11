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

export function formatEB(num) {
  return `EB${String(num).padStart(2, "0")}`;
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
