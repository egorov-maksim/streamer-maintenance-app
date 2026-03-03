import { safeGet } from "./js/ui.js";
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

function setupStatsEventListeners() {
  safeGet("btn-apply-filter")?.addEventListener("click", refreshStatsFiltered);
  safeGet("btn-reset-filter")?.addEventListener("click", resetFilter);

  safeGet("stats-project-filter")?.addEventListener("change", async (e) => {
    setSelectedProjectFilter(e.target.value || null);
    await loadEvents();
    await refreshStatsFiltered();
  });
}

async function initStatsApp() {
  Projects.initProjects({ refreshStatsFiltered });
  await Projects.loadConfig();
  await Projects.loadProjects();
  await loadEvents();

  populateProjectFilter();
  setupStatsEventListeners();

  await refreshStatsFiltered();

  initPDFGeneration();
  updateUIForRole();
}

async function init() {
  setOnShowAppCallback(async () => {
    await initStatsApp();
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
