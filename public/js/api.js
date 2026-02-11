/**
 * API client: getAuthHeaders, apiCall, and all backend API wrappers.
 * Uses relative URLs (e.g. api/config). 401/403 trigger showAccessDeniedToast.
 */

import { authToken, setCurrentUser } from "./state.js";
import { showAccessDeniedToast } from "./ui.js";

export function getAuthHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }
  return headers;
}

export async function apiCall(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
      ...options.headers,
    },
  });

  if (res.status === 401 || res.status === 403) {
    const action = options.action || "perform this action";
    showAccessDeniedToast(action);
    throw new Error("Unauthorized");
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data;
}

// --- Auth ---
export async function fetchSession() {
  if (!authToken) return null;
  const res = await fetch("api/session", { headers: getAuthHeaders() });
  if (!res.ok) return null;
  return res.json();
}

// --- Config ---
export async function fetchConfig() {
  return apiCall("api/config");
}

export async function updateConfig(body) {
  return apiCall("api/config", {
    method: "PUT",
    body: JSON.stringify(body),
    action: "save global configuration",
  });
}

// --- Projects ---
export async function fetchProjects() {
  return apiCall("api/projects");
}

export async function fetchProjectStats() {
  return apiCall("api/projects/stats");
}

export async function createProject(body) {
  return apiCall("api/projects", {
    method: "POST",
    body: JSON.stringify(body),
    action: "create project",
  });
}

export async function updateProject(id, body) {
  return apiCall(`api/projects/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
    action: "update project",
  });
}

export async function activateProject(id) {
  return apiCall(`api/projects/${id}/activate`, {
    method: "PUT",
    action: "activate project",
  });
}

export async function deactivateProjects() {
  return apiCall("api/projects/deactivate", {
    method: "POST",
    action: "deactivate project",
  });
}

export async function deleteProject(id) {
  return apiCall(`api/projects/${id}`, {
    method: "DELETE",
    action: "delete project",
  });
}

export async function forceDeleteProject(id) {
  return apiCall(`api/projects/${id}/force`, {
    method: "DELETE",
    action: "force delete project",
  });
}

export async function fetchStreamerDeployments(projectId) {
  return apiCall(`api/projects/${projectId}/streamer-deployments`);
}

export async function updateStreamerDeployments(projectId, deployments) {
  return apiCall(`api/projects/${projectId}/streamer-deployments`, {
    method: "PUT",
    body: JSON.stringify(deployments),
    action: "update streamer deployments",
  });
}

export async function deleteStreamerDeployment(projectId, streamerId) {
  return apiCall(
    `api/projects/${projectId}/streamer-deployments/${streamerId}`,
    {
      method: "DELETE",
      action: "delete streamer deployment",
    }
  );
}

export async function cleanupStreamers(body) {
  return apiCall("api/cleanup-streamers", {
    method: "POST",
    body: JSON.stringify(body),
    action: "cleanup orphaned streamers",
  });
}

// --- Events ---
export async function fetchEvents(params = {}) {
  const searchParams = new URLSearchParams();
  if (params.project) searchParams.set("project", params.project);
  if (params.start) searchParams.set("start", params.start);
  if (params.end) searchParams.set("end", params.end);
  const query = searchParams.toString();
  return apiCall(`api/events${query ? "?" + query : ""}`);
}

export async function createEvent(body) {
  return apiCall("api/events", {
    method: "POST",
    body: JSON.stringify(body),
    action: "create event",
  });
}

export async function updateEvent(id, body) {
  return apiCall(`api/events/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
    action: "update event",
  });
}

export async function deleteEvent(id) {
  return apiCall(`api/events/${id}`, {
    method: "DELETE",
    action: "delete event",
  });
}

export async function clearEvents(project = null) {
  let url = "api/events";
  if (project) url += `?project=${encodeURIComponent(project)}`;
  return apiCall(url, {
    method: "DELETE",
    action: "clear events",
  });
}

// --- Stats ---
export async function fetchStats(params = {}) {
  const searchParams = new URLSearchParams(params);
  return apiCall(`api/stats${searchParams.toString() ? "?" + searchParams : ""}`);
}

export async function fetchFilteredStats(params) {
  const searchParams = new URLSearchParams(params);
  return apiCall(`api/stats/filter?${searchParams}`);
}

export async function fetchLastCleaned(params = {}) {
  const searchParams = new URLSearchParams(params);
  return apiCall(`api/last-cleaned${searchParams.toString() ? "?" + searchParams : ""}`);
}

export async function fetchLastCleanedFiltered(params) {
  const searchParams = new URLSearchParams(params);
  return apiCall(`api/last-cleaned-filtered?${searchParams}`);
}

// --- EB range ---
export async function getEBRange(startSection, endSection) {
  const data = await apiCall(
    `api/eb-range?start=${startSection}&end=${endSection}`
  );
  return data.ebRange || "-";
}

// --- Backups ---
export async function fetchBackups() {
  return apiCall("api/backups");
}

export async function createBackup() {
  return apiCall("api/backups", {
    method: "POST",
    action: "create backup",
  });
}

export async function restoreBackup(filename) {
  return apiCall(`api/backups/${encodeURIComponent(filename)}/restore`, {
    method: "POST",
    action: "restore backup",
  });
}
