/**
 * Renders a Chart.js line chart of average RMS noise per streamer across noise uploads (/stats).
 */

import * as API from "./api.js";
import { safeGet, showErrorToast } from "./ui.js";

let noiseRmsChartInstance = null;

const STREAMER_COLORS = [
  "rgba(37, 99, 235, 0.9)",
  "rgba(220, 38, 38, 0.9)",
  "rgba(15, 118, 110, 0.9)",
  "rgba(202, 138, 4, 0.9)",
  "rgba(124, 58, 237, 0.9)",
  "rgba(219, 39, 119, 0.9)",
  "rgba(234, 88, 12, 0.9)",
  "rgba(8, 145, 178, 0.9)",
  "rgba(101, 163, 13, 0.9)",
  "rgba(79, 70, 229, 0.9)",
  "rgba(190, 24, 93, 0.9)",
  "rgba(13, 148, 136, 0.9)",
];

function formatUploadLabel(upload) {
  const date = upload.uploadedAt ? upload.uploadedAt.slice(0, 10) : "?";
  if (upload.label) return `${date} (${upload.label})`;
  return date;
}

function shortUploadLabel(upload, index) {
  const date = upload.uploadedAt ? upload.uploadedAt.slice(0, 10) : `Upload ${index + 1}`;
  if (upload.label) {
    const short = upload.label.length > 12 ? `${upload.label.slice(0, 10)}…` : upload.label;
    return `${date}\n${short}`;
  }
  return date;
}

/**
 * Loads noise RMS history for a project and renders the multi-streamer line chart.
 * @param {string|null} projectNumber
 */
export async function renderNoiseRmsHistoryChart(projectNumber) {
  const container = safeGet("noise-rms-history-chart");
  if (!container) return;

  if (noiseRmsChartInstance) {
    noiseRmsChartInstance.destroy();
    noiseRmsChartInstance = null;
  }

  if (!projectNumber) {
    container.innerHTML =
      '<p class="stats-daily-chart-empty">Select a single project above to view RMS noise trends per streamer.</p>';
    container.setAttribute("aria-label", "Noise RMS history: no project selected");
    return;
  }

  try {
    const data = await API.getNoiseRmsHistory(projectNumber);

    if (!data.uploads || data.uploads.length === 0) {
      container.innerHTML =
        '<p class="stats-daily-chart-empty">No noise uploads for this project yet. Upload RMS noise CSV files on the main page to build a history.</p>';
      container.setAttribute("aria-label", "Noise RMS history: no uploads");
      return;
    }

    const labels = data.uploads.map((u, i) => shortUploadLabel(u, i));
    const datasets = (data.streamers || []).map((s, idx) => ({
      label: `Streamer ${s.streamerId}`,
      data: s.avgRms,
      borderColor: STREAMER_COLORS[(s.streamerId - 1) % STREAMER_COLORS.length],
      backgroundColor: "transparent",
      borderWidth: 2,
      pointRadius: 3,
      spanGaps: false,
      tension: 0.1,
    }));

    container.replaceChildren();
    const canvas = document.createElement("canvas");
    canvas.className = "stats-daily-chart-canvas";
    container.appendChild(canvas);

    noiseRmsChartInstance = new window.Chart(canvas, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: 2.4,
        interaction: { mode: "nearest", intersect: false },
        plugins: {
          legend: {
            display: true,
            position: "bottom",
            labels: { boxWidth: 12, padding: 8, font: { size: 11 } },
          },
          tooltip: {
            callbacks: {
              title(items) {
                const idx = items[0]?.dataIndex;
                if (idx == null) return "";
                return formatUploadLabel(data.uploads[idx]);
              },
              label(item) {
                const v = item.parsed.y;
                if (v == null) return ` ${item.dataset.label}: —`;
                return ` ${item.dataset.label}: ${v.toFixed(2)} RMS`;
              },
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: "Noise upload" },
            ticks: {
              maxRotation: 45,
              minRotation: 0,
              autoSkip: true,
              maxTicksLimit: 16,
            },
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: "Avg RMS (active sections)" },
          },
        },
      },
    });

    container.setAttribute(
      "aria-label",
      `Noise RMS history: ${data.uploads.length} uploads, ${datasets.length} streamers`
    );
  } catch (err) {
    container.innerHTML =
      '<p class="stats-daily-chart-empty">Could not load noise RMS history. Try again or check your connection.</p>';
    showErrorToast("Chart Error", err.message || "Failed to load noise RMS history");
  }
}
