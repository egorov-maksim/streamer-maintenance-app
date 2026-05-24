/**
 * Renders a Chart.js bar chart of total cleaning distance per calendar day (/stats page only).
 * Fills every calendar day in the visible range (including 0 km days) with a trend line overlay.
 */

import { events, selectedProjectFilter } from "./state.js";
import { eventDistance } from "./streamer-utils.js";
import { safeGet } from "./ui.js";

let dailyChartInstance = null;

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

function formatXLabel(isoDate) {
  const d = new Date(`${isoDate}T12:00:00`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function tooltipLinesForDay(date, detailByDay) {
  const byStreamer = detailByDay.get(date);
  if (!byStreamer || byStreamer.size === 0) {
    return ["No scraping this day."];
  }
  const lines = [...byStreamer.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([streamerId, meters]) => `Streamer ${streamerId}: ${formatMetersDist(meters)}`);
  lines.unshift(`Total: ${formatMetersDist(dayTotalMeters(detailByDay, date))}`);
  return lines;
}

/**
 * Rebuilds the daily distance chart for the current filter range and project selection.
 * @param {string} [startDate] - optional YYYY-MM-DD from filter-start
 * @param {string} [endDate] - optional YYYY-MM-DD from filter-end
 */
export function renderDailyDistanceChart(startDate, endDate) {
  const container = safeGet("daily-distance-chart");
  if (!container) return;

  if (dailyChartInstance) {
    dailyChartInstance.destroy();
    dailyChartInstance = null;
  }

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

  container.replaceChildren();
  const canvas = document.createElement("canvas");
  canvas.className = "stats-daily-chart-canvas";
  container.appendChild(canvas);

  const barColors = series.map((row) =>
    row.km > 0 ? "rgba(37, 99, 235, 0.85)" : "rgba(148, 163, 184, 0.45)"
  );

  dailyChartInstance = new window.Chart(canvas, {
    type: "bar",
    data: {
      labels: series.map((row) => formatXLabel(row.date)),
      datasets: [
        {
          label: "Distance (km)",
          data: series.map((row) => row.km),
          backgroundColor: barColors,
          borderRadius: 2,
          order: 2,
        },
        {
          type: "line",
          label: "Trend",
          data: series.map((row) => row.km),
          borderColor: "rgba(15, 118, 110, 0.9)",
          backgroundColor: "transparent",
          borderWidth: 2,
          pointRadius: 2,
          tension: 0.15,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 2.8,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title(items) {
              const idx = items[0]?.dataIndex;
              if (idx == null) return "";
              return formatTooltipTitleDate(series[idx].date);
            },
            label(item) {
              const km = item.parsed.y ?? 0;
              return ` ${km.toFixed(2)} km`;
            },
            afterBody(items) {
              const idx = items[0]?.dataIndex;
              if (idx == null) return [];
              return tooltipLinesForDay(series[idx].date, detailByDay);
            },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            maxRotation: 45,
            minRotation: 0,
            autoSkip: true,
            maxTicksLimit: 14,
          },
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: "km" },
        },
      },
    },
  });

  const sumKm = series.reduce((s, r) => s + r.km, 0);
  const activeDays = series.filter((r) => r.km > 0).length;
  container.setAttribute(
    "aria-label",
    `Daily distance: ${series.length} calendar days, ${activeDays} with scraping, total ${sumKm.toFixed(1)} km`
  );
}
