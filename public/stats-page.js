import { safeGet, showErrorToast } from "./js/ui.js";
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
} from "./js/auth.js";
import * as Projects from "./js/projects.js";
import * as API from "./js/api.js";
import {
  setEvents,
  setSelectedProjectFilter,
  getActiveProject,
  projects,
} from "./js/state.js";
import { refreshStatsFiltered, resetFilter } from "./js/stats.js";
import { initPDFGeneration } from "./pdf-generator.js";

async function loadEvents() {
  const eventsData = await API.fetchEvents();
  setEvents(eventsData);
}

function populateProjectFilter() {
  const selector = safeGet("stats-project-filter");
  if (!selector) return;

  selector.innerHTML = '<option value="">-- All Projects --</option>';
  projects.forEach((p) => {
    const option = document.createElement("option");
    option.value = p.projectNumber;
    option.textContent = p.projectName
      ? `${p.projectNumber} - ${p.projectName}`
      : p.projectNumber;
    if (p.isActive === true) option.textContent += " (Active)";
    selector.appendChild(option);
  });

  const activeProject = getActiveProject();
  if (activeProject) {
    selector.value = activeProject.projectNumber;
    setSelectedProjectFilter(String(activeProject.projectNumber));
  }
}

// ── Cleaning noise efficiency KPI ─────────────────────────────────────────────

/**
 * Formats a date window preset value into { start, end } ISO date strings.
 * "filter" means: read the stats filter date inputs.
 */
function resolveWindowDates(windowValue) {
  if (windowValue === "filter") {
    return {
      start: safeGet("filter-start")?.value || null,
      end: safeGet("filter-end")?.value || null,
    };
  }
  const days = parseInt(windowValue, 10);
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  const fmt = (d) => d.toISOString().split("T")[0];
  // end = today; start = N days back (inclusive of today means last N days ending today)
  return { start: fmt(start), end: fmt(end) };
}

/** Populates both upload <select> elements from the project's upload list. */
async function populateNoiseUploadSelectors(projectNumber) {
  const beforeSel = safeGet("ne-upload-before");
  const afterSel = safeGet("ne-upload-after");
  if (!beforeSel || !afterSel) return;

  beforeSel.innerHTML = "<option value=''>Loading…</option>";
  afterSel.innerHTML = "<option value=''>Loading…</option>";

  const uploads = await API.getNoiseUploads(projectNumber);

  if (!uploads || uploads.length === 0) {
    const emptyOpt = "<option value=''>No uploads available</option>";
    beforeSel.innerHTML = emptyOpt;
    afterSel.innerHTML = emptyOpt;
    return;
  }

  const formatLabel = (u) => {
    const date = u.uploadedAt ? u.uploadedAt.slice(0, 16).replace("T", " ") : "unknown date";
    return u.label ? `${date} — ${u.label}` : date;
  };

  beforeSel.innerHTML = "";
  afterSel.innerHTML = "";

  uploads.forEach((u) => {
    const opt = () => {
      const o = document.createElement("option");
      o.value = u.id;
      o.textContent = formatLabel(u);
      return o;
    };
    beforeSel.appendChild(opt());
    afterSel.appendChild(opt());
  });

  // Default: after = latest (index 0), before = second-latest (index 1)
  if (uploads.length >= 1) afterSel.value = String(uploads[0].id);
  if (uploads.length >= 2) beforeSel.value = String(uploads[1].id);
  // If only one upload, both point to it — the API will return insufficient_uploads
  if (uploads.length === 1) beforeSel.value = String(uploads[0].id);
}

/** Toggles the efficiency controls based on whether a project is selected. */
function updateNoiseEfficiencyVisibility(projectNumber) {
  const notice = safeGet("noise-efficiency-no-project");
  const controls = safeGet("noise-efficiency-controls");
  if (!notice || !controls) return;

  if (projectNumber) {
    notice.classList.add("hidden");
    controls.classList.remove("hidden");
  } else {
    notice.classList.remove("hidden");
    controls.classList.add("hidden");
    clearNoiseEfficiencyResults();
  }
}

function clearNoiseEfficiencyResults() {
  safeGet("ne-results")?.classList.add("hidden");
  safeGet("ne-message")?.classList.add("hidden");
  const bd = safeGet("ne-breakdown");
  if (bd) bd.innerHTML = "";
}

function showNoiseEfficiencyMessage(text) {
  clearNoiseEfficiencyResults();
  const el = safeGet("ne-message");
  if (!el) return;
  const textEl = safeGet("ne-message-text");
  if (textEl) textEl.textContent = text;
  el.classList.remove("hidden");
}

function renderNoiseEfficiencyResults(data) {
  clearNoiseEfficiencyResults();

  if (data.status === "insufficient_uploads") {
    showNoiseEfficiencyMessage(data.message);
    return;
  }
  if (data.status === "no_events") {
    showNoiseEfficiencyMessage(data.message);
    return;
  }

  const fmt = (v, suffix = "%") =>
    v == null ? "—" : `${v > 0 ? "+" : ""}${v}${suffix}`;

  safeGet("ne-mean").textContent = fmt(data.meanImprovementPct);
  safeGet("ne-median").textContent = fmt(data.medianImprovementPct);
  safeGet("ne-improved-share").textContent =
    data.improvedSharePct == null ? "—" : `${data.improvedSharePct}%`;
  safeGet("ne-improved-count").textContent =
    `${data.improvedCount} of ${data.cellsPaired} sections show lower noise`;

  const rmsB = data.meanRmsBefore != null ? data.meanRmsBefore.toFixed(2) : "—";
  const rmsA = data.meanRmsAfter != null ? data.meanRmsAfter.toFixed(2) : "—";
  safeGet("ne-rms-pair").textContent = `${rmsB} / ${rmsA}`;
  safeGet("ne-paired-count").textContent = `${data.cellsPaired} section-cells with paired data`;

  const beforeLabel = data.uploadBefore?.label
    ? `${data.uploadBefore.uploadedAt?.slice(0, 10)} (${data.uploadBefore.label})`
    : data.uploadBefore?.uploadedAt?.slice(0, 10) ?? "—";
  const afterLabel = data.uploadAfter?.label
    ? `${data.uploadAfter.uploadedAt?.slice(0, 10)} (${data.uploadAfter.label})`
    : data.uploadAfter?.uploadedAt?.slice(0, 10) ?? "—";

  const skipped = data.skippedMissing > 0
    ? ` ${data.skippedMissing} section-cells lacked data in one or both uploads and were skipped.`
    : "";

  const footnoteEl = safeGet("ne-footnote");
  if (footnoteEl) {
    footnoteEl.textContent =
      `Comparing ${data.cellsInEvents} cleaned section-cells. ` +
      `Before upload: ${beforeLabel}. After upload: ${afterLabel}.` +
      skipped +
      " Positive % = noise reduced. This reflects the change between two noise snapshots, not a controlled before/after.";
  }

  if (data.ranges && data.ranges.length > 0) {
    renderNoiseEfficiencyBreakdown(data.ranges);
  }

  safeGet("ne-results")?.classList.remove("hidden");
}

/**
 * Renders a per-event breakdown table into #ne-breakdown.
 * Rows arrive pre-sorted newest-first from the server (ORDER BY cleaned_at DESC).
 *
 * @param {Array} ranges - computeNoiseEfficiencyByRange results from the API
 */
function renderNoiseEfficiencyBreakdown(ranges) {
  const container = safeGet("ne-breakdown");
  if (!container) return;

  const fmtPct = (v) => {
    if (v == null) return "—";
    const sign = v > 0 ? "+" : "";
    return `${sign}${v}%`;
  };

  const fmtRms = (v) => (v != null ? v.toFixed(2) : "—");

  const fmtSection = (idx) => `AS${String(idx + 1).padStart(2, "0")}`;

  const title = document.createElement("p");
  title.className = "ne-breakdown-title";
  title.textContent = "Per-range breakdown";

  const table = document.createElement("table");
  table.className = "ne-breakdown-table";

  table.innerHTML = `
    <thead>
      <tr>
        <th>Streamer</th>
        <th>Range</th>
        <th>Date cleaned</th>
        <th>Method</th>
        <th>Mean improvement</th>
        <th>Avg RMS before → after</th>
        <th>Paired / total</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector("tbody");

  for (const row of ranges) {
    const rangeLabel = `${fmtSection(row.sectionIndexStart)} – ${fmtSection(row.sectionIndexEnd)}`;
    const date = row.cleanedAt ? row.cleanedAt.slice(0, 10) : "—";
    const pct = row.meanImprovementPct;
    const pctText = fmtPct(pct);
    const pctClass =
      pct == null ? "" : pct > 0 ? "ne-breakdown-improved" : pct < 0 ? "ne-breakdown-worsened" : "";

    const rmsText =
      row.meanRmsBefore != null && row.meanRmsAfter != null
        ? `${fmtRms(row.meanRmsBefore)} → ${fmtRms(row.meanRmsAfter)}`
        : "—";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.streamerId}</td>
      <td>${rangeLabel}</td>
      <td>${date}</td>
      <td>${row.cleaningMethod || "—"}</td>
      <td class="${pctClass}">${pctText}</td>
      <td>${rmsText}</td>
      <td>${row.cellsPaired} / ${row.cellsInEvent}</td>
    `;
    tbody.appendChild(tr);
  }

  container.innerHTML = "";
  container.appendChild(title);
  container.appendChild(table);
}

async function calculateNoiseEfficiency(projectNumber) {
  const beforeSel = safeGet("ne-upload-before");
  const afterSel = safeGet("ne-upload-after");
  const windowSel = safeGet("ne-window");
  if (!beforeSel || !afterSel || !windowSel || !projectNumber) return;

  const uploadBeforeId = beforeSel.value ? Number(beforeSel.value) : null;
  const uploadAfterId = afterSel.value ? Number(afterSel.value) : null;
  const { start, end } = resolveWindowDates(windowSel.value);

  const btn = safeGet("ne-calculate-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Calculating…";
  }

  try {
    const data = await API.getCleaningNoiseEfficiency({
      project: projectNumber,
      uploadBeforeId,
      uploadAfterId,
      start,
      end,
    });
    renderNoiseEfficiencyResults(data);
  } catch (err) {
    showErrorToast("KPI Error", err.message || "Failed to compute noise efficiency");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Calculate efficiency";
    }
  }
}

function setupNoiseEfficiencyListeners() {
  safeGet("ne-calculate-btn")?.addEventListener("click", () => {
    const projectSel = safeGet("stats-project-filter");
    calculateNoiseEfficiency(projectSel?.value || null);
  });
}

// ── End noise efficiency KPI ──────────────────────────────────────────────────

function setupStatsEventListeners() {
  safeGet("btn-apply-filter")?.addEventListener("click", () => refreshStatsFiltered());
  safeGet("btn-reset-filter")?.addEventListener("click", resetFilter);

  safeGet("stats-project-filter")?.addEventListener("change", async (e) => {
    const projectNumber = e.target.value || null;
    setSelectedProjectFilter(projectNumber);
    await loadEvents();
    await refreshStatsFiltered();

    // Update noise efficiency KPI for new project selection
    updateNoiseEfficiencyVisibility(projectNumber);
    clearNoiseEfficiencyResults();
    if (projectNumber) {
      await populateNoiseUploadSelectors(projectNumber);
    }
  });
}

async function initStatsApp() {
  Projects.initProjects({ refreshStatsFiltered });
  await Projects.loadConfig();
  await Projects.loadProjects();
  await loadEvents();

  populateProjectFilter();
  setupStatsEventListeners();
  setupNoiseEfficiencyListeners();

  await refreshStatsFiltered();

  // Initialise noise efficiency KPI with the currently selected project
  const projectSel = safeGet("stats-project-filter");
  const initialProject = projectSel?.value || null;
  updateNoiseEfficiencyVisibility(initialProject);
  if (initialProject) {
    await populateNoiseUploadSelectors(initialProject);
  }

  initPDFGeneration();
  updateUIForRole();
}

// ---------------------------------------------------------------------------
// Stats-page sidebar navigation
// Mirrors the interaction pattern from app.js (scroll + active state +
// mobile drawer) but without any route/history manipulation.
// ---------------------------------------------------------------------------

const STATS_DEFAULT_SECTION = "project-filter-section";

function activateStatsNavSection(sectionId, smooth = true) {
  const target = document.getElementById(sectionId);
  if (!target) return;

  target.scrollIntoView({ behavior: smooth ? "smooth" : "instant", block: "start" });

  document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
  const navItem = document.querySelector(`.nav-item[data-target="${sectionId}"]`);
  if (navItem) navItem.classList.add("active");
}

function closeStatsMobileNav() {
  document.body.classList.remove("nav-open");
  const toggle = document.getElementById("nav-toggle");
  if (toggle) toggle.setAttribute("aria-expanded", "false");
}

function setupStatsSidebarNavigation() {
  const toggle = document.getElementById("nav-toggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const isOpen = document.body.classList.toggle("nav-open");
      toggle.setAttribute("aria-expanded", String(isOpen));
    });
  }

  document.addEventListener("click", (e) => {
    if (
      document.body.classList.contains("nav-open") &&
      !e.target.closest(".sidebar-nav") &&
      !e.target.closest("#nav-toggle")
    ) {
      closeStatsMobileNav();
    }
  });

  document.querySelectorAll(".nav-item").forEach((item) => {
    const activate = () => {
      activateStatsNavSection(item.dataset.target);
      closeStatsMobileNav();
    };

    item.addEventListener("click", activate);
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate();
      }
    });
  });

  const sectionIds = Array.from(document.querySelectorAll(".nav-item"))
    .map((item) => item.dataset.target)
    .filter(Boolean);

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
          const navItem = document.querySelector(`.nav-item[data-target="${entry.target.id}"]`);
          if (navItem) navItem.classList.add("active");
        }
      }
    },
    { threshold: 0.25 }
  );

  sectionIds.forEach((id) => {
    const section = document.getElementById(id);
    if (section) observer.observe(section);
  });

  activateStatsNavSection(STATS_DEFAULT_SECTION, false);
}

async function init() {
  setOnShowAppCallback(async () => {
    await initStatsApp();
    setupStatsSidebarNavigation();
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
