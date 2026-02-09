/**
 * Global state - single source of truth for the app.
 * All state reads/writes go through this module (direct exports or setters).
 */

export let config = null;
export let events = [];
export let selectedMethod = "rope";
export let projects = [];
export let selectedProjectFilter = null;

export let authToken = null;
export let currentUser = null;

export let dragState = {
  active: false,
  streamerId: null,
  start: null,
  end: null,
  cells: null,
};

export let isFinalizing = false;

export function setConfig(val) {
  config = val;
}

export function setEvents(val) {
  events = val;
}

export function setSelectedMethod(val) {
  selectedMethod = val;
}

export function setProjects(val) {
  projects = val;
}

export function setSelectedProjectFilter(val) {
  selectedProjectFilter = val;
}

export function setAuthToken(val) {
  authToken = val;
}

export function setCurrentUser(val) {
  currentUser = val;
}

export function setDragState(updates) {
  Object.assign(dragState, updates);
}

export function setIsFinalizing(val) {
  isFinalizing = val;
}

export function getActiveProject() {
  return projects.find((p) => p.isActive === true) || null;
}

export function getFilteredEvents() {
  let filtered = events;
  if (selectedProjectFilter) {
    filtered = filtered.filter(
      (e) => String(e.projectNumber) === selectedProjectFilter
    );
  }
  return filtered;
}
