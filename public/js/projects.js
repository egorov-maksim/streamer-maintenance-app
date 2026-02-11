/**
 * Projects, config, streamer deployments, backups.
 * Call initProjects({ refreshEverything, renderHeatmap, refreshStatsFiltered }) before using.
 */

import { config, projects, setConfig, setProjects, setSelectedProjectFilter } from "./state.js";
import * as API from "./api.js";
import { safeGet, setStatus, showErrorToast, showWarningToast, showSuccessToast, showAccessDeniedToast } from "./ui.js";
import { isSuperUser } from "./auth.js";
import { openModal, closeModal } from "./modals.js";

let refreshCallbacks = {};

export function initProjects(callbacks = {}) {
  refreshCallbacks = callbacks;
}

async function refresh() {
  if (refreshCallbacks.refreshEverything) await refreshCallbacks.refreshEverything();
  if (refreshCallbacks.renderHeatmap) await refreshCallbacks.renderHeatmap();
  if (refreshCallbacks.refreshStatsFiltered) await refreshCallbacks.refreshStatsFiltered();
}

// --- Config ---
export async function loadConfig() {
  try {
    const data = await API.fetchConfig();
    setConfig(data);
    document.documentElement.style.setProperty("--sections", config.sectionsPerCable);
    populateConfigForm(config);
    updateConfigProjectLabel();
  } catch (err) {
    console.error(err);
  }
}

export function populateConfigForm(cfg) {
  const el = (id) => safeGet(id);
  if (el("cfg-numCables")) el("cfg-numCables").value = cfg.numCables;
  if (el("cfg-sectionsPerCable")) el("cfg-sectionsPerCable").value = cfg.sectionsPerCable;
  if (el("cfg-sectionLength")) el("cfg-sectionLength").value = cfg.sectionLength;
  if (el("cfg-moduleFrequency")) el("cfg-moduleFrequency").value = cfg.moduleFrequency;
  if (el("cfg-channelsPerSection")) el("cfg-channelsPerSection").value = cfg.channelsPerSection;
  if (el("cfg-useRopeForTail")) el("cfg-useRopeForTail").value = cfg.useRopeForTail;
}

export function updateConfigProjectLabel() {
  const label = safeGet("config-project-label");
  if (!label) return;
  const activeProject = projects.find((p) => p.isActive);
  label.textContent = activeProject ? `(for ${activeProject.projectNumber})` : "(global defaults)";
}

export function getConfigFromForm() {
  return {
    numCables: parseInt(safeGet("cfg-numCables")?.value, 10) || 12,
    sectionsPerCable: parseInt(safeGet("cfg-sectionsPerCable")?.value, 10) || 107,
    sectionLength: parseInt(safeGet("cfg-sectionLength")?.value, 10) || 75,
    moduleFrequency: parseInt(safeGet("cfg-moduleFrequency")?.value, 10) || 4,
    channelsPerSection: parseInt(safeGet("cfg-channelsPerSection")?.value, 10) || 6,
    useRopeForTail: safeGet("cfg-useRopeForTail")?.value === "true",
  };
}

export async function saveConfig() {
  const statusEl = safeGet("config-status");
  if (!isSuperUser()) {
    setStatus(statusEl, "SuperUser access required", true);
    return;
  }
  const activeProject = projects.find((p) => p.isActive);
  if (activeProject) {
    await saveProjectConfig(activeProject.id);
  } else {
    await saveGlobalConfig();
  }
}

export async function saveProjectConfig(projectId) {
  const statusEl = safeGet("config-status");
  const previousNumCables = config.numCables;
  try {
    const formConfig = getConfigFromForm();
    const activeProject = projects.find((p) => p.id === projectId);
    const body = {
      projectName: activeProject?.projectName || null,
      vesselTag: activeProject?.vesselTag || "TTN",
      ...formConfig,
    };
    const updated = await API.updateProject(projectId, body);
    setConfig({ ...config, ...updated });
    document.documentElement.style.setProperty("--sections", config.sectionsPerCable);
    setStatus(statusEl, `✅ Configuration saved for ${updated.projectNumber}`);
    await handleStreamerCountChange(previousNumCables, config.numCables);
    await loadProjects();
    await refresh();
  } catch (err) {
    console.error(err);
    setStatus(statusEl, "Failed to save config", true);
  }
}

export async function saveGlobalConfig() {
  const statusEl = safeGet("config-status");
  const previousNumCables = config.numCables;
  try {
    const body = getConfigFromForm();
    const data = await API.updateConfig(body);
    setConfig(data);
    document.documentElement.style.setProperty("--sections", config.sectionsPerCable);
    setStatus(statusEl, "✅ Global configuration updated");
    await handleStreamerCountChange(previousNumCables, config.numCables);
    await refresh();
  } catch (err) {
    console.error(err);
    setStatus(statusEl, "Failed to save config", true);
  }
}

export async function handleStreamerCountChange(previousNumCables, newNumCables) {
  if (previousNumCables === newNumCables) return;
  if (newNumCables < previousNumCables && isSuperUser()) {
    showWarningToast(
      "Streamer count reduced",
      `Streamers ${newNumCables + 1}-${previousNumCables} are now hidden. Events and deployment data for those streamers still exist. Use "Cleanup orphaned streamers" to remove them.`
    );
  }
  await renderStreamerDeploymentGrid();
  if (refreshCallbacks.renderHeatmap) await refreshCallbacks.renderHeatmap();
}

/** Opens the cleanup orphaned streamers modal and sets the "streamers affected" range. Call from button click. */
export function cleanupOrphanedStreamers() {
  if (!isSuperUser()) {
    showAccessDeniedToast("cleanup orphaned streamers");
    return;
  }
  const maxId = config.numCables;
  const rangeEl = safeGet("cleanup-orphaned-range");
  if (rangeEl) rangeEl.textContent = `Streamers ${maxId + 1} and above`;
  openModal("cleanup-orphaned-modal");
}

/** Closes the cleanup orphaned streamers modal. */
export function closeCleanupOrphanedModal() {
  closeModal("cleanup-orphaned-modal");
}

/** Performs the cleanup API call. Call from modal confirm button. Caller should close the modal after. */
export async function performCleanupOrphanedStreamers() {
  const maxId = config.numCables;
  try {
    const data = await API.cleanupStreamers({ maxStreamerId: maxId });
    showSuccessToast("Cleanup complete", `Removed ${data.deletedEvents || 0} events and ${data.deletedDeployments || 0} deployment configs.`);
    await refresh();
    await renderStreamerDeploymentGrid();
  } catch (err) {
    console.error(err);
    showErrorToast("Cleanup failed", err.message || "Failed to cleanup streamers");
  }
}

// --- Project list & API ---
let projectEventCounts = {};

export async function loadProjects() {
  try {
    const [projectsData, statsData] = await Promise.all([
      API.fetchProjects(),
      API.fetchProjectStats(),
    ]);
    setProjects(projectsData);
    projectEventCounts = statsData;
    renderProjectList();
    populateProjectSelector();
    updateActiveProjectBanner();
    updateConfigProjectLabel();
  } catch (err) {
    console.error("Failed to load projects:", err);
  }
}

export async function createProject() {
  const statusEl = safeGet("project-status");
  if (!isSuperUser()) {
    setStatus(statusEl, "SuperUser access required", true);
    return;
  }
  const projectNumber = safeGet("new-project-number")?.value?.trim();
  const projectName = safeGet("new-project-name")?.value?.trim();
  const vesselTag = safeGet("new-project-vessel")?.value?.trim() || "TTN";
  if (!projectNumber) {
    setStatus(statusEl, "Project number is required", true);
    return;
  }
  try {
    await API.createProject({
      projectNumber,
      projectName,
      vesselTag,
      ...getConfigFromForm(),
    });
    safeGet("new-project-number").value = "";
    safeGet("new-project-name").value = "";
    safeGet("new-project-vessel").value = "TTN";
    setStatus(statusEl, "✅ Project created with current configuration");
    await loadProjects();
  } catch (err) {
    console.error(err);
    setStatus(statusEl, "Failed to create project", true);
  }
}

export async function activateProject(projectId) {
  if (!isSuperUser()) {
    showAccessDeniedToast("activate project");
    return;
  }
  try {
    const project = await API.activateProject(projectId);
    if (project) {
      setConfig({
        ...config,
        numCables: project.numCables,
        sectionsPerCable: project.sectionsPerCable,
        sectionLength: project.sectionLength,
        moduleFrequency: project.moduleFrequency,
        channelsPerSection: project.channelsPerSection,
        useRopeForTail: project.useRopeForTail,
        vesselTag: project.vesselTag,
        activeProjectNumber: project.projectNumber,
      });
      setSelectedProjectFilter(String(project.projectNumber));
      document.documentElement.style.setProperty("--sections", config.sectionsPerCable);
      populateConfigForm(config);
    }
    await loadProjects();
    updateActiveProjectBanner();
    updateConfigProjectLabel();
    showSuccessToast("Project Activated", `Streamer configuration loaded for ${project.projectNumber}.`);
    await refresh();
    await renderStreamerDeploymentGrid();
  } catch (err) {
    console.error(err);
    showErrorToast("Activation Failed", "Failed to activate project.");
  }
}

export async function activateSelectedProject() {
  const selector = safeGet("project-selector");
  const projectNumber = selector?.value;
  if (!projectNumber) {
    await clearActiveProject();
    return;
  }
  const project = projects.find((p) => p.projectNumber === projectNumber);
  if (project) await activateProject(project.id);
}

export async function clearActiveProject() {
  if (!isSuperUser()) {
    showAccessDeniedToast("clear active project");
    return;
  }
  try {
    await API.deactivateProjects();
    await loadConfig();
    await loadProjects();
    setSelectedProjectFilter(null);
    updateActiveProjectBanner();
    updateConfigProjectLabel();
    const section = safeGet("streamer-deployment-section");
    if (section) section.style.display = "none";
    showSuccessToast("Project Cleared", "Using global configuration.");
    await refresh();
  } catch (err) {
    console.error(err);
    showErrorToast("Failed", "Failed to clear active project.");
  }
}

export async function deleteProject(projectId) {
  if (!isSuperUser()) {
    showAccessDeniedToast("delete project");
    return;
  }
  try {
    const res = await fetch(`api/projects/${projectId}`, {
      method: "DELETE",
      headers: API.getAuthHeaders(),
    });
    const data = await res.json();
    if (res.ok) {
      showSuccessToast("Project Deleted", "The project has been removed.");
      await loadProjects();
      return;
    }
    if (res.status === 409 && data.requiresConfirmation) {
      showForceDeleteProjectModal(projectId, data.eventCount || 0, data.deploymentCount || 0);
      return;
    }
    showErrorToast("Delete Failed", data.error || "Failed to delete project.");
  } catch (err) {
    console.error(err);
    showErrorToast("Delete Failed", "Failed to delete project.");
  }
}

// --- Force delete modal ---
let forceDeletePendingProjectId = null;

export function showForceDeleteProjectModal(projectId, eventCount, deploymentCount) {
  const modal = safeGet("force-delete-project-modal");
  const messageEl = safeGet("force-delete-project-message");
  const input = safeGet("force-delete-project-input");
  const confirmBtn = safeGet("btn-force-delete-project-confirm");
  if (!modal || !messageEl || !input || !confirmBtn) return;
  const parts = [];
  if (eventCount > 0) parts.push(`${eventCount} event(s)`);
  if (deploymentCount > 0) parts.push(`${deploymentCount} deployment config(s)`);
  messageEl.textContent = `This project has ${parts.join(" and ")}. All will be permanently deleted. Type DELETE to confirm.`;
  input.value = "";
  confirmBtn.disabled = true;
  forceDeletePendingProjectId = projectId;
  modal.classList.add("show");
  input.focus();
}

export function closeForceDeleteProjectModal() {
  forceDeletePendingProjectId = null;
  const modal = safeGet("force-delete-project-modal");
  if (modal) modal.classList.remove("show");
}

export async function confirmForceDeleteProject() {
  const id = forceDeletePendingProjectId;
  const inp = safeGet("force-delete-project-input");
  if (!id || !inp || inp.value.trim() !== "DELETE") return;
  try {
    await API.forceDeleteProject(id);
    closeForceDeleteProjectModal();
    forceDeletePendingProjectId = null;
    showSuccessToast("Project Deleted", "Project and all associated data have been removed.");
    await loadProjects();
  } catch (err) {
    console.error(err);
    showErrorToast("Delete Failed", err.message || "Failed to delete project.");
  }
}

// --- Project list UI ---
export function renderProjectList() {
  const container = safeGet("project-list");
  if (!container) return;
  if (projects.length === 0) {
    container.innerHTML = '<p style="color: #6b7280; font-size: 13px;">No projects created yet.</p>';
    return;
  }
  container.innerHTML = projects
    .map((p) => {
      const isActive = p.isActive === true;
      const eventCount = projectEventCounts[p.projectNumber] || 0;
      const deleteBtn =
        isSuperUser() && !isActive
          ? `<button class="btn btn-outline btn-sm btn-delete-project" data-id="${p.id}" title="Delete project">🗑️</button>`
          : "";
      return `
        <div class="project-item ${isActive ? "active" : ""}">
          <div class="project-item-info">
            <span class="project-number">${p.projectNumber}</span>
            ${p.projectName ? `<span class="project-name">${p.projectName}</span>` : ""}
            <span class="project-vessel">${p.vesselTag || "TTN"}</span>
            <span class="project-event-count" title="Events in this project">${eventCount} events</span>
            ${isActive ? '<span class="badge badge-active">Active</span>' : ""}
          </div>
          <div class="project-item-actions">${deleteBtn}</div>
        </div>
      `;
    })
    .join("");
  container.querySelectorAll(".btn-delete-project").forEach((btn) => {
    btn.addEventListener("click", () => deleteProject(parseInt(btn.dataset.id)));
  });
}

export function populateProjectSelector() {
  const selector = safeGet("project-selector");
  if (!selector) return;
  selector.innerHTML = '<option value="">-- All Projects (No Filter) --</option>';
  projects.forEach((p) => {
    const option = document.createElement("option");
    option.value = p.projectNumber;
    option.textContent = p.projectName ? `${p.projectNumber} - ${p.projectName}` : p.projectNumber;
    if (p.isActive === true) option.textContent += " (Active)";
    selector.appendChild(option);
  });
  const activeProject = projects.find((p) => p.isActive === true);
  if (activeProject) selector.value = activeProject.projectNumber;
}

export function updateActiveProjectBanner() {
  const banner = safeGet("active-project-banner");
  const nameEl = safeGet("active-project-name");
  const vesselEl = safeGet("active-project-vessel");
  const clearBtn = safeGet("btn-clear-project");
  if (!banner || !nameEl) return;
  const activeProject = projects.find((p) => p.isActive === true);
  if (activeProject) {
    nameEl.textContent = activeProject.projectName ? `${activeProject.projectNumber} - ${activeProject.projectName}` : activeProject.projectNumber;
    vesselEl.textContent = `[${activeProject.vesselTag || "TTN"}]`;
    banner.classList.add("has-project");
    if (clearBtn && isSuperUser()) clearBtn.classList.remove("hidden");
  } else {
    nameEl.textContent = "No project selected";
    vesselEl.textContent = "";
    banner.classList.remove("has-project");
    if (clearBtn) clearBtn.classList.add("hidden");
  }
}

export function setProjectFilter(projectNumber) {
  setSelectedProjectFilter(projectNumber ? String(projectNumber) : null);
  if (refreshCallbacks.refreshEverything) refreshCallbacks.refreshEverything();
  if (refreshCallbacks.renderHeatmap) refreshCallbacks.renderHeatmap();
  if (refreshCallbacks.refreshStatsFiltered) refreshCallbacks.refreshStatsFiltered();
}

// --- Streamer deployments ---
export async function renderStreamerDeploymentGrid() {
  const container = safeGet("streamer-deployment-grid");
  const section = safeGet("streamer-deployment-section");
  if (!container || !section) return;
  const activeProject = projects.find((p) => p.isActive);
  if (!activeProject) {
    section.style.display = "none";
    return;
  }
  section.style.display = "block";
  const label = safeGet("streamer-config-project-label");
  if (label) label.textContent = `for ${activeProject.projectNumber}`;
  const numCables = config.numCables;
  let deployments = {};
  try {
    deployments = await API.fetchStreamerDeployments(activeProject.id);
  } catch (err) {
    console.error("Failed to load streamer deployments", err);
  }
  container.innerHTML = "";
  for (let streamerNum = 1; streamerNum <= numCables; streamerNum++) {
    const deployment = deployments[streamerNum] || {};
    const hasConfig = deployment.deploymentDate || (deployment.isCoated !== null && deployment.isCoated !== undefined);
    const deployDateValue = deployment.deploymentDate ? new Date(deployment.deploymentDate).toISOString().split("T")[0] : "";
    const coatingActive = deployment.isCoated === true ? "true" : deployment.isCoated === false ? "false" : "";
    const card = document.createElement("div");
    card.className = `streamer-deployment-card modern ${hasConfig ? "has-config" : ""}`;
    card.dataset.streamer = streamerNum;
    card.innerHTML = `
      <div class="streamer-card-header">
        <span class="streamer-card-title">🔧 Streamer ${streamerNum}</span>
        <span class="streamer-status">
          <span class="status-badge ${hasConfig ? "configured" : ""}">${hasConfig ? "✓ Configured" : "Default"}</span>
          ${deployment.isCoated === true ? '<span class="coating-badge coated">Coated</span>' : ""}
          ${deployment.isCoated === false ? '<span class="coating-badge uncoated">Uncoated</span>' : ""}
        </span>
      </div>
      <div class="streamer-deployment-inputs">
        <div class="streamer-input-group">
          <label>📅 Deployment Date</label>
          <input type="date" class="streamer-deploy-date" data-streamer="${streamerNum}" value="${deployDateValue}" ${!isSuperUser() ? "disabled" : ""} />
        </div>
        <div class="streamer-input-group">
          <label>🛡️ Coating</label>
          <div class="coating-toggle" data-streamer="${streamerNum}">
            <button type="button" class="coating-option ${coatingActive === "true" ? "active" : ""}" data-value="true" ${!isSuperUser() ? "disabled" : ""}>Coated</button>
            <button type="button" class="coating-option ${coatingActive === "false" ? "active" : ""}" data-value="false" ${!isSuperUser() ? "disabled" : ""}>Uncoated</button>
            <button type="button" class="coating-option ${coatingActive === "" ? "active" : ""}" data-value="" ${!isSuperUser() ? "disabled" : ""}>Unknown</button>
          </div>
        </div>
      </div>
      ${isSuperUser() && hasConfig ? `<div class="streamer-card-actions"><button type="button" class="btn-icon btn-clear streamer-card-clear" data-streamer="${streamerNum}" title="Clear configuration">🗑️ Clear</button></div>` : ""}
    `;
    container.appendChild(card);
  }
  container.querySelectorAll(".coating-toggle").forEach((toggle) => {
    toggle.querySelectorAll(".coating-option").forEach((btn) => {
      if (btn.disabled) return;
      btn.addEventListener("click", () => {
        toggle.querySelectorAll(".coating-option").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });
  });
  if (isSuperUser()) {
    container.querySelectorAll(".streamer-card-clear").forEach((btn) => {
      btn.addEventListener("click", () => clearStreamerDeployment(activeProject.id, btn.dataset.streamer));
    });
  }
}

export async function saveStreamerDeployments() {
  const statusEl = safeGet("streamer-deployment-status");
  if (!isSuperUser()) {
    setStatus(statusEl, "SuperUser access required", true);
    return;
  }
  const activeProject = projects.find((p) => p.isActive);
  if (!activeProject) {
    setStatus(statusEl, "No active project", true);
    return;
  }
  const deployments = {};
  document.querySelectorAll(".streamer-deploy-date").forEach((input) => {
    const streamerNum = input.dataset.streamer;
    if (!deployments[streamerNum]) deployments[streamerNum] = {};
    deployments[streamerNum].deploymentDate = input.value || null;
  });
  document.querySelectorAll(".coating-toggle").forEach((toggle) => {
    const streamerNum = toggle.dataset.streamer;
    if (!deployments[streamerNum]) deployments[streamerNum] = {};
    const activeBtn = toggle.querySelector(".coating-option.active");
    const value = activeBtn ? activeBtn.dataset.value : "";
    deployments[streamerNum].isCoated = value === "true" ? true : value === "false" ? false : null;
  });
  try {
    setStatus(statusEl, "Saving configurations...", false);
    await API.updateStreamerDeployments(activeProject.id, deployments);
    setStatus(statusEl, "✓ Configurations saved successfully");
    showSuccessToast("Saved", "Streamer deployment configurations updated");
    await renderStreamerDeploymentGrid();
    if (refreshCallbacks.refreshStatsFiltered) await refreshCallbacks.refreshStatsFiltered();
  } catch (err) {
    console.error(err);
    setStatus(statusEl, "Failed to save configurations", true);
    showErrorToast("Save Failed", "Could not save streamer configurations");
  }
}

// Pending state for clear-one streamer modal
let clearOneDeploymentPending = null;

export function clearStreamerDeployment(projectId, streamerNum) {
  if (!isSuperUser()) {
    showAccessDeniedToast("clear streamer configuration");
    return;
  }
  showClearOneDeploymentModal(projectId, streamerNum);
}

// --- Set All Date modal ---
export function showSetAllDateModal() {
  if (!isSuperUser()) {
    showAccessDeniedToast("set deployment dates");
    return;
  }
  const modal = safeGet("set-all-date-modal");
  const input = safeGet("set-all-date-input");
  if (!modal || !input) return;
  const today = new Date().toISOString().split("T")[0];
  input.value = today;
  modal.classList.add("show");
  input.focus();
}

export function closeSetAllDateModal() {
  const modal = safeGet("set-all-date-modal");
  if (modal) modal.classList.remove("show");
}

export function applySetAllDateModal() {
  const input = safeGet("set-all-date-input");
  if (!input) return;
  const date = (input.value || "").trim();
  if (!date) {
    showErrorToast("Invalid Date", "Please enter a date.");
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    showErrorToast("Invalid Date", "Please use format: YYYY-MM-DD");
    return;
  }
  document.querySelectorAll(".streamer-deploy-date").forEach((el) => (el.value = date));
  closeSetAllDateModal();
  showSuccessToast("Applied", "Date set for all streamers. Click Save to apply.");
}

// --- Set All Coating modal ---
export function showSetAllCoatingModal() {
  if (!isSuperUser()) {
    showAccessDeniedToast("set coating status");
    return;
  }
  const modal = safeGet("set-all-coating-modal");
  if (!modal) return;
  document.querySelectorAll("#set-all-coating-modal .coating-modal-option").forEach((btn) => btn.classList.remove("active"));
  const unknownBtn = safeGet("set-all-coating-unknown");
  if (unknownBtn) unknownBtn.classList.add("active");
  modal.classList.add("show");
}

export function closeSetAllCoatingModal() {
  const modal = safeGet("set-all-coating-modal");
  if (modal) modal.classList.remove("show");
}

export function applySetAllCoatingModal() {
  const active = document.querySelector("#set-all-coating-modal .coating-modal-option.active");
  const value = active ? active.dataset.value : "";
  const label = value === "true" ? "Coated" : value === "false" ? "Uncoated" : "Unknown";
  document.querySelectorAll(".coating-toggle").forEach((toggle) => {
    toggle.querySelectorAll(".coating-option").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.value === value);
    });
  });
  closeSetAllCoatingModal();
  showSuccessToast("Applied", `All streamers set to ${label}. Click Save to apply.`);
}

// --- Clear All deployments modal ---
export function showClearAllDeploymentsModal() {
  if (!isSuperUser()) {
    showAccessDeniedToast("clear streamer configurations");
    return;
  }
  const modal = safeGet("clear-all-deployments-modal");
  if (modal) modal.classList.add("show");
}

export function closeClearAllDeploymentsModal() {
  const modal = safeGet("clear-all-deployments-modal");
  if (modal) modal.classList.remove("show");
}

export function confirmClearAllDeployments() {
  document.querySelectorAll(".streamer-deploy-date").forEach((input) => (input.value = ""));
  document.querySelectorAll(".coating-toggle").forEach((toggle) => {
    toggle.querySelectorAll(".coating-option").forEach((btn) => btn.classList.toggle("active", btn.dataset.value === ""));
  });
  closeClearAllDeploymentsModal();
  showSuccessToast("Cleared", "All configurations cleared. Click Save to apply.");
}

// --- Clear one streamer modal ---
export function showClearOneDeploymentModal(projectId, streamerNum) {
  clearOneDeploymentPending = { projectId, streamerNum };
  const messageEl = safeGet("clear-one-deployment-message");
  if (messageEl) messageEl.textContent = `Clear configuration for Streamer ${streamerNum}?`;
  const modal = safeGet("clear-one-deployment-modal");
  if (modal) modal.classList.add("show");
}

export function closeClearOneDeploymentModal() {
  clearOneDeploymentPending = null;
  const modal = safeGet("clear-one-deployment-modal");
  if (modal) modal.classList.remove("show");
}

export async function confirmClearOneDeployment() {
  if (!clearOneDeploymentPending) return;
  const { projectId, streamerNum } = clearOneDeploymentPending;
  closeClearOneDeploymentModal();
  clearOneDeploymentPending = null;
  try {
    await API.deleteStreamerDeployment(projectId, streamerNum);
    showSuccessToast("Cleared", `Streamer ${streamerNum} configuration cleared`);
    await renderStreamerDeploymentGrid();
  } catch (err) {
    console.error(err);
    showErrorToast("Clear Failed", "Could not clear configuration");
  }
}

export function setAllDeploymentDates() {
  showSetAllDateModal();
}

export function setAllCoatingStatus() {
  showSetAllCoatingModal();
}

export function clearAllStreamerDeployments() {
  showClearAllDeploymentsModal();
}

// --- Backups ---
export async function loadBackups() {
  const container = safeGet("backup-list");
  if (!container) return;
  if (!isSuperUser()) {
    container.innerHTML = "";
    return;
  }
  try {
    const data = await API.fetchBackups();
    const backups = data.backups || [];
    if (backups.length === 0) {
      container.innerHTML = '<div class="backup-empty">No backups available yet. Backups are created automatically every 12 hours.</div>';
      return;
    }
    container.innerHTML = backups
      .map((backup) => {
        const date = new Date(backup.createdAt);
        const formattedDate = date.toLocaleDateString() + " " + date.toLocaleTimeString();
        const sizeKB = (backup.size / 1024).toFixed(1);
        return `
          <div class="backup-item">
            <div class="backup-item-info">
              <span class="backup-filename">${backup.filename}</span>
              <div class="backup-meta"><span>📅 ${formattedDate}</span><span>📦 ${sizeKB} KB</span></div>
            </div>
            <div class="backup-item-actions">
              <button class="btn btn-sm btn-restore" data-filename="${backup.filename}" title="Restore this backup">🔄 Restore</button>
            </div>
          </div>
        `;
      })
      .join("");
    container.querySelectorAll(".btn-restore").forEach((btn) => {
      btn.addEventListener("click", () => restoreBackup(btn.dataset.filename));
    });
  } catch (err) {
    console.error("Failed to load backups:", err);
    container.innerHTML = '<div class="backup-empty">Error loading backups</div>';
  }
}

export async function createBackup() {
  const statusEl = safeGet("backup-status");
  if (!isSuperUser()) {
    showAccessDeniedToast("create backups");
    return;
  }
  try {
    setStatus(statusEl, "Creating backup...", false);
    await API.createBackup();
    setStatus(statusEl, "✅ Backup created successfully");
    showSuccessToast("Backup Created", "Database backup has been created successfully.");
    await loadBackups();
  } catch (err) {
    console.error(err);
    setStatus(statusEl, "Failed to create backup", true);
    showErrorToast("Backup Failed", "Failed to create backup. Please try again.");
  }
}

export async function restoreBackup(filename) {
  if (!isSuperUser()) {
    showAccessDeniedToast("restore backups");
    return;
  }
  const confirmed = confirm(
    `⚠️ WARNING: Restoring from backup will replace ALL current data!\n\nAre you sure you want to restore from:\n${filename}?`
  );
  if (!confirmed) return;
  const statusEl = safeGet("backup-status");
  try {
    setStatus(statusEl, "Restoring backup...", false);
    await API.restoreBackup(filename);
    setStatus(statusEl, "✅ Backup restored");
    showSuccessToast("Restore Successful", "Database has been restored. Please restart the server for changes to take full effect.");
    await loadBackups();
    await refresh();
  } catch (err) {
    console.error(err);
    setStatus(statusEl, "Failed to restore backup", true);
    showErrorToast("Restore Failed", err.message || "Failed to restore backup. Please try again.");
  }
}
