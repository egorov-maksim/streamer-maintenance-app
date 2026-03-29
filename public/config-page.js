import { safeGet, setStatus, showAccessDeniedToast } from "./js/ui.js";
import {
  setOnShowAppCallback,
  loadSession,
  validateSession,
  showLogin,
  showApp,
  handleLogin,
  handleLogout,
  isSuperUser,
  updateUIForRole,
} from "./js/auth.js";
import * as Projects from "./js/projects.js";
import { projects } from "./js/state.js";
import { initModals } from "./js/modals.js";

function renderVesselProjectOverview() {
  const tableBody = safeGet("vessel-project-overview-body");
  const statusEl = safeGet("vessel-overview-status");
  if (!tableBody) return;

  tableBody.innerHTML = "";
  const allProjects = Array.isArray(projects) ? projects : [];

  if (!allProjects.length) {
    tableBody.innerHTML = `<tr><td colspan="3" class="text-muted">No projects available</td></tr>`;
    return;
  }

  const byVessel = new Map();
  allProjects.forEach((p) => {
    const vesselTag = p.vesselTag || "TTN";
    if (!byVessel.has(vesselTag)) {
      byVessel.set(vesselTag, { vesselTag, projects: [], activeProjectId: null });
    }
    const entry = byVessel.get(vesselTag);
    entry.projects.push(p);
    if (p.isActive) {
      entry.activeProjectId = p.id;
    }
  });

  const superUser = isSuperUser();

  byVessel.forEach((entry) => {
    const row = document.createElement("tr");
    const activeProject = entry.projects.find((p) => p.id === entry.activeProjectId) || null;

    const vesselCell = document.createElement("td");
    vesselCell.textContent = entry.vesselTag;

    const activeCell = document.createElement("td");
    if (superUser) {
      const select = document.createElement("select");
      select.className = "vessel-project-select";
      select.dataset.vessel = entry.vesselTag;

      const noneOption = document.createElement("option");
      noneOption.value = "";
      noneOption.textContent = "-- No Active Project --";
      select.appendChild(noneOption);

      entry.projects.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = String(p.id);
        opt.textContent = p.projectName ? `${p.projectNumber} - ${p.projectName}` : p.projectNumber;
        if (p.id === entry.activeProjectId) {
          opt.selected = true;
        }
        select.appendChild(opt);
      });

      select.addEventListener("change", async () => {
        const projectId = select.value ? parseInt(select.value, 10) : null;
        if (!projectId || projectId === entry.activeProjectId) return;

        try {
          setStatus(statusEl, "Updating active project...", false);
          await Projects.activateProject(projectId);
          setStatus(statusEl, "✅ Active project updated");
          await Projects.loadProjects();
          renderVesselProjectOverview();
        } catch (err) {
          console.error(err);
          setStatus(statusEl, "Failed to update active project", true);
        }
      });

      activeCell.appendChild(select);
    } else {
      activeCell.textContent = activeProject
        ? activeProject.projectName
          ? `${activeProject.projectNumber} - ${activeProject.projectName}`
          : activeProject.projectNumber
        : "—";
    }

    const nameCell = document.createElement("td");
    nameCell.textContent = activeProject?.projectName || "—";

    row.appendChild(vesselCell);
    row.appendChild(activeCell);
    row.appendChild(nameCell);
    tableBody.appendChild(row);
  });
}

function setupConfigEventListeners() {
  // Config
  safeGet("btn-save-config")?.addEventListener("click", Projects.saveConfig);
  safeGet("btn-cleanup-streamers")?.addEventListener(
    "click",
    Projects.cleanupOrphanedStreamers,
  );

  // Project management
  safeGet("btn-create-project")?.addEventListener(
    "click",
    Projects.createProject,
  );
  safeGet("btn-activate-project")?.addEventListener(
    "click",
    Projects.activateSelectedProject,
  );
  safeGet("btn-clear-project")?.addEventListener(
    "click",
    Projects.clearActiveProject,
  );
  safeGet("btn-save-project-comments")?.addEventListener(
    "click",
    Projects.saveProjectComments,
  );
  safeGet("project-selector")?.addEventListener("change", (e) => {
    Projects.setProjectFilter(e.target.value);
  });

  // Backup management
  safeGet("btn-create-backup")?.addEventListener(
    "click",
    Projects.createBackup,
  );
  safeGet("btn-refresh-backups")?.addEventListener(
    "click",
    Projects.loadBackups,
  );

  // Streamer deployment configuration
  safeGet("btn-save-streamer-deployments")?.addEventListener(
    "click",
    Projects.saveStreamerDeployments,
  );
  safeGet("btn-set-all-date")?.addEventListener(
    "click",
    Projects.setAllDeploymentDates,
  );
  safeGet("btn-set-all-coating")?.addEventListener(
    "click",
    Projects.setAllCoatingStatus,
  );
  safeGet("btn-clear-all-streamers")?.addEventListener(
    "click",
    Projects.clearAllStreamerDeployments,
  );

  // Modal - Set All Deployment Date
  safeGet("btn-set-all-date-close")?.addEventListener(
    "click",
    Projects.closeSetAllDateModal,
  );
  safeGet("btn-set-all-date-cancel")?.addEventListener(
    "click",
    Projects.closeSetAllDateModal,
  );
  safeGet("btn-set-all-date-apply")?.addEventListener(
    "click",
    Projects.applySetAllDateModal,
  );
  document
    .querySelector("#set-all-date-modal .modal-overlay")
    ?.addEventListener("click", Projects.closeSetAllDateModal);

  // Modal - Set All Coating
  safeGet("btn-set-all-coating-close")?.addEventListener(
    "click",
    Projects.closeSetAllCoatingModal,
  );
  safeGet("btn-set-all-coating-cancel")?.addEventListener(
    "click",
    Projects.closeSetAllCoatingModal,
  );
  safeGet("btn-set-all-coating-apply")?.addEventListener(
    "click",
    Projects.applySetAllCoatingModal,
  );
  document
    .querySelector("#set-all-coating-modal .modal-overlay")
    ?.addEventListener("click", Projects.closeSetAllCoatingModal);
  document
    .querySelectorAll("#set-all-coating-modal .coating-modal-option")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        document
          .querySelectorAll("#set-all-coating-modal .coating-modal-option")
          .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });

  // Modal - Clear All deployments
  safeGet("btn-clear-all-deployments-close")?.addEventListener(
    "click",
    Projects.closeClearAllDeploymentsModal,
  );
  safeGet("btn-clear-all-deployments-cancel")?.addEventListener(
    "click",
    Projects.closeClearAllDeploymentsModal,
  );
  safeGet("btn-clear-all-deployments-confirm")?.addEventListener(
    "click",
    Projects.confirmClearAllDeployments,
  );
  document
    .querySelector("#clear-all-deployments-modal .modal-overlay")
    ?.addEventListener("click", Projects.closeClearAllDeploymentsModal);

  // Modal - Clear One Streamer
  safeGet("btn-clear-one-deployment-close")?.addEventListener(
    "click",
    Projects.closeClearOneDeploymentModal,
  );
  safeGet("btn-clear-one-deployment-cancel")?.addEventListener(
    "click",
    Projects.closeClearOneDeploymentModal,
  );
  safeGet("btn-clear-one-deployment-confirm")?.addEventListener("click", () =>
    Projects.confirmClearOneDeployment(),
  );
  document
    .querySelector("#clear-one-deployment-modal .modal-overlay")
    ?.addEventListener("click", Projects.closeClearOneDeploymentModal);

  // Modal - Cleanup Orphaned Streamers
  safeGet("btn-cleanup-orphaned-close")?.addEventListener(
    "click",
    Projects.closeCleanupOrphanedModal,
  );
  safeGet("btn-cleanup-orphaned-cancel")?.addEventListener(
    "click",
    Projects.closeCleanupOrphanedModal,
  );
  safeGet("btn-cleanup-orphaned-confirm")?.addEventListener(
    "click",
    async () => {
      await Projects.performCleanupOrphanedStreamers();
      Projects.closeCleanupOrphanedModal();
    },
  );
  document
    .querySelector("#cleanup-orphaned-modal .modal-overlay")
    ?.addEventListener("click", Projects.closeCleanupOrphanedModal);

  // Modal - Force Delete Project
  safeGet("btn-force-delete-project-close")?.addEventListener(
    "click",
    Projects.closeForceDeleteProjectModal,
  );
  safeGet("btn-force-delete-project-cancel")?.addEventListener(
    "click",
    Projects.closeForceDeleteProjectModal,
  );
  document
    .querySelector("#force-delete-project-modal .modal-overlay")
    ?.addEventListener("click", Projects.closeForceDeleteProjectModal);
  safeGet("force-delete-project-input")?.addEventListener("input", () => {
    const btn = safeGet("btn-force-delete-project-confirm");
    const inp = safeGet("force-delete-project-input");
    if (btn && inp) btn.disabled = inp.value.trim() !== "DELETE";
  });
  safeGet("btn-force-delete-project-confirm")?.addEventListener(
    "click",
    () => Projects.confirmForceDeleteProject(),
  );
}

async function initConfigApp() {
  if (!isSuperUser()) {
    showAccessDeniedToast("access configuration");
    showLogin();
    return;
  }

  Projects.initProjects({});
  await Projects.loadConfig();
  await Projects.loadProjects();
  await Projects.loadBackups();
  await Projects.renderStreamerDeploymentGrid();

  initModals();
  setupConfigEventListeners();
  renderVesselProjectOverview();
  updateUIForRole();
}

async function init() {
  setOnShowAppCallback(async () => {
    await initConfigApp();
  });

  const loginForm = safeGet("login-form");
  if (loginForm) loginForm.addEventListener("submit", handleLogin);

  const loginBtn = safeGet("login-submit");
  if (loginBtn) loginBtn.addEventListener("click", handleLogin);

  const logoutBtn = safeGet("logout-btn");
  if (logoutBtn) logoutBtn.addEventListener("click", handleLogout);

  if (loadSession()) {
    const isValid = await validateSession();
    if (isValid) {
      if (!isSuperUser()) {
        showAccessDeniedToast("access configuration");
        showLogin();
        return;
      }
      showApp();
      return;
    }
  }

  showLogin();
}

init();

