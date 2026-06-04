/**
 * Shared statistics logic used by both the main page (app.js) and the
 * standalone stats page (stats-page.js).
 *
 * All DOM element IDs referenced here must exist on any page that uses this module:
 * filter-start, filter-end, kpi-coverage, kpi-coverage-sub, kpi-breakdown,
 * kpi-distance, kpi-distance-sub, kpi-events, kpi-events-sub, kpi-last,
 * kpi-last-sub, deploy-days-breakdown, method-breakdown, streamer-cards-container
 * (daily-distance-chart exists only on /stats stats.html, not index.html)
 *
 * Recent-events modal IDs (both pages):
 * kpi-events-card, recent-cleaning-events-modal, recent-cleaning-events-body,
 * recent-cleaning-events-empty, recent-cleaning-events-subtitle
 */

import { config, events, projects, selectedProjectFilter, getFilteredEvents } from "./state.js";
import * as API from "./api.js";
import { safeGet, showErrorToast, formatDateTime } from "./ui.js";
import { fmtKm, formatSectionLabel, eventDistance, getEBRangeForSectionRange, getEffectiveSectionsPerCable } from "./streamer-utils.js";
import { openModal, closeModal } from "./modals.js";
import { renderDailyDistanceChart } from "./daily-distance-chart.js";

export async function renderStreamerCards(startDate = null, endDate = null, preloadedLastCleaned = null) {
  const container = safeGet("streamer-cards-container");
  if (!container) return;

  container.innerHTML = "";

  try {
    let data;
    if (preloadedLastCleaned) {
      data = preloadedLastCleaned;
    } else {
      let url = "api/last-cleaned";
      if (selectedProjectFilter) url += `?project=${encodeURIComponent(selectedProjectFilter)}`;
      data = await API.apiCall(url);
    }
    const lastCleaned = data.lastCleaned;

    const cableCount = config.numCables;
    const tailSections = config.useRopeForTail ? 0 : 5;

    for (let streamerId = 1; streamerId <= cableCount; streamerId++) {
      const sections = lastCleaned[streamerId] || [];
      const effectiveSections = getEffectiveSectionsPerCable(streamerId);
      const totalPerCable = effectiveSections + tailSections;

      let filteredEvents = events.filter((evt) => evt.streamerId === streamerId);

      if (startDate || endDate) {
        filteredEvents = filteredEvents.filter((evt) => {
          const evtDate = new Date(evt.cleanedAt).toISOString().split("T")[0];
          if (startDate && evtDate < startDate) return false;
          if (endDate && evtDate > endDate) return false;
          return true;
        });
      }

      let cleanedCount = 0;
      const totalCleanings = filteredEvents.length;

      sections.forEach((date) => {
        if (!date) return;
        if (startDate || endDate) {
          const sectionDate = new Date(date).toISOString().split("T")[0];
          if (startDate && sectionDate < startDate) return;
          if (endDate && sectionDate > endDate) return;
        }
        cleanedCount++;
      });

      const coverage =
        totalPerCable > 0 ? Math.round((cleanedCount / totalPerCable) * 100) : 0;

      let totalSectionCleanings = 0;
      filteredEvents.forEach((evt) => {
        totalSectionCleanings += evt.sectionIndexEnd - evt.sectionIndexStart + 1;
      });

      const avgCleanings =
        totalPerCable > 0 ? (totalSectionCleanings / totalPerCable).toFixed(1) : 0;

      const card = document.createElement("div");
      card.className = "streamer-card";
      card.innerHTML = `
        <div class="streamer-card-header">
          <div class="streamer-card-title">Streamer ${streamerId}</div>
          <div class="streamer-card-percent">${coverage}%</div>
        </div>
        <div class="streamer-card-detail">
          ${cleanedCount}/${totalPerCable} sections · ${avgCleanings} avg cleanings
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${coverage}%"></div>
        </div>
      `;
      container.appendChild(card);
    }
  } catch (err) {
    console.error("renderStreamerCards failed", err);
    showErrorToast("Stats Error", "Failed to render streamer overview cards.");
  }
}

export async function refreshStatsFiltered(
  preloadedLastCleaned = null,
  preloadedDeployments = null,
  preloadedStats = null,
  preloadedFilterStats = null
) {
  const startDate = safeGet("filter-start")?.value;
  const endDate = safeGet("filter-end")?.value;

  try {
    let overallStats;
    if (preloadedStats) {
      overallStats = preloadedStats;
    } else {
      const statsParams = new URLSearchParams();
      if (selectedProjectFilter) statsParams.append("project", selectedProjectFilter);
      overallStats = await API.apiCall(`/api/stats?${statsParams}`);
    }

    let data;
    if (preloadedFilterStats) {
      data = preloadedFilterStats;
    } else {
      const params = new URLSearchParams();
      if (startDate) params.append("start", startDate);
      if (endDate) params.append("end", endDate);
      if (selectedProjectFilter) params.append("project", selectedProjectFilter);
      data = await API.apiCall(`/api/stats/filter?${params}`);
    }

    const totalActiveSections = overallStats.totalAvailableSections;
    const totalTailSections = overallStats.totalAvailableTail;
    const totalSections = totalActiveSections + totalTailSections;

    const displayStats = startDate || endDate ? data : overallStats;

    const totalCleanedSections = displayStats.uniqueCleanedSections || 0;
    const overallCoverage =
      totalSections > 0
        ? ((totalCleanedSections / totalSections) * 100).toFixed(1)
        : 0;

    const cleanedActiveCount = displayStats.activeCleanedSections || 0;
    const activeCoverage =
      totalActiveSections > 0
        ? ((cleanedActiveCount / totalActiveSections) * 100).toFixed(1)
        : 0;

    const cleanedTailCount = displayStats.tailCleanedSections || 0;
    const tailCoverage =
      totalTailSections > 0
        ? ((cleanedTailCount / totalTailSections) * 100).toFixed(1)
        : 0;

    safeGet("kpi-coverage").textContent = `${overallCoverage}%`;
    safeGet("kpi-coverage-sub").textContent = `${totalCleanedSections} / ${totalSections} sections`;

    if (totalTailSections > 0) {
      safeGet("kpi-breakdown").textContent =
        `Active: ${activeCoverage}% (${cleanedActiveCount}/${totalActiveSections}) · Tail: ${tailCoverage}% (${cleanedTailCount}/${totalTailSections})`;
    } else {
      safeGet("kpi-breakdown").textContent =
        `Active: ${activeCoverage}% (${cleanedActiveCount}/${totalActiveSections})`;
    }

    safeGet("kpi-distance").textContent = fmtKm(data.totalDistance);
    safeGet("kpi-distance-sub").textContent = `${data.totalDistance} meters cleaned`;

    safeGet("kpi-events").textContent = data.events;
    safeGet("kpi-events-sub").textContent = `${data.events} log entries`;

    if (data.lastCleaning) {
      const lastDate = new Date(data.lastCleaning);
      safeGet("kpi-last").textContent = lastDate.toLocaleDateString();
      safeGet("kpi-last-sub").textContent = lastDate.toLocaleTimeString();
    } else {
      safeGet("kpi-last").textContent = "—";
      safeGet("kpi-last-sub").textContent = "No events";
    }

    // Days to First Scraping per-streamer breakdown
    const deployDaysBreakdownDiv = safeGet("deploy-days-breakdown");
    if (deployDaysBreakdownDiv) {
      const activeProject = projects.find((p) => p.isActive === true);

      if (!activeProject) {
        deployDaysBreakdownDiv.innerHTML =
          '<h3 class="section-title">Days to First Scraping per Streamer</h3><p class="info-text-md">Requires active project with deployment dates</p>';
      } else if (data.events === 0) {
        deployDaysBreakdownDiv.innerHTML =
          '<h3 class="section-title">Days to First Scraping per Streamer</h3><p class="info-text-md">No cleaning events yet</p>';
      } else {
        try {
          // Always use full project history so "days to first scraping" is a fixed metric.
          let eventsForFirstScraping = events;
          if (selectedProjectFilter) {
            eventsForFirstScraping = eventsForFirstScraping.filter(
              (e) => String(e.projectNumber) === selectedProjectFilter
            );
          }

          const streamerDeployments = preloadedDeployments
            ? preloadedDeployments
            : await API.apiCall(`/api/projects/${activeProject.id}/streamer-deployments`);

          const streamerDays = [];
          let maxDays = 0;

          for (let streamerNum = 1; streamerNum <= config.numCables; streamerNum++) {
            const streamerEvents = eventsForFirstScraping.filter(
              (e) => e.streamerId === streamerNum
            );

            const deployment = streamerDeployments[streamerNum];
            const deployDate = deployment?.deploymentDate;

            if (deployDate && streamerEvents.length > 0) {
              const firstCleaning = streamerEvents.sort(
                (a, b) => new Date(a.cleanedAt) - new Date(b.cleanedAt)
              )[0];

              const days = Math.floor(
                (new Date(firstCleaning.cleanedAt) - new Date(deployDate)) /
                  (1000 * 60 * 60 * 24)
              );

              if (days >= 0) {
                streamerDays.push({ streamerNum, days });
                if (days > maxDays) maxDays = days;
              }
            }
          }

          if (streamerDays.length === 0) {
            deployDaysBreakdownDiv.innerHTML =
              '<h3 class="section-title">Days to First Scraping per Streamer</h3><p class="info-text-md">No deployment dates configured</p>';
          } else {
            deployDaysBreakdownDiv.innerHTML =
              '<h3 class="section-title">Days to First Scraping per Streamer</h3>';

            streamerDays.sort((a, b) => a.streamerNum - b.streamerNum);

            streamerDays.forEach(({ streamerNum, days }) => {
              const percentage = maxDays > 0 ? (days / maxDays) * 100 : 0;
              const bar = document.createElement("div");
              bar.innerHTML = `
                <div class="bar-label">
                  <span>Streamer ${streamerNum}</span>
                  <span>${days} days</span>
                </div>
                <div class="bar">
                  <div class="bar-fill" style="width: ${percentage}%"></div>
                </div>
              `;
              deployDaysBreakdownDiv.appendChild(bar);
            });
          }
        } catch (err) {
          console.error("Failed to calculate days to first scraping", err);
          deployDaysBreakdownDiv.innerHTML =
            '<h3 class="section-title">Days to First Scraping per Streamer</h3><p class="error-text-md">Calculation error</p>';
        }
      }
    }

    // Distance by Method breakdown
    const methodBreakdownDiv = safeGet("method-breakdown");
    if (
      methodBreakdownDiv &&
      data.byMethod &&
      Object.keys(data.byMethod).length > 0
    ) {
      methodBreakdownDiv.innerHTML = '<h3 style="margin-top: 0">Distance by Method</h3>';
      Object.keys(data.byMethod).forEach((method) => {
        const distance = data.byMethod[method];
        const bar = document.createElement("div");
        bar.innerHTML = `
          <div class="bar-label">
            <span>${method}</span>
            <span>${distance} m</span>
          </div>
          <div class="bar">
            <div class="bar-fill" style="width: ${(distance / data.totalDistance) * 100}%"></div>
          </div>
        `;
        methodBreakdownDiv.appendChild(bar);
      });
    }

    await renderStreamerCards(startDate, endDate, preloadedLastCleaned);
    renderDailyDistanceChart(startDate, endDate);
  } catch (err) {
    console.error("refreshStatsFiltered failed", err);
    showErrorToast("Stats Error", "Failed to load statistics. Please try again.");
  }
}

export async function resetFilter() {
  const startInput = safeGet("filter-start");
  const endInput = safeGet("filter-end");
  if (startInput) startInput.value = "";
  if (endInput) endInput.value = "";
  await refreshStatsFiltered();
}

// ── Recent Cleaning Events Modal ───────────────────────────────────────────────

/**
 * Returns the local calendar date as YYYY-MM-DD for any Date (or now).
 * Uses local year/month/day so the result matches <input type="date"> semantics
 * and the times shown by formatDateTime(), not UTC day boundaries.
 */
function localCalendarDayISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Returns events from the active project filter whose local calendar date is
 * today or yesterday, sorted newest-first.
 */
function getRecentCleaningEvents() {
  const today = localCalendarDayISO();
  const yesterday = localCalendarDayISO(new Date(Date.now() - 86400000));
  return getFilteredEvents()
    .filter((evt) => {
      const day = localCalendarDayISO(new Date(evt.cleanedAt));
      return day === today || day === yesterday;
    })
    .sort((a, b) => new Date(b.cleanedAt) - new Date(a.cleanedAt));
}

/**
 * Populates the modal table with today's and yesterday's events, grouped by day.
 */
function renderRecentCleaningEventsModal() {
  const tbody = safeGet("recent-cleaning-events-body");
  const emptyEl = safeGet("recent-cleaning-events-empty");
  const tableEl = safeGet("recent-cleaning-events-table");
  const subtitleEl = safeGet("recent-cleaning-events-subtitle");

  if (!tbody) return;

  const today = localCalendarDayISO();
  const yesterday = localCalendarDayISO(new Date(Date.now() - 86400000));

  if (subtitleEl) {
    const todayLabel = new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    const yDate = new Date(Date.now() - 86400000);
    const yesterdayLabel = yDate.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    subtitleEl.textContent = `${todayLabel} · ${yesterdayLabel}`;
  }

  const recentEvents = getRecentCleaningEvents();

  if (recentEvents.length === 0) {
    if (emptyEl) emptyEl.classList.remove("hidden");
    if (tableEl) tableEl.classList.add("hidden");
    tbody.innerHTML = "";
    return;
  }

  if (emptyEl) emptyEl.classList.add("hidden");
  if (tableEl) tableEl.classList.remove("hidden");

  const todayEvents = recentEvents.filter((e) => localCalendarDayISO(new Date(e.cleanedAt)) === today);
  const yesterdayEvents = recentEvents.filter((e) => localCalendarDayISO(new Date(e.cleanedAt)) === yesterday);

  tbody.innerHTML = "";

  function appendGroupHeading(label, count) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6" class="recent-events-day-heading">${label} <span class="recent-events-day-count">(${count})</span></td>`;
    tbody.appendChild(tr);
  }

  function appendEventRow(evt) {
    const sectionType = evt.sectionType || "active";
    const rangeLabel = `${formatSectionLabel(evt.sectionIndexStart, sectionType)}–${formatSectionLabel(evt.sectionIndexEnd, sectionType)}`;
    const ebRange = sectionType === "tail" ? "—" : getEBRangeForSectionRange(evt.sectionIndexStart, evt.sectionIndexEnd, config);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatDateTime(evt.cleanedAt)}</td>
      <td>Streamer ${evt.streamerId}</td>
      <td>${rangeLabel}</td>
      <td>${ebRange}</td>
      <td>${eventDistance(evt)}</td>
      <td>${evt.cleaningMethod}</td>
    `;
    tbody.appendChild(tr);
  }

  if (todayEvents.length > 0) {
    appendGroupHeading("Today", todayEvents.length);
    todayEvents.forEach(appendEventRow);
  }

  if (yesterdayEvents.length > 0) {
    appendGroupHeading("Yesterday", yesterdayEvents.length);
    yesterdayEvents.forEach(appendEventRow);
  }
}

export function openRecentCleaningEventsModal() {
  renderRecentCleaningEventsModal();
  openModal("recent-cleaning-events-modal");
}

export function closeRecentCleaningEventsModal() {
  closeModal("recent-cleaning-events-modal");
}

/**
 * Wires the Cleaning Events KPI tile and modal close controls.
 * Safe to call multiple times — guard prevents double-binding.
 */
export function initCleaningEventsKpiModal() {
  const card = safeGet("kpi-events-card");
  if (!card || card.dataset.cleaningEventsWired) return;
  card.dataset.cleaningEventsWired = "1";

  card.addEventListener("click", openRecentCleaningEventsModal);
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openRecentCleaningEventsModal();
    }
  });

  safeGet("btn-recent-cleaning-events-close")?.addEventListener("click", closeRecentCleaningEventsModal);
  safeGet("btn-recent-cleaning-events-close-footer")?.addEventListener("click", closeRecentCleaningEventsModal);
  document.querySelector("#recent-cleaning-events-modal .modal-overlay")
    ?.addEventListener("click", closeRecentCleaningEventsModal);
}
