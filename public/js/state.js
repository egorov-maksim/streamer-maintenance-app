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
  const active = projects.filter((p) => p.isActive === true);
  if (active.length === 0) return null;
  if (currentUser?.vesselTag) {
    const forVessel = active.find((p) => p.vesselTag === currentUser.vesselTag);
    if (forVessel) return forVessel;
  }
  return active[0] || null;
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
