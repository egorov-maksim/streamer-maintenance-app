/**
 * API client: getAuthHeaders, apiCall, and all backend API wrappers.
 * Uses relative URLs (e.g. api/config).
 *
 * 401 → session expired: clears storage, saves return URL, calls the registered
 *       unauthorized handler (set by app.js via setUnauthorizedHandler).
 * 403 → permission denied: shows an access-denied toast (existing behaviour).
 */

import { authToken, setCurrentUser } from "./state.js";
import { showAccessDeniedToast } from "./ui.js";

/** Registered by app.js — called whenever any authenticated request gets a 401. */
let unauthorizedHandler = null;

export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

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

  if (res.status === 401) {
    // Session is gone (e.g. server restarted). Save the current location so
    // the user can be returned here after re-logging in, then force to login.
    sessionStorage.setItem("redirectAfterLogin", window.location.href);
    localStorage.removeItem("authToken");
    localStorage.removeItem("currentUser");
    if (typeof unauthorizedHandler === "function") {
      unauthorizedHandler();
    }
    throw new Error("Session expired");
  }

  if (res.status === 403) {
    const action = options.action || "perform this action";
    showAccessDeniedToast(action);
    throw new Error("Forbidden");
  }

  const text = await res.text();
  let data;
  let parseFailed = false;
  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      parseFailed = true;
    }
  }
  if (!res.ok) {
    const msg =
      !parseFailed &&
      data !== undefined &&
      typeof data === "object" &&
      data !== null &&
      typeof data.error === "string"
        ? data.error
        : `Request failed: ${res.status}`;
    throw new Error(msg);
  }
  if (parseFailed) {
    throw new Error("Invalid JSON from server");
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

// --- Users (SuperUser and above) ---
export async function fetchUsers() {
  return apiCall("api/users");
}

/** @param {{ username: string, password: string, role: string, vesselTag?: string }} body */
export async function createUser(body) {
  return apiCall("api/users", {
    method: "POST",
    body: JSON.stringify(body),
    action: "create users",
  });
}

/** @param {number} id @param {{ password?: string, role?: string, vesselTag?: string }} changes */
export async function updateUser(id, changes) {
  return apiCall(`api/users/${id}`, {
    method: "PUT",
    body: JSON.stringify(changes),
    action: "change this user",
  });
}

export async function deleteUser(id) {
  return apiCall(`api/users/${id}`, {
    method: "DELETE",
    action: "delete this user",
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

export async function bulkCreateEvents(rows) {
  return apiCall("api/events/bulk", {
    method: "POST",
    body: JSON.stringify({ rows }),
    action: "import CSV data",
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
  let url = "api/events?confirm=DELETE";
  if (project) url += `&project=${encodeURIComponent(project)}`;
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

/**
 * Per-section clean counts (how many times each section was cleaned) and the ranking of
 * the most frequently cleaned section ranges.
 * @param {{ project?: string, start?: string, end?: string, limit?: number }} params
 */
export async function fetchSectionCleanCounts(params = {}) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") searchParams.append(key, value);
  }
  return apiCall(`api/stats/section-clean-counts?${searchParams}`);
}

export async function fetchFilteredStats(params) {
  const searchParams = new URLSearchParams(params);
  return apiCall(`api/stats/filter?${searchParams}`);
}

export async function fetchLastCleaned(params = {}) {
  const searchParams = new URLSearchParams(params);
  return apiCall(`api/last-cleaned${searchParams.toString() ? "?" + searchParams : ""}`);
}

/**
 * eBird (EB module) cleaning entries, newest first.
 * @param {{ project?: string }} [params]
 */
export async function fetchEbCleanings(params = {}) {
  const searchParams = new URLSearchParams(params);
  return apiCall(`api/eb-cleanings${searchParams.toString() ? "?" + searchParams : ""}`);
}

/** @param {{ streamerId: number, ebNumber: number, cleanedAt: string, projectNumber?: string|null }} entry */
export async function createEbCleaning(entry) {
  return apiCall("api/eb-cleanings", {
    method: "POST",
    body: JSON.stringify(entry),
    action: "add eBird cleaning dates",
  });
}

export async function deleteEbCleaning(id) {
  return apiCall(`api/eb-cleanings/${id}`, {
    method: "DELETE",
    action: "delete eBird cleaning dates",
  });
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

// --- Noise data ---

export async function getNoiseUploads(projectNumber) {
  if (!projectNumber) return [];
  return apiCall(`api/noise-data/uploads?project=${encodeURIComponent(projectNumber)}`);
}

export async function getNoiseData(uploadId, projectNumber) {
  const params = new URLSearchParams();
  if (uploadId) params.set("uploadId", uploadId);
  if (projectNumber) params.set("project", projectNumber);
  const query = params.toString();
  return apiCall(`api/noise-data${query ? "?" + query : ""}`);
}

export async function uploadNoiseData(payload) {
  return apiCall("api/noise-data", {
    method: "POST",
    body: JSON.stringify(payload),
    action: "upload noise data",
  });
}

/**
 * Update one or more fields on a noise upload batch (label, water speeds, sequence time).
 * @param {number} uploadId
 * @param {{ label?: string, waterSpeedStart?: number|null, waterSpeedEnd?: number|null, recordedAt?: string|null }} fields
 */
export async function updateNoiseUpload(uploadId, fields) {
  return apiCall(`api/noise-data/uploads/${uploadId}`, {
    method: "PATCH",
    body: JSON.stringify(fields),
    action: "update noise upload",
  });
}

export async function deleteNoiseUpload(uploadId) {
  return apiCall(`api/noise-data/uploads/${uploadId}`, {
    method: "DELETE",
    action: "delete noise upload",
  });
}

// --- Cleaning noise efficiency KPI ---

/**
 * Fetch cleaning noise efficiency KPI comparing two noise upload snapshots
 * for sections cleaned within the given date window.
 *
 * @param {{ project: string, uploadBeforeId?: number, uploadAfterId?: number, start?: string, end?: string }} opts
 */
export async function getCleaningNoiseEfficiency({ project, uploadBeforeId, uploadAfterId, start, end } = {}) {
  const params = new URLSearchParams({ project });
  if (uploadBeforeId != null) params.set("uploadBeforeId", uploadBeforeId);
  if (uploadAfterId != null) params.set("uploadAfterId", uploadAfterId);
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  return apiCall(`api/stats/cleaning-noise-efficiency?${params}`);
}

/**
 * Historical average RMS per streamer for each noise upload on a project.
 * @param {string} projectNumber
 */
export async function getNoiseRmsHistory(projectNumber) {
  return apiCall(
    `api/stats/noise-rms-history?project=${encodeURIComponent(projectNumber)}`
  );
}
