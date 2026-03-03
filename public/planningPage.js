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
  config,
  projects,
  setSelectedProjectFilter,
  selectedProjectFilter,
  getActiveProject,
} from "./js/state.js";
import { ageBucket, formatSectionLabel, formatEB } from "./js/streamer-utils.js";

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
        // Show days number; 0 is valid (cleaned today)
        cell.textContent = days !== null ? String(days) : "—";

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
        tailCell.textContent = days !== null ? String(days) : "—";

        col.appendChild(tailCell);
      }

      wrapper.appendChild(col);
    }

    container.appendChild(wrapper);
    attachSectionTooltips(container, lastCleaned);

  } catch (err) {
    console.error("renderPlanningHeatmap failed:", err);
    showErrorToast(err.message || "Failed to load planning heat map");
  }
}

/* ------------ Project filter ------------ */

function populateProjectFilter() {
  const selector = safeGet("planning-project-filter");
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

function setupFilterListener() {
  safeGet("planning-project-filter")?.addEventListener("change", async (e) => {
    setSelectedProjectFilter(e.target.value || null);
    await renderPlanningHeatmap();
  });
}

/* ------------ Bootstrap ------------ */

async function initPlanningApp() {
  Projects.initProjects({});
  await Projects.loadConfig();
  await Projects.loadProjects();

  populateProjectFilter();
  setupFilterListener();

  await renderPlanningHeatmap();

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
