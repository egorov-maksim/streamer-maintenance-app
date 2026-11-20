import { safeGet } from "./js/ui.js";
import { apiCall, setUnauthorizedHandler } from "./js/api.js";
import { formatDelta, deltaTone, formatKm, formatDays } from "./js/overview-format.js";
import {
  loadSession,
  validateSession,
  showLogin,
  showApp,
  clearSession,
  handleLogin,
  handleLogout,
  setupPasswordToggle,
  setOnShowAppCallback,
} from "./js/auth.js";

const STORAGE_KEY = "overview.selection";
const ALLOWED_DAYS = [7, 30, 90];
const DASH = "—";

const NO_PROJECT_MSG = "No active project — coverage, noise and efficiency need one";
const NO_CLEANING_MSG = "No cleaning in this period";
const NO_NOISE_MSG = "No noise uploads yet";
const NO_PAIRED_MSG = "No paired noise readings for the cleaned sections";
const NO_CHART_LIB_MSG = "Charts are unavailable (chart library not loaded).";

let vessels = [];
let selection = { vessel: null, days: 30 };
let requestSeq = 0;
let listenersBound = false;
const charts = { daily: null, rms: null, efficiency: null };

const isNum = (n) => typeof n === "number" && Number.isFinite(n);

/* ---------- selection persistence ---------- */

function readStoredSelection() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function storeSelection() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    /* storage unavailable: the page works without it */
  }
}

function resolveSelection(stored) {
  const vessel = stored && vessels.includes(stored.vessel) ? stored.vessel : vessels[0] || null;
  const days = stored && ALLOWED_DAYS.includes(Number(stored.days)) ? Number(stored.days) : 30;
  return { vessel, days };
}

/* ---------- small DOM helpers ---------- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function clear(node) {
  if (node) node.replaceChildren();
}

function setMsg(id, text) {
  const node = safeGet(id);
  if (!node) return;
  node.textContent = text || "";
  node.classList.toggle("hidden", !text);
}

function showChart(canvasId, visible) {
  const canvas = safeGet(canvasId);
  if (canvas && canvas.parentElement) canvas.parentElement.classList.toggle("hidden", !visible);
}

function destroyCharts() {
  for (const key of Object.keys(charts)) {
    if (charts[key]) {
      charts[key].destroy();
      charts[key] = null;
    }
  }
}

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function dateLabel(iso) {
  return typeof iso === "string" && iso.length >= 10 ? iso.slice(0, 10) : DASH;
}

function ago(n) {
  if (!isNum(n)) return "no data";
  return n === 0 ? "today" : `${formatDays(n)} ago`;
}

/* ---------- inline error with retry ---------- */

function showError(message, onRetry) {
  const box = safeGet("overview-error");
  if (!box) return;
  clear(box);
  box.append(el("span", "overview-error-text", message));
  const btn = el("button", "overview-retry-btn", "Retry");
  btn.type = "button";
  btn.addEventListener("click", onRetry);
  box.append(btn);
  box.classList.remove("hidden");
}

function hideError() {
  const box = safeGet("overview-error");
  if (!box) return;
  clear(box);
  box.classList.add("hidden");
}

/* ---------- states ---------- */

function renderLoading() {
  destroyCharts();
  clear(safeGet("overview-kpis"));
  clear(safeGet("overview-overdue"));
  clear(safeGet("overview-worst-streamers"));
  clear(safeGet("overview-efficiency-stats"));
  for (const id of ["overview-daily-distance-chart", "overview-rms-chart", "overview-efficiency-chart"]) {
    showChart(id, false);
  }
  for (const id of ["overview-cleaning-msg", "overview-noise-msg", "overview-efficiency-msg"]) {
    setMsg(id, "Loading…");
  }
  const ctx = safeGet("overview-context");
  if (ctx) ctx.textContent = "Loading…";
}

/* ---------- context + KPIs ---------- */

function renderContext(data) {
  const ctx = safeGet("overview-context");
  if (!ctx) return;
  const p = data.project;
  const project = p
    ? `Project ${p.projectNumber}${p.projectName ? ` – ${p.projectName}` : ""}`
    : "No active project";
  const f = data.freshness || {};
  ctx.textContent = `${project} · Last cleaning: ${ago(f.daysSinceLastCleaning)} · Last noise upload: ${ago(f.daysSinceLastNoiseUpload)}`;
}

function kpiTile({ title, value, deltaText, tone, sub }) {
  const tile = el("div", "kpi");
  tile.append(el("div", "kpi-title", title));
  tile.append(el("div", "kpi-value", value));
  if (deltaText) tile.append(el("div", `overview-delta overview-delta-${tone || "neutral"}`, deltaText));
  tile.append(el("div", "kpi-sub", sub || ""));
  return tile;
}

function renderKpis(data) {
  const box = safeGet("overview-kpis");
  if (!box) return;
  clear(box);
  const c = data.cleaning || {};
  const eff = data.efficiency || {};
  const noise = data.noise;
  const cov = c.coverage;
  const tiles = [];

  tiles.push(
    cov
      ? kpiTile({
          title: "Coverage",
          value: isNum(cov.pct) ? `${cov.pct}%` : DASH,
          deltaText: formatDelta(cov.deltaPoints, "pts"),
          tone: deltaTone("coverage", cov.deltaPoints),
          sub: `${cov.cleanedSections ?? DASH} / ${cov.totalSections ?? DASH} sections`,
        })
      : kpiTile({ title: "Coverage", value: DASH, sub: "No active project" })
  );

  const dist = c.distanceKm || {};
  tiles.push(
    kpiTile({
      title: "Distance",
      value: isNum(dist.value) ? `${formatKm(dist.value)} km` : DASH,
      deltaText: formatDelta(dist.deltaPct, "pct"),
      tone: deltaTone("distance", dist.deltaPct),
      sub: isNum(dist.previous) ? `previous: ${formatKm(dist.previous)} km` : "",
    })
  );

  const ev = c.events || {};
  tiles.push(
    kpiTile({
      title: "Cleanings",
      value: isNum(ev.value) ? String(ev.value) : DASH,
      deltaText: formatDelta(ev.deltaPct, "pct"),
      tone: deltaTone("events", ev.deltaPct),
      sub: "events",
    })
  );

  tiles.push(
    noise && isNum(noise.latestAvgRms)
      ? kpiTile({
          title: "Avg noise",
          value: String(noise.latestAvgRms),
          deltaText: formatDelta(noise.deltaPct, "pct"),
          tone: deltaTone("noise", noise.deltaPct),
          sub: "latest mean RMS",
        })
      : kpiTile({
          title: "Avg noise",
          value: DASH,
          sub: data.project ? NO_NOISE_MSG : "No active project",
        })
  );

  if (eff.status === "ok" && isNum(eff.meanImprovementPct)) {
    tiles.push(
      kpiTile({
        title: "Noise improvement",
        value: `${eff.meanImprovementPct}%`,
        sub: isNum(eff.improvedSharePct) ? `${eff.improvedSharePct}% of sections improved` : "",
      })
    );
  } else {
    let sub = "Not available";
    if (eff.status === "ok") sub = "No paired readings";
    else if (eff.status === "no_active_project") sub = "No active project";
    tiles.push(kpiTile({ title: "Noise improvement", value: DASH, sub }));
  }

  box.append(...tiles);
}

/* ---------- charts ---------- */

function baseOptions(yTitle) {
  const text = cssVar("--muted", "#6b7280");
  const grid = cssVar("--border", "#e5e7eb");
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: text, maxRotation: 60, autoSkip: true }, grid: { color: grid } },
      y: {
        beginAtZero: true,
        title: { display: true, text: yTitle, color: text },
        ticks: { color: text },
        grid: { color: grid },
      },
    },
  };
}

function drawChart(key, canvasId, config) {
  const canvas = safeGet(canvasId);
  if (!canvas || !window.Chart) return false;
  if (charts[key]) charts[key].destroy();
  charts[key] = new window.Chart(canvas, config);
  return true;
}

/** Draws a chart if the library exists; returns true when drawn. */
function tryChart(key, canvasId, config) {
  showChart(canvasId, true);
  if (drawChart(key, canvasId, config)) return true;
  showChart(canvasId, false);
  return false;
}

/* ---------- sections ---------- */

function renderCleaning(data) {
  const c = data.cleaning || {};
  const daily = Array.isArray(c.dailyDistanceKm) ? c.dailyDistanceKm : [];
  setMsg("overview-cleaning-msg", null);
  showChart("overview-daily-distance-chart", false);
  if (daily.length === 0) {
    setMsg("overview-cleaning-msg", NO_CLEANING_MSG);
  } else {
    const ok = tryChart("daily", "overview-daily-distance-chart", {
      type: "bar",
      data: {
        labels: daily.map((d) => dateLabel(d.date)),
        datasets: [
          {
            label: "Distance (km)",
            data: daily.map((d) => (isNum(d.km) ? Math.round(d.km * 100) / 100 : null)),
            backgroundColor: cssVar("--primary", "#2563eb"),
          },
        ],
      },
      options: baseOptions("km"),
    });
    if (!ok) setMsg("overview-cleaning-msg", NO_CHART_LIB_MSG);
  }

  const box = safeGet("overview-overdue");
  clear(box);
  if (!box) return;
  const od = c.overdueSections;
  if (od) {
    const line = el(
      "p",
      "overview-fact" + (od.count > 0 ? " overview-fact-bad" : ""),
      `${od.count} sections not cleaned in the last ${od.thresholdDays} days, of ${od.totalActiveSections}`
    );
    box.append(line);
  } else {
    box.append(el("p", "overview-fact overview-muted", `Overdue sections: ${NO_PROJECT_MSG}`));
  }
  const days = data.freshness ? data.freshness.daysSinceLastCleaning : null;
  box.append(el("p", "overview-fact", `Days since last cleaning: ${isNum(days) ? days : DASH}`));
}

function renderNoise(data) {
  const noise = data.noise;
  const list = safeGet("overview-worst-streamers");
  clear(list);
  setMsg("overview-noise-msg", null);
  showChart("overview-rms-chart", false);

  if (!data.project) {
    setMsg("overview-noise-msg", NO_PROJECT_MSG);
    return;
  }
  const history = noise && Array.isArray(noise.rmsHistory) ? noise.rmsHistory : [];
  if (history.length === 0) {
    setMsg("overview-noise-msg", NO_NOISE_MSG);
    return;
  }
  const ok = tryChart("rms", "overview-rms-chart", {
    type: "line",
    data: {
      labels: history.map((h) => dateLabel(h.measuredAt)),
      datasets: [
        {
          label: "Mean RMS",
          data: history.map((h) => (isNum(h.avgRms) ? h.avgRms : null)),
          borderColor: cssVar("--primary", "#2563eb"),
          backgroundColor: cssVar("--primary", "#2563eb"),
          tension: 0.2,
          spanGaps: true,
        },
      ],
    },
    options: baseOptions("RMS"),
  });
  if (!ok) setMsg("overview-noise-msg", NO_CHART_LIB_MSG);

  const worst = (noise.worstStreamers || []).slice(0, 5);
  if (list && worst.length > 0) {
    list.append(el("h3", "overview-subtitle", "Noisiest streamers"));
    const ol = el("ol", "overview-list");
    for (const s of worst) {
      ol.append(el("li", "", `Streamer ${s.streamerId} — avg RMS ${isNum(s.avgRms) ? s.avgRms : DASH}`));
    }
    list.append(ol);
  }
}

function renderEfficiency(data) {
  const eff = data.efficiency || {};
  const stats = safeGet("overview-efficiency-stats");
  clear(stats);
  setMsg("overview-efficiency-msg", null);
  showChart("overview-efficiency-chart", false);

  if (stats) {
    const per = isNum(eff.distancePerCleaningDayKm) ? `${(Math.round(eff.distancePerCleaningDayKm * 10) / 10).toFixed(1)} km` : DASH;
    stats.append(el("p", "overview-fact", `Distance per cleaning day: ${per}`));
  }

  if (eff.status === "no_active_project") {
    setMsg("overview-efficiency-msg", NO_PROJECT_MSG);
    return;
  }

  const pairs = Array.isArray(eff.pairs) ? eff.pairs : [];
  const withData = pairs.filter((p) => isNum(p.meanImprovementPct));

  let message = null;
  if (eff.status === "insufficient_uploads" || eff.status === "no_events") {
    message = eff.reason || "Efficiency is not available yet";
  } else if (eff.status === "ok" && !isNum(eff.meanImprovementPct)) {
    message = NO_PAIRED_MSG;
  } else if (withData.length === 0) {
    message = NO_PAIRED_MSG;
  }

  if (withData.length > 0) {
    const ok = tryChart("efficiency", "overview-efficiency-chart", {
      type: "bar",
      data: {
        labels: pairs.map((p) => dateLabel(p.afterMeasuredAt)),
        datasets: [
          {
            label: "Mean improvement (%)",
            data: pairs.map((p) => (isNum(p.meanImprovementPct) ? p.meanImprovementPct : null)),
            backgroundColor: cssVar("--success", "#16a34a"),
          },
        ],
      },
      options: (() => {
        const o = baseOptions("% improvement");
        o.scales.y.beginAtZero = false;
        return o;
      })(),
    });
    if (!ok && !message) message = NO_CHART_LIB_MSG;
  }
  setMsg("overview-efficiency-msg", message);
}

/* ---------- loading ---------- */

async function loadOverview() {
  if (!selection.vessel) return;
  const mySeq = ++requestSeq;
  hideError();
  renderLoading();
  try {
    const qs = `vessel=${encodeURIComponent(selection.vessel)}&days=${selection.days}`;
    const data = await apiCall(`/api/overview?${qs}`);
    if (mySeq !== requestSeq) return;
    renderContext(data);
    renderKpis(data);
    // Each section renders on its own so one failing block cannot blank the rest.
    for (const render of [renderCleaning, renderNoise, renderEfficiency]) {
      try {
        render(data);
      } catch (err) {
        console.error("Overview section failed", err);
      }
    }
  } catch (err) {
    if (mySeq !== requestSeq) return;
    if (err && err.message === "Session expired") return; // unauthorized handler returns to login
    const ctx = safeGet("overview-context");
    if (ctx) ctx.textContent = "";
    for (const id of ["overview-cleaning-msg", "overview-noise-msg", "overview-efficiency-msg"]) setMsg(id, null);
    showError(`Could not load the overview: ${err && err.message ? err.message : "unknown error"}`, loadOverview);
  }
}

function fillVesselPicker() {
  const select = safeGet("overview-vessel");
  if (!select) return;
  clear(select);
  for (const v of vessels) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    select.append(opt);
  }
  if (selection.vessel) select.value = selection.vessel;
  const days = safeGet("overview-days");
  if (days) days.value = String(selection.days);
}

function bindControls() {
  if (listenersBound) return;
  listenersBound = true;
  const vesselSel = safeGet("overview-vessel");
  const daysSel = safeGet("overview-days");
  if (vesselSel) {
    vesselSel.addEventListener("change", () => {
      selection.vessel = vesselSel.value;
      storeSelection();
      loadOverview();
    });
  }
  if (daysSel) {
    daysSel.addEventListener("change", () => {
      selection.days = ALLOWED_DAYS.includes(Number(daysSel.value)) ? Number(daysSel.value) : 30;
      storeSelection();
      loadOverview();
    });
  }
}

async function initOverviewApp() {
  bindControls();
  hideError();
  try {
    const res = await apiCall("/api/overview/vessels");
    vessels = Array.isArray(res && res.vessels) ? res.vessels : [];
  } catch (err) {
    if (err && err.message === "Session expired") return;
    showError(`Could not load vessels: ${err && err.message ? err.message : "unknown error"}`, initOverviewApp);
    return;
  }
  if (vessels.length === 0) {
    fillVesselPicker();
    const ctx = safeGet("overview-context");
    if (ctx) ctx.textContent = "No vessels found";
    return;
  }
  selection = resolveSelection(readStoredSelection());
  fillVesselPicker();
  await loadOverview();
}

async function init() {
  // A 401 from any request drops back to the login screen (same as the main app).
  setUnauthorizedHandler(() => {
    requestSeq++;
    clearSession();
    showLogin();
  });
  setOnShowAppCallback(initOverviewApp);

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
