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
  safeGet("btn-apply-filter")?.addEventListener("click", () => refreshStatsFiltered());
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

// ---------------------------------------------------------------------------
// Stats-page sidebar navigation
// Mirrors the interaction pattern from app.js (scroll + active state +
// mobile drawer) but without any route/history manipulation — the stats
// page is a standalone route and has no sub-path sections.
// ---------------------------------------------------------------------------

const STATS_DEFAULT_SECTION = 'project-filter-section';

function activateStatsNavSection(sectionId, smooth = true) {
  const target = document.getElementById(sectionId);
  if (!target) return;

  target.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant', block: 'start' });

  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  const navItem = document.querySelector(`.nav-item[data-target="${sectionId}"]`);
  if (navItem) navItem.classList.add('active');
}

function closeStatsMobileNav() {
  document.body.classList.remove('nav-open');
  const toggle = document.getElementById('nav-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
}

function setupStatsSidebarNavigation() {
  const toggle = document.getElementById('nav-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const isOpen = document.body.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', String(isOpen));
    });
  }

  // Close mobile sidebar when tapping the backdrop
  document.addEventListener('click', (e) => {
    if (
      document.body.classList.contains('nav-open') &&
      !e.target.closest('.sidebar-nav') &&
      !e.target.closest('#nav-toggle')
    ) {
      closeStatsMobileNav();
    }
  });

  document.querySelectorAll('.nav-item').forEach(item => {
    const activate = () => {
      activateStatsNavSection(item.dataset.target);
      closeStatsMobileNav();
    };
    item.addEventListener('click', activate);
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    });
  });

  // Keep the active nav item in sync as the user scrolls
  const sectionIds = Array.from(document.querySelectorAll('.nav-item'))
    .map(i => i.dataset.target)
    .filter(Boolean);

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
          const navItem = document.querySelector(`.nav-item[data-target="${entry.target.id}"]`);
          if (navItem) navItem.classList.add('active');
        }
      }
    },
    { threshold: 0.25 }
  );

  sectionIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
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
