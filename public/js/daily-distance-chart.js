/**
 * Renders an SVG bar chart of total cleaning distance per calendar day (standalone /stats page only; no #daily-distance-chart on index).
 * Fills every calendar day in the visible range (including 0 km / no-scraping days) and draws a trend polyline.
 */

import { events, selectedProjectFilter } from "./state.js";
import { eventDistance } from "./streamer-utils.js";
import { safeGet } from "./ui.js";

/** Local calendar YYYY-MM-DD (matches <input type="date"> semantics for range labels). */
function localTodayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

function addDaysISO(isoDate, deltaDays) {
  const [y, m, day] = isoDate.split("-").map(Number);
  const d = new Date(y, m - 1, day);
  d.setDate(d.getDate() + deltaDays);
  const y2 = d.getFullYear();
  const m2 = String(d.getMonth() + 1).padStart(2, "0");
  const d2 = String(d.getDate()).padStart(2, "0");
  return `${y2}-${m2}-${d2}`;
}

function enumerateDaysInclusive(fromISO, toISO) {
  const out = [];
  let cur = fromISO;
  while (cur <= toISO) {
    out.push(cur);
    cur = addDaysISO(cur, 1);
  }
  return out;
}

function filterEventsForStats(startDate, endDate) {
  let list = events;
  if (selectedProjectFilter) {
    list = list.filter((e) => String(e.projectNumber) === selectedProjectFilter);
  }
  if (startDate || endDate) {
    list = list.filter((evt) => {
      const evtDate = new Date(evt.cleanedAt).toISOString().split("T")[0];
      if (startDate && evtDate < startDate) return false;
      if (endDate && evtDate > endDate) return false;
      return true;
    });
  }
  return list;
}

function eventDayISO(evt) {
  return new Date(evt.cleanedAt).toISOString().split("T")[0];
}

/**
 * Decide the inclusive day range shown on the chart.
 * With both date filters set, always uses that window. Otherwise derives span from events or “start → today”.
 */
function resolveChartDayRange(startDate, endDate, filteredForProject) {
  const start = startDate || null;
  const end = endDate || null;

  if (start && end) {
    if (start > end) return null;
    return { from: start, to: end };
  }

  if (start && !end) {
    const today = localTodayISO();
    return start > today ? { from: start, to: start } : { from: start, to: today };
  }

  if (!start && end) {
    if (filteredForProject.length === 0) return null;
    const days = filteredForProject.map(eventDayISO);
    const earliest = days.reduce((a, b) => (a < b ? a : b));
    const from = earliest > end ? end : earliest;
    return { from, to: end };
  }

  if (filteredForProject.length === 0) return null;
  const days = filteredForProject.map(eventDayISO).sort();
  return { from: days[0], to: days[days.length - 1] };
}

/**
 * Per calendar day: total meters and meters by streamer id (for hover breakdown).
 * @returns {Map<string, Map<number, number>>}
 */
function aggregateDayDetailByStreamer(filtered) {
  const byDay = new Map();
  for (const evt of filtered) {
    const day = eventDayISO(evt);
    const m = eventDistance(evt);
    if (!byDay.has(day)) byDay.set(day, new Map());
    const byStreamer = byDay.get(day);
    const sid = evt.streamerId;
    byStreamer.set(sid, (byStreamer.get(sid) || 0) + m);
  }
  return byDay;
}

function dayTotalMeters(detailByDay, date) {
  const byStreamer = detailByDay.get(date);
  if (!byStreamer) return 0;
  let sum = 0;
  for (const v of byStreamer.values()) sum += v;
  return sum;
}

function seriesForRange(dayRange, detailByDay) {
  const days = enumerateDaysInclusive(dayRange.from, dayRange.to);
  return days.map((date) => {
    const meters = dayTotalMeters(detailByDay, date);
    return { date, meters, km: meters / 1000 };
  });
}

function formatMetersDist(meters) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

function formatTooltipTitleDate(isoDate) {
  const d = new Date(`${isoDate}T12:00:00`);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function buildDayTooltipMarkup(date, detailByDay) {
  const byStreamer = detailByDay.get(date);
  const title = escapeHtml(formatTooltipTitleDate(date));
  if (!byStreamer || byStreamer.size === 0) {
    return (
      `<div class="stats-daily-chart-hover-tooltip-title">${title}</div>` +
      `<p class="stats-daily-chart-hover-tooltip-empty">No scraping this day.</p>`
    );
  }
  const rows = [...byStreamer.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(
      ([streamerId, meters]) =>
        `<li><span class="stats-daily-chart-hover-streamer">Streamer ${streamerId}</span>` +
        `<span class="stats-daily-chart-hover-dist">${escapeHtml(formatMetersDist(meters))}</span></li>`
    )
    .join("");
  const total = dayTotalMeters(detailByDay, date);
  return (
    `<div class="stats-daily-chart-hover-tooltip-title">${title}</div>` +
    `<div class="stats-daily-chart-hover-tooltip-total">Total: ${escapeHtml(formatMetersDist(total))}</div>` +
    `<ul class="stats-daily-chart-hover-tooltip-list">${rows}</ul>`
  );
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bindDailyChartBarTooltips(container, detailByDay) {
  let tooltip = container.querySelector(".stats-daily-chart-hover-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.className = "stats-daily-chart-hover-tooltip";
    tooltip.setAttribute("role", "tooltip");
    container.appendChild(tooltip);
  }

  const pad = 14;

  function placeNearCursor(clientX, clientY) {
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    let left = clientX + pad;
    let top = clientY + pad;
    if (left + tw > window.innerWidth - 8) left = clientX - tw - pad;
    if (top + th > window.innerHeight - 8) top = clientY - th - pad;
    tooltip.style.left = `${Math.max(8, left)}px`;
    tooltip.style.top = `${Math.max(8, top)}px`;
  }

  function show(date, clientX, clientY) {
    tooltip.innerHTML = buildDayTooltipMarkup(date, detailByDay);
    tooltip.removeAttribute("hidden");
    tooltip.style.visibility = "hidden";
    tooltip.style.left = "0";
    tooltip.style.top = "0";
    void tooltip.offsetWidth;
    tooltip.style.visibility = "";
    placeNearCursor(clientX, clientY);
  }

  function hide() {
    tooltip.setAttribute("hidden", "");
  }

  container.querySelectorAll("[data-chart-day]").forEach((el) => {
    el.addEventListener("pointerenter", (e) => {
      if (e.pointerType === "touch") return;
      show(el.getAttribute("data-chart-day"), e.clientX, e.clientY);
    });
    el.addEventListener("pointermove", (e) => {
      if (tooltip.hasAttribute("hidden")) return;
      placeNearCursor(e.clientX, e.clientY);
    });
    el.addEventListener("pointerleave", hide);
  });
}

function yScaleMax(maxKm) {
  if (maxKm <= 0) return 1;
  const padded = maxKm * 1.12;
  if (padded >= 10) return Math.max(Math.ceil(padded / 5) * 5, 1);
  if (padded >= 1) return Math.max(Math.ceil(padded * 10) / 10, 0.001);
  return Math.max(Math.ceil(padded * 100) / 100, 0.0001);
}

function formatYTick(km) {
  if (km >= 10) return String(Math.round(km));
  if (km >= 1) return km.toFixed(1);
  return km.toFixed(2);
}

function formatXLabel(isoDate) {
  const d = new Date(`${isoDate}T12:00:00`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Rebuilds the daily distance chart for the current filter range and project selection.
 * @param {string} [startDate] - optional YYYY-MM-DD from filter-start
 * @param {string} [endDate] - optional YYYY-MM-DD from filter-end
 */
export function renderDailyDistanceChart(startDate, endDate) {
  const container = safeGet("daily-distance-chart");
  if (!container) return;

  const filteredForProject = filterEventsForStats(null, null);
  const filtered = filterEventsForStats(startDate || null, endDate || null);
  const dayRange = resolveChartDayRange(
    startDate || null,
    endDate || null,
    filteredForProject
  );

  if (!dayRange) {
    container.innerHTML =
      '<p class="stats-daily-chart-empty">Set a start and end date, or add cleaning events for this project, to show the daily trend (including days with no scraping).</p>';
    container.setAttribute("aria-label", "Daily distance chart: no date range");
    return;
  }

  const detailByDay = aggregateDayDetailByStreamer(filtered);
  const series = seriesForRange(dayRange, detailByDay);

  const maxKm = Math.max(...series.map((s) => s.km), 0);
  const yMax = yScaleMax(maxKm);
  const tickCount = 4;
  const yTicks = [];
  for (let i = 0; i <= tickCount; i++) {
    yTicks.push((yMax * i) / tickCount);
  }

  const W = 840;
  const H = 300;
  const ml = 52;
  const mr = 20;
  const mt = 12;
  const mb = 56;
  const plotW = W - ml - mr;
  const plotH = H - mt - mb;
  const n = series.length;
  const slotW = plotW / n;
  const barW = Math.max(2, slotW * 0.62);

  const parts = [];

  parts.push(
    `<svg class="stats-daily-chart-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`
  );

  parts.push(
    `<line class="stats-daily-chart-axis" x1="${ml}" y1="${mt + plotH}" x2="${ml + plotW}" y2="${mt + plotH}" />`
  );
  parts.push(
    `<line class="stats-daily-chart-axis" x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt + plotH}" />`
  );

  for (let i = 1; i < tickCount; i++) {
    const yVal = (yMax * i) / tickCount;
    const y = mt + plotH - (yVal / yMax) * plotH;
    parts.push(`<line class="stats-daily-chart-grid" x1="${ml}" y1="${y}" x2="${ml + plotW}" y2="${y}" />`);
  }

  for (const yVal of yTicks) {
    const y = mt + plotH - (yVal / yMax) * plotH;
    parts.push(
      `<text class="stats-daily-chart-tick-y" x="${ml - 8}" y="${y + 4}" text-anchor="end">${formatYTick(yVal)}</text>`
    );
  }

  parts.push(
    `<text class="stats-daily-chart-axis-label" x="14" y="${mt + plotH / 2}" transform="rotate(-90 14 ${mt + plotH / 2})">km</text>`
  );

  const trendPoints = [];

  series.forEach((row, i) => {
    const h = (row.km / yMax) * plotH;
    const x = ml + i * slotW + (slotW - barW) / 2;
    const y = mt + plotH - h;
    const cx = ml + i * slotW + slotW / 2;
    const cyTop = mt + plotH - h;
    trendPoints.push(`${cx},${cyTop}`);

    const isIdle = row.km <= 0;
    const barClass = isIdle ? "stats-daily-chart-bar-idle" : "stats-daily-chart-bar";
    const displayH = isIdle ? Math.min(3, Math.max(plotH * 0.02, 2)) : Math.max(h, 0);
    const barY = isIdle ? mt + plotH - displayH : y;

    parts.push(
      `<rect class="${barClass}" data-chart-day="${row.date}" x="${x}" y="${barY}" width="${barW}" height="${displayH}" rx="2" ry="2" />`
    );

    const labelEvery = n <= 12 ? 1 : n <= 24 ? 2 : Math.ceil(n / 12);
    if (i % labelEvery === 0 || i === n - 1) {
      const lx = ml + i * slotW + slotW / 2;
      parts.push(
        `<text class="stats-daily-chart-tick-x" x="${lx}" y="${H - 18}" text-anchor="middle">${escapeHtml(
          formatXLabel(row.date)
        )}</text>`
      );
    }
  });

  if (trendPoints.length > 1) {
    parts.push(
      `<polyline class="stats-daily-chart-trend" fill="none" points="${trendPoints.join(" ")}" />`
    );
  }

  parts.push("</svg>");

  container.replaceChildren();
  container.insertAdjacentHTML("beforeend", parts.join(""));
  bindDailyChartBarTooltips(container, detailByDay);

  const sumKm = series.reduce((s, r) => s + r.km, 0);
  const activeDays = series.filter((r) => r.km > 0).length;
  container.setAttribute(
    "aria-label",
    `Daily distance: ${series.length} calendar days, ${activeDays} with scraping, total ${sumKm.toFixed(1)} km`
  );
}
