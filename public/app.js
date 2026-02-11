/* =========================
   Streamer Maintenance App
   public/app.js
   ========================= */

import {
  config,
  setConfig,
  events,
  setEvents,
  projects,
  setProjects,
  selectedMethod,
  setSelectedMethod,
  selectedProjectFilter,
  setSelectedProjectFilter,
  dragState,
  setDragState,
  isFinalizing,
  setIsFinalizing,
  getActiveProject,
  getFilteredEvents,
} from "./js/state.js";
import * as API from "./js/api.js";
import {
  safeGet,
  setStatus,
  showErrorToast,
  showWarningToast,
  showSuccessToast,
  showAccessDeniedToast,
  formatDateTime,
} from "./js/ui.js";
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
  isSuperUser,
  isAdminOrAbove,
  isAdmin,
} from "./js/auth.js";
import { initModals } from "./js/modals.js";
import * as Projects from "./js/projects.js";
import * as StreamerUtils from "./js/streamer-utils.js";
import { computeStreamerTooltipData } from "./js/streamer-tooltip.js";
import { initPDFGeneration } from "./pdf-generator.js";

const sectionCount = StreamerUtils.sectionCount;
const eventDistance = StreamerUtils.eventDistance;
const ageBucket = StreamerUtils.ageBucket;
const fmtKm = StreamerUtils.fmtKm;
const getChannelRange = StreamerUtils.getChannelRange;
const formatAS = StreamerUtils.formatAS;
const formatSectionLabel = StreamerUtils.formatSectionLabel;
const formatEB = StreamerUtils.formatEB;
const getConfigForProject = StreamerUtils.getConfigForProject;
const getSectionsPerCableWithTail = StreamerUtils.getSectionsPerCableWithTail;
const getMaxSectionIndex = StreamerUtils.getMaxSectionIndex;
const validateStreamerAndSections = StreamerUtils.validateStreamerAndSections;

/* ------------ Heatmap ------------ */
/* ============================================================================
   SECTION HOVER TOOLTIP - Shows statistics for each section
   ============================================================================ */

let tooltip = null;

function createTooltip() {
  if (tooltip) return tooltip;
  tooltip = document.createElement('div');
  tooltip.className = 'section-tooltip';
  document.body.appendChild(tooltip);
  return tooltip;
}

// Shared helper to position floating tooltips near the cursor,
// while keeping them within the viewport. Assumes the element is
// already visible (so getBoundingClientRect returns meaningful size).
function positionTooltipNearCursor(element, event) {
  if (!element || !event) return;

  const baseX = event.clientX + 15;
  const baseY = event.clientY + 15;

  const rect = element.getBoundingClientRect();
  const x = baseX + rect.width > window.innerWidth ? baseX - rect.width - 30 : baseX;
  const y = baseY + rect.height > window.innerHeight ? baseY - rect.height - 30 : baseY;

  element.style.left = `${x}px`;
  element.style.top = `${y}px`;
}

function showSectionTooltip(e, streamerId, sectionIndex) {
  const tooltip = createTooltip();
  const streamerNum = streamerId;
  const sectionsPerCable = config.sectionsPerCable;

  // Determine if it's a tail section
  const isTail = sectionIndex >= sectionsPerCable;
  const relIndex = isTail ? sectionIndex - sectionsPerCable : sectionIndex;
  const sectionLabel = formatSectionLabel(relIndex, isTail ? 'tail' : 'active');

  // Get cleaning history for this specific section (by section_type and indices)
  const sectionEvents = events.filter(evt => {
    if (evt.streamerId !== streamerId) return false;
    if (isTail) {
      if (evt.sectionType !== 'tail') return false;
      return relIndex >= evt.sectionIndexStart && relIndex <= evt.sectionIndexEnd;
    }
    if (evt.sectionType !== 'active') return false;
    return sectionIndex >= evt.sectionIndexStart && sectionIndex <= evt.sectionIndexEnd;
  });

  const totalCleanings = sectionEvents.length;

  // Sort by date (newest first) — copy so we don't mutate before methodCounts
  const sortedByDate = [...sectionEvents].sort((a, b) =>
    new Date(b.cleanedAt) - new Date(a.cleanedAt)
  );

  // Get last cleaned date from sorted list
  let lastCleaned = null;
  let lastMethod = null;
  let daysSince = null;
  if (sortedByDate.length > 0) {
    lastCleaned = sortedByDate[0].cleanedAt;
    lastMethod = sortedByDate[0].cleaningMethod;
    daysSince = Math.floor((Date.now() - new Date(lastCleaned)) / (1000 * 60 * 60 * 24));
  }

  // Build tooltip HTML
  let html = `<div class="tooltip-header">Streamer ${streamerNum}, Section ${sectionLabel}</div>`;

  if (lastCleaned) {
    const ageClass = daysSince > 7 ? 'old' : '';
    html += `
      <div class="tooltip-row">
        <span class="tooltip-label">Last Cleaned</span>
      </div>
      <div class="tooltip-row" style="margin-top: 4px">
        <span class="tooltip-value">${lastMethod}</span>
      </div>
      <div class="tooltip-row">
        <span class="tooltip-value">${formatDateTime(lastCleaned)}</span>
      </div>
      <div class="tooltip-row">
        <span class="tooltip-age ${ageClass}">${daysSince} days ago</span>
      </div>
    `;
  } else {
    html += `
      <div class="tooltip-row">
        <span class="tooltip-label">Last Cleaned</span>
        <span class="tooltip-value" style="color: #9ca3af">Never</span>
      </div>
    `;
  }

  html += `
    <div class="tooltip-section">
      <div class="tooltip-row">
        <span class="tooltip-label">Total Times Cleaned</span>
        <span class="tooltip-value">${totalCleanings}</span>
      </div>
    </div>
  `;

  // Last 5 cleanings by date
  if (sortedByDate.length > 0) {
    const lastFive = sortedByDate.slice(0, 5);
    html += `<div class="tooltip-section"><div class="tooltip-row"><span class="tooltip-label">Last 5 cleanings</span></div>`;
    lastFive.forEach(evt => {
      const icon = getMethodIcon(evt.cleaningMethod);
      html += `
        <div class="tooltip-row">
          <span class="tooltip-value">${formatDateTime(evt.cleanedAt)}</span>
          <span class="tooltip-method">${icon} ${evt.cleaningMethod}</span>
        </div>
      `;
    });
    html += `</div>`;
  }

  tooltip.innerHTML = html;

  // Make visible, then position using shared helper
  tooltip.classList.add('show');
  positionTooltipNearCursor(tooltip, e);
}

function hideSectionTooltip() {
  if (tooltip) tooltip.classList.remove('show');
}

/* ------------ Attach Tooltip Listeners ------------ */

function attachTooltipListeners() {
  const cells = document.querySelectorAll('.hm-vcell:not(.hm-module):not(.hm-channel-ref):not(.hm-tail-ref)');
  cells.forEach(cell => {
    cell.addEventListener('mouseenter', (e) => {
      if (!dragState.active) {
        const streamerId = parseInt(cell.dataset.streamer);
        const section = parseInt(cell.dataset.section, 10);
        if (streamerId && !isNaN(section)) {
          showSectionTooltip(e, streamerId, section);
        }
      }
    });

    cell.addEventListener('mousemove', (e) => {
      if (!dragState.active) {
        const streamerId = parseInt(cell.dataset.streamer);
        const section = parseInt(cell.dataset.section, 10);
        if (streamerId && !isNaN(section)) {
          showSectionTooltip(e, streamerId, section);
        }
      }
    });

    cell.addEventListener('mouseleave', () => {
      if (!dragState.active) {
        hideSectionTooltip();
      }
    });
  });
}

function getMethodIcon(method) {
  const icons = {
    rope: '🪢',
    scraper: '🛠️',
    'scraper-rope': '🪢🛠️',
    scue: '⚙️',
    knife: '🔪'
  };
  return icons[method] || '🔧';
}

/* ------------ Project API (see js/projects.js) ------------ */


async function loadEvents() {
  let url = 'api/events';
  if (selectedProjectFilter) {
    url += `?project=${encodeURIComponent(selectedProjectFilter)}`;
  }
  setEvents(await API.apiCall(url));
}

async function addEvent() {
  const statusEl = safeGet("event-status");
  if (!isAdminOrAbove()) {
    setStatus(statusEl, "Admin access required", true);
    return;
  }

  try {
    const streamerNum = parseInt(safeGet("evt-streamer").value, 10);
    const startSection = parseInt(safeGet("evt-start").value, 10);
    const endSection = parseInt(safeGet("evt-end").value, 10);
    const method = safeGet("evt-method").value;
    const dateVal = safeGet("evt-date").value;
    const timeVal = safeGet("evt-time").value;

    if (!dateVal || !timeVal) {
      setStatus(statusEl, "Please select date and time", true);
      return;
    }

    // Use unified validation
    const validation = validateStreamerAndSections(streamerNum, startSection, endSection);
    if (!validation.valid) {
      setStatus(statusEl, validation.message, true);
      return;
    }

    const actualStart = Math.min(startSection, endSection) - 1;
    const actualEnd = Math.max(startSection, endSection) - 1;
    const datetimeIso = new Date(`${dateVal}T${timeVal}`).toISOString();
    const streamerId = streamerNum;

    const body = {
      streamerId: streamerId,
      sectionIndexStart: actualStart,
      sectionIndexEnd: actualEnd,
      cleaningMethod: method,
      cleanedAt: datetimeIso,
      cleaningCount: 1,
      vesselTag: config.vesselTag || 'TTN'
    };

    const res = await API.apiCall('api/events', {
      method: 'POST',
      body: JSON.stringify(body),
      action: 'add events'
    });

    const count = Array.isArray(res?.created) ? res.created.length : 1;
    setStatus(statusEl, count === 2 ? '✅ 2 events added (active + tail)' : '✅ Event added');
    await refreshEverything();
    await renderHeatmap();
    await refreshStatsFiltered();
  } catch (err) {
    console.error(err);
    setStatus(statusEl, 'Failed to add event', true);
  }
}

async function deleteEvent(id) {
  const evt = events.find(e => e.id === id);
  if (!evt) return;

  // Populate delete modal
  const streamerNum = evt.streamerId;

  safeGet('delete-event-id').value = evt.id;
  safeGet('delete-streamer-display').textContent = streamerNum;
  const sectionType = evt.sectionType || 'active';
  safeGet('delete-range-display').textContent = `${formatSectionLabel(evt.sectionIndexStart, sectionType)} – ${formatSectionLabel(evt.sectionIndexEnd, sectionType)}`;

  const ebRangeRaw = sectionType === 'tail'
    ? '—'
    : await API.getEBRange(evt.sectionIndexStart, evt.sectionIndexEnd);

  safeGet('delete-eb-display').textContent = sectionType === 'tail' ? '—' : ebRangeRaw;
  safeGet('delete-method-display').textContent = evt.cleaningMethod;
  safeGet('delete-date-display').textContent = formatDateTime(evt.cleanedAt);
  safeGet('delete-distance-display').textContent = `${eventDistance(evt)} m`;

  safeGet('delete-modal').classList.add('show');
}

function closeDeleteModal() {
  safeGet('delete-modal').classList.remove('show');
}

async function confirmDeleteEvent() {
  if (!isAdminOrAbove()) {
    showAccessDeniedToast('delete events');
    return;
  }
  
  const id = parseInt(safeGet('delete-event-id').value);
  
  try {
    await API.apiCall(`api/events/${id}`, {
      method: 'DELETE',
      action: 'delete events'
    });

    closeDeleteModal();
    await refreshEverything();
    await renderHeatmap();
    await refreshStatsFiltered();
  } catch (err) {
    console.error(err);
    showErrorToast('Delete Failed', 'Failed to delete event. Please try again.');
  }
}

function editEventPrompt(id) {
  const evt = events.find(e => e.id === id);
  if (!evt) return;

  const streamerNum = evt.streamerId;

  safeGet('edit-event-id').value = evt.id;
  safeGet('edit-streamer').value = streamerNum;
  safeGet('edit-start').value = evt.sectionIndexStart + 1;
  safeGet('edit-end').value = evt.sectionIndexEnd + 1;
  safeGet('edit-method').value = evt.cleaningMethod;
  safeGet("edit-project-number").value = evt.projectNumber || "";
  safeGet("edit-vessel-tag").value = evt.vesselTag || "TTN";

  const dateObj = new Date(evt.cleanedAt);
  safeGet('edit-date').value = dateObj.toISOString().split('T')[0];
  safeGet('edit-time').value = dateObj.toTimeString().slice(0, 5);

  safeGet('edit-modal').classList.add('show');
}

function closeEditModal() {
  safeGet('edit-modal').classList.remove('show');
}

async function saveEditedEvent() {
  const id = parseInt(safeGet('edit-event-id').value);
  const streamerNum = parseInt(safeGet('edit-streamer').value);
  const startSection = parseInt(safeGet('edit-start').value);
  const endSection = parseInt(safeGet('edit-end').value);
  const method = safeGet('edit-method').value;
  const dateVal = safeGet('edit-date').value;
  const timeVal = safeGet('edit-time').value;
  const projectNumber = safeGet("edit-project-number").value || null;
  const vesselTag = safeGet("edit-vessel-tag").value || "TTN";
  // ✅ ADD VALIDATION WITH PROJECT AWARENESS
  const validation = validateStreamerAndSections(
    streamerNum, 
    startSection, 
    endSection, 
    projectNumber  // ← Use the event's project config!
  );
  
  if (!validation.valid) {
    showErrorToast("Out of Range", validation.message);
    return;
  }

  const actualStart = Math.min(startSection, endSection) - 1;
  const actualEnd = Math.max(startSection, endSection) - 1;
  const streamerId = streamerNum;
  const datetimeIso = new Date(`${dateVal}T${timeVal}`).toISOString();

  const body = {
    streamerId: streamerId,
    sectionIndexStart: actualStart,
    sectionIndexEnd: actualEnd,
    cleaningMethod: method,
    cleanedAt: datetimeIso,
    cleaningCount: 1,
    projectNumber: projectNumber,
    vesselTag: vesselTag,
  };

  await updateEvent(id, body);
  closeEditModal();
}

async function updateEvent(id, body) {
  if (!isAdminOrAbove()) {
    showAccessDeniedToast('edit events');
    return;
  }
  
  try {
    await API.apiCall(`api/events/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
      action: 'edit events'
    });

    await refreshEverything();
    await renderHeatmap();
    await refreshStatsFiltered();
  } catch (err) {
    console.error(err);
    showErrorToast('Update Failed', 'Failed to update event. Please try again.');
  }
}

// Show the clear all modal
function showClearAllModal() {
  if (!isSuperUser()) {
    showAccessDeniedToast('clear all events');
    return;
  }
  
  const activeProject = projects.find(p => p.isActive === true);
  const modal = safeGet('clear-all-modal');
  const scopeEl = safeGet('clear-all-scope');
  const countEl = safeGet('clear-all-count');
  const warningMsg = safeGet('clear-all-warning-message');
  const confirmInput = safeGet('clear-all-confirm-input');
  const confirmBtn = safeGet('btn-clear-all-confirm');
  
  if (!modal) return;
  
  // Set scope and count
  if (activeProject) {
    scopeEl.textContent = `Project: ${activeProject.projectNumber}`;
    const projectEvents = events.filter(e => e.projectNumber === activeProject.projectNumber);
    countEl.textContent = projectEvents.length;
    warningMsg.textContent = `All cleaning events for project ${activeProject.projectNumber} will be permanently deleted.`;
  } else {
    scopeEl.textContent = 'All Projects (Global)';
    countEl.textContent = events.length;
    warningMsg.textContent = 'All cleaning events from ALL projects will be permanently deleted from the database.';
  }
  
  // Reset input and disable button
  confirmInput.value = '';
  confirmBtn.disabled = true;
  
  
  
  modal.classList.add('show');
  
  // Focus the input
  setTimeout(() => confirmInput.focus(), 100);
}

// Close the modal
function closeClearAllModal() {
  const modal = safeGet('clear-all-modal');
  const confirmInput = safeGet('clear-all-confirm-input');
  
  if (modal) modal.classList.remove('show');
  if (confirmInput) confirmInput.value = '';
}

// Actually clear the events
async function confirmClearAllEvents() {
  const activeProject = projects.find(p => p.isActive === true);
  const confirmInput = safeGet('clear-all-confirm-input');
  
  if (confirmInput.value.trim().toUpperCase() !== 'DELETE') {
    return;
  }
  
  try {
    let url = '/api/events';
    if (activeProject) {
      url += `?project=${encodeURIComponent(activeProject.projectNumber)}`;
    }
    
    await API.apiCall(url, {
      method: 'DELETE',
      action: 'clear all events'
    });
    
    closeClearAllModal();
    
    if (activeProject) {
      showSuccessToast('Events Cleared', `All events deleted from project ${activeProject.projectNumber}.`);
    } else {
      showSuccessToast('All Events Cleared', 'All cleaning events have been permanently deleted.');
    }
    
    await refreshEverything();
    await renderHeatmap();
    await refreshStatsFiltered();
  } catch (err) {
    console.error(err);
    showErrorToast('Clear Failed', 'Failed to clear events. Please try again.');
  }
}

/* ------------ CSV Import/Export ------------ */

function exportCsv() {
  if (!events.length) {
    showWarningToast('No Data', 'No events available to export.');
    return;
  }

  const header = 'Streamer Number,Section Type,First Section,Last Section,Cleaning Method,Date & Time,Project Number,Vessel Tag,Added By';
  const rows = [header];

  events.forEach(evt => {
    const streamerNum = evt.streamerId;
    const sectionType = evt.sectionType || 'active';
    const startSection = evt.sectionIndexStart + 1;
    const endSection = evt.sectionIndexEnd + 1;
    const dateStr = new Date(evt.cleanedAt).toISOString();
    const projectNum = evt.projectNumber || '';
    const vesselTag = evt.vesselTag || 'TTN';
    const addedBy = (evt.addedByUsertag || '').replace(/"/g, '""');
    rows.push(`${streamerNum},${sectionType},${startSection},${endSection},${evt.cleaningMethod},"${dateStr}","${projectNum}","${vesselTag}","${addedBy}"`);
  });

  const csv = rows.join('\n');
  
  // Create a Blob from the CSV string
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  
  // Create a temporary download link
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  // Generate filename with current date and project if filtered
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const projectSuffix = selectedProjectFilter ? `-${selectedProjectFilter}` : '';
  const filename = `streamer-cleaning-events${projectSuffix}-${dateStr}.csv`;
  
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  
  // Trigger download
  document.body.appendChild(link);
  link.click();
  
  // Cleanup
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function importCsv() {
  const input = safeGet('csv-input');
  input.value = '';
  input.click();
}

function parseCsvLine(line) {
  const regex = /,(?=(?:(?:[^"]*"){2})*[^"]*$)/;
  return line.split(regex).map(field => field.trim().replace(/^"|"$/g, ''));
}

async function handleCsvFile(file) {
  if (!isAdminOrAbove()) {
    showAccessDeniedToast('import CSV data');
    return;
  }
  
  const reader = new FileReader();

  reader.onload = async (e) => {
    const content = e.target.result;
    const lines = content.split('\n').filter(l => l.trim());

    if (lines.length < 2) {
      showErrorToast('Invalid File', 'CSV file seems empty or invalid.');
      return;
    }

    const dataLines = lines.slice(1);
    let successCount = 0;
    let errorCount = 0;

    const hasSectionTypeColumn = dataLines.length > 0 && (() => {
      const firstParts = parseCsvLine(dataLines[0].trim());
      return firstParts.length >= 8 && (firstParts[1] === 'active' || firstParts[1] === 'tail');
    })();

    for (let i = 0; i < dataLines.length; i++) {
      const line = dataLines[i].trim();
      if (!line) continue;

      const parts = parseCsvLine(line);
      let streamerNum, startSection, endSection, method, dateTimeStr, projectNumber, vesselTag, sectionType;
      if (hasSectionTypeColumn && parts.length >= 8 && (parts[1] === 'active' || parts[1] === 'tail')) {
        streamerNum = parseInt(parts[0], 10);
        sectionType = parts[1];
        startSection = parseInt(parts[2], 10);
        endSection = parseInt(parts[3], 10);
        method = parts[4];
        dateTimeStr = parts[5].replace(/"/g, '').trim();
        projectNumber = parts[6] ? parts[6].replace(/"/g, '').trim() : null;
        vesselTag = parts[7] ? parts[7].replace(/"/g, '').trim() : 'TTN';
      } else if (parts.length >= 5) {
        streamerNum = parseInt(parts[0], 10);
        startSection = parseInt(parts[1], 10);
        endSection = parseInt(parts[2], 10);
        method = parts[3];
        dateTimeStr = parts[4].replace(/"/g, '').trim();
        projectNumber = parts[5] ? parts[5].replace(/"/g, '').trim() : null;
        vesselTag = parts[6] ? parts[6].replace(/"/g, '').trim() : 'TTN';
        sectionType = null;
      } else {
        errorCount++;
        continue;
      }

      if (
        isNaN(streamerNum) ||
        isNaN(startSection) ||
        isNaN(endSection) ||
        streamerNum < 1 ||
        streamerNum > (config.numCables + 1)
      ) {
        errorCount++;
        continue;
      }

      const dateObj = new Date(dateTimeStr);
      if (isNaN(dateObj.getTime())) {
        errorCount++;
        continue;
      }

      const actualStart = Math.min(startSection, endSection) - 1;
      const actualEnd = Math.max(startSection, endSection) - 1;

      const body = {
        streamerId: streamerNum,
        sectionIndexStart: actualStart,
        sectionIndexEnd: actualEnd,
        cleaningMethod: method,
        cleanedAt: dateObj.toISOString(),
        cleaningCount: 1,
        projectNumber: projectNumber,
        vesselTag: vesselTag,
      };
      if (sectionType) body.sectionType = sectionType;

      try {
        await API.apiCall('api/events', {
          method: 'POST',
          body: JSON.stringify(body),
          action: 'import CSV data'
        });
        successCount++;
      } catch {
        errorCount++;
      }
    }

    await refreshEverything();
    await renderHeatmap();
    await refreshStatsFiltered();

    if (errorCount === 0) {
      showSuccessToast('Import Complete', `${successCount} events imported successfully.`);
    } else {
      showWarningToast('Import Complete', `${successCount} events imported, ${errorCount} errors occurred.`);
    }
  };

  reader.readAsText(file);
}

/* ------------ Log rendering ------------ */

async function renderLog() {
  const tbody = safeGet('log-body');
  if (!tbody) return;

  tbody.innerHTML = '';
  
  const isAdminUser = isAdminOrAbove();

  // Fetch EB ranges for active events only; tail shows "—"
  const ebRangePromises = events.map(evt =>
    evt.sectionType === 'tail'
      ? Promise.resolve('—')
      : API.getEBRange(evt.sectionIndexStart, evt.sectionIndexEnd)
  );
  const ebRanges = await Promise.all(ebRangePromises);

  events.forEach((evt, idx) => {
    const tr = document.createElement('tr');
    const streamerNum = evt.streamerId;
    const sectionType = evt.sectionType || 'active';
    const rangeLabel = `${formatSectionLabel(evt.sectionIndexEnd, sectionType)}–${formatSectionLabel(evt.sectionIndexStart, sectionType)}`;
    const ebRange = ebRanges[idx];
    const distance = eventDistance(evt);
    const projectDisplay = evt.projectNumber || '<span style="color:#9ca3af">—</span>';
    const vesselDisplay = evt.vesselTag || 'TTN';
    const addedByDisplay = evt.addedByUsertag || '—';

    const actionButtons = isAdminUser 
      ? `<button class="btn btn-outline btn-edit" data-id="${evt.id}">✏️</button>
         <button class="btn btn-outline btn-delete" data-id="${evt.id}">🗑️</button>`
      : '<span class="view-only-badge">View Only</span>';

    tr.innerHTML = `
      <td>${formatDateTime(evt.cleanedAt)}</td>
      <td>${projectDisplay}</td>
      <td>${vesselDisplay}</td>
      <td>${addedByDisplay}</td>
      <td>Streamer ${streamerNum}</td>
      <td>${rangeLabel}</td>
      <td>${ebRange}</td>
      <td>${distance} m</td>
      <td>${evt.cleaningMethod}</td>
      <td>${actionButtons}</td>
    `;
    tbody.appendChild(tr);
  });

  // Add event listeners for edit/delete buttons (only if admin)
  if (isAdminUser) {
    document.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => editEventPrompt(parseInt(btn.dataset.id)));
    });

    document.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteEvent(parseInt(btn.dataset.id)));
    });
  }
}

/* ------------ Method selection ------------ */

function selectMethod(method) {
  setSelectedMethod(method);
  document.querySelectorAll('.method-tile').forEach(tile => {
    tile.classList.toggle('active', tile.dataset.method === method);
  });
}

/* ------------ Alerts ------------ */

async function renderAlerts() {
  const container = safeGet('alerts-container');
  if (!container) return;

  container.innerHTML = '';

  try {
    let url = 'api/last-cleaned';
    if (selectedProjectFilter) {
      url += `?project=${encodeURIComponent(selectedProjectFilter)}`;
    }
    const data = await API.apiCall(url);
    const lastCleaned = data.lastCleaned;

    let critical = 0;
    let warning = 0;
    let uncleaned = 0;

    Object.keys(lastCleaned).forEach(streamerId => {
      const sections = lastCleaned[streamerId];
      sections.forEach(date => {
        if (!date) {
          uncleaned++;
          return;
        }
        const days = Math.floor((Date.now() - new Date(date)) / (1000 * 60 * 60 * 24));
        if (days >= 14) critical++;
        else if (days >= 10) warning++;
      });
    });

    if (critical > 0) {
      const alert = document.createElement('div');
      alert.className = 'alert alert-critical';
      alert.innerHTML = `
        <div class="alert-icon">🚨</div>
        <div>
          <div class="alert-title">${critical} sections not cleaned in 14+ days</div>
          <div class="alert-sub">Critical Maintenance Required</div>
        </div>
      `;
      container.appendChild(alert);
    }

    if (warning > 0) {
      const alert = document.createElement('div');
      alert.className = 'alert alert-warning';
      alert.innerHTML = `
        <div class="alert-icon">⚠️</div>
        <div>
          <div class="alert-title">${warning} sections not cleaned in 10–13 days</div>
          <div class="alert-sub">Maintenance Warning</div>
        </div>
      `;
      container.appendChild(alert);
    }

    if (uncleaned > 0) {
      const alert = document.createElement('div');
      alert.className = 'alert alert-uncleaned';
      alert.innerHTML = `
        <div class="alert-icon">ℹ️</div>
        <div>
          <div class="alert-title">${uncleaned} sections have never been cleaned</div>
          <div class="alert-sub">Uncleaned Sections</div>
        </div>
      `;
      container.appendChild(alert);
    }
  } catch (err) {
    console.error(err);
  }
}

/* ------------ Streamer Cards (UPDATED WITH DATE FILTERING) ------------ */

async function renderStreamerCards(startDate = null, endDate = null) {
  const container = safeGet('streamer-cards-container');
  if (!container) return;

  container.innerHTML = '';

  try {
    // Add project filter to API call
    let url = 'api/last-cleaned';
    if (selectedProjectFilter) {
      url += `?project=${encodeURIComponent(selectedProjectFilter)}`;
    }
    const data = await API.apiCall(url);
    const lastCleaned = data.lastCleaned;

    const cableCount = config.numCables;
    const sectionsPerCable = config.sectionsPerCable;
    const tailSections = config.useRopeForTail ? 0 : 5;
    const totalPerCable = sectionsPerCable + tailSections;

    for (let streamerId = 1; streamerId <= cableCount; streamerId++) {
      const sections = lastCleaned[streamerId] || [];

      // Filter events by date range if provided
      let filteredEvents = events.filter(evt => evt.streamerId === streamerId);

      if (startDate || endDate) {
        filteredEvents = filteredEvents.filter(evt => {
          const evtDate = new Date(evt.cleanedAt).toISOString().split('T')[0];
          if (startDate && evtDate < startDate) return false;
          if (endDate && evtDate > endDate) return false;
          return true;
        });
      }

      // Calculate coverage based on filtered events
      let cleanedCount = 0;
      let totalCleanings = 0;

      // Count total cleaning events for this cable
      totalCleanings = filteredEvents.length;

      sections.forEach((date, idx) => {
        if (!date) return; // Never cleaned
        
        // If filters applied, check if lastCleaned date is in range  
        if (startDate || endDate) {
          const sectionDate = new Date(date).toISOString().split('T')[0];
          if (startDate && sectionDate < startDate) return;
          if (endDate && sectionDate > endDate) return;
        }
        
        // Count this cleaned section (either passed filter checks or no filters)
        cleanedCount++;
      });

      const coverage = totalPerCable > 0 ? Math.round((cleanedCount / totalPerCable) * 100) : 0;
            // Count total times all sections were cleaned
      let totalSectionCleanings = 0;

      filteredEvents.forEach(evt => {
        // Each event covers a range of sections, count them all
        totalSectionCleanings += (evt.sectionIndexEnd - evt.sectionIndexStart + 1);
      });

      // Average = total section cleanings / total available sections
      const avgCleanings = totalPerCable > 0 ? (totalSectionCleanings / totalPerCable).toFixed(1) : 0;

      const card = document.createElement('div');
      card.className = 'streamer-card';
      card.innerHTML = `
        <div class="streamer-card-header">
          <div class="streamer-card-title">Streamer ${streamerId}</div>
          <div class="streamer-card-percent">${coverage}%</div>
        </div>
        <div class="streamer-card-detail">
          ${cleanedCount}/${totalPerCable} sections · ${avgCleanings} avg cleanings
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${coverage}%"></div>
        </div>
      `;
      container.appendChild(card);
    }
  } catch (err) {
    console.error(err);
  }
}

/* ------------ Heat-map rendering ------------ */

async function renderHeatmap() {
  const container = safeGet('heatmap-container');
  if (!container) return;

  container.innerHTML = '';

  try {
    let url = 'api/last-cleaned';
    if (selectedProjectFilter) {
      url += `?project=${encodeURIComponent(selectedProjectFilter)}`;
    }
    const data = await API.apiCall(url);
    const lastCleaned = data.lastCleaned;

    let deployments = {};
    const activeProject = projects.find(p => p.isActive);
    if (activeProject) {
      try {
        deployments = await API.apiCall(`/api/projects/${activeProject.id}/streamer-deployments`);
      } catch (error) {
        // Deployment data optional for heatmap; log for debugging if needed
        console.debug('Streamer deployments fetch skipped:', error?.message ?? error);
      }
    }

    const sectionsPerCable = config.sectionsPerCable;
    const cableCount = config.numCables;
    const moduleFreq = config.moduleFrequency;
    const channelsPerSection = config.channelsPerSection;
    const useTailSections = !config.useRopeForTail;
    const tailSections = useTailSections ? 5 : 0;

    // Calculate total rows = sections + modules + tail sections
    const modulesCount = Math.floor(sectionsPerCable / moduleFreq);
    const totalRows = sectionsPerCable + modulesCount + tailSections;

    // Wrapper for horizontal scroll
    const wrapper = document.createElement('div');
    wrapper.className = 'hm-grid-vertical';

    // Channel reference column (CH)
    const channelCol = document.createElement('div');
    channelCol.className = 'hm-col hm-col-channel';
    channelCol.style.gridTemplateRows = `36px repeat(${totalRows}, 32px)`;

    const channelLabel = document.createElement('div');
    channelLabel.className = 'hm-col-label hm-col-label-channel';
    channelLabel.textContent = 'CH';
    channelCol.appendChild(channelLabel);

    let rowIndex = 0;
    for (let s = 0; s < sectionsPerCable; s++) {
      // Add section channel info
      const channelCell = document.createElement('div');
      channelCell.className = 'hm-vcell hm-channel-ref';
      const startCh = s * channelsPerSection + 1;
      const endCh = startCh + channelsPerSection - 1;
      channelCell.textContent = `${startCh}-${endCh}`;
      channelCell.title = `Channels ${startCh}–${endCh}`;
      channelCol.appendChild(channelCell);
      rowIndex++;

      // Module positioning
      const sectionNumber = s + 1;
      const isFirstModule = sectionNumber === 1;
      const isRegularModule = sectionNumber > 1 && (sectionNumber - 1) % moduleFreq === 0;
      const isLastModule = sectionNumber === sectionsPerCable;

      if (isFirstModule || isRegularModule || isLastModule) {
        const moduleChannelCell = document.createElement('div');
        moduleChannelCell.className = 'hm-vcell hm-module-row';
        moduleChannelCell.textContent = '—';
        channelCol.appendChild(moduleChannelCell);
        rowIndex++;
      }
    }

    // Add tail section channel references
    for (let t = 0; t < tailSections; t++) {
      const tailChannelCell = document.createElement('div');
      tailChannelCell.className = 'hm-vcell hm-channel-ref hm-tail-ref';
      tailChannelCell.textContent = '---';
      tailChannelCell.title = 'Tail Section (no channels)';
      channelCol.appendChild(tailChannelCell);
    }

    wrapper.appendChild(channelCol);

    // Render each streamer column
    for (let streamerId = cableCount; streamerId >= 1; streamerId--) {
      const sections = lastCleaned[streamerId] || [];
      const deployment = deployments[streamerId] || {};

      const col = document.createElement('div');
      col.className = 'hm-col';
      col.style.gridTemplateRows = `36px repeat(${totalRows}, 32px)`;

      // Streamer header (with deployment data for tooltip)
      const label = document.createElement('div');
      label.className = 'hm-col-label hm-header';
      label.textContent = `S${streamerId}`;
      label.dataset.streamerId = streamerId;
      label.dataset.deploymentDate = deployment.deploymentDate || '';
      label.dataset.isCoated = deployment.isCoated === true ? 'true' : deployment.isCoated === false ? 'false' : 'unknown';
      col.appendChild(label);

      rowIndex = 0;
      let moduleNum = 1;

      for (let s = 0; s < sectionsPerCable; s++) {
        // Active section cell
        const cell = document.createElement('div');
        cell.className = 'hm-vcell hm-active-section';
        cell.dataset.streamer = streamerId;
        cell.dataset.section = s;
        cell.textContent = s + 1;

        const lastDate = sections[s];
        let days = null;
        if (lastDate) {
          days = Math.floor((Date.now() - new Date(lastDate)) / (1000 * 60 * 60 * 24));
        }
        const bucket = ageBucket(days);
        cell.dataset.age = bucket;

        col.appendChild(cell);
        rowIndex++;

        // Module positioning
        const sectionNumber = s + 1;
        const isFirstModule = sectionNumber === 1;
        const isRegularModule = sectionNumber > 1 && (sectionNumber - 1) % moduleFreq === 0;
        const isLastModule = sectionNumber === sectionsPerCable;

        if (isFirstModule || isRegularModule || isLastModule) {
          const moduleCell = document.createElement('div');
          moduleCell.className = 'hm-vcell hm-module';
          moduleCell.textContent = `EB${String(moduleNum).padStart(2, '0')}`;
          moduleCell.title = `Equipment Box ${String(moduleNum).padStart(2, '0')}`;
          col.appendChild(moduleCell);
          moduleNum++;
          rowIndex++;
        }
      }

      // Add tail sections if configured
      for (let t = 0; t < tailSections; t++) {
        const tailIdx = sectionsPerCable + t;
        const tailCell = document.createElement('div');
        tailCell.className = 'hm-vcell hm-tail-section';
        tailCell.dataset.streamer = streamerId;
        tailCell.dataset.section = tailIdx;
        tailCell.dataset.isTail = 'true';
        tailCell.textContent = formatSectionLabel(t, 'tail');

        const lastDate = sections[tailIdx] || null;
        let days = null;
        let bucket = 'never';
        if (lastDate) {
          days = Math.floor((Date.now() - new Date(lastDate)) / (1000 * 60 * 60 * 24));
          bucket = ageBucket(days);
        }
        tailCell.dataset.age = bucket;

        col.appendChild(tailCell);
      }

      wrapper.appendChild(col);
    }

    // Scroll listener
    function attachScrollListener() {
      const container = safeGet('heatmap-container');
      let scrollTimeout;
      container.addEventListener('scroll', () => {
        container.classList.add('scrolling');
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
          container.classList.remove('scrolling');
        }, 150); // Fade back after 150ms idle
      }, { passive: true });
    }

    attachScrollListener(); // Call once after heatmap rendered

    container.appendChild(wrapper);
    attachDragListeners();
    attachTooltipListeners();
    attachStreamerHeaderTooltips(wrapper, lastCleaned, deployments);
  } catch (err) {
    console.error(err);
  }
}

/**
 * Single floating tooltip for heatmap streamer column headers.
 * Shows deployment date, days from deployment to first scraping, coating, total cleanings, last cleaned.
 */
function attachStreamerHeaderTooltips(wrapper, lastCleaned, deployments) {
  let tooltipEl = document.getElementById('streamer-header-tooltip');
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'streamer-header-tooltip';
    tooltipEl.className = 'streamer-header-tooltip';
    tooltipEl.style.display = 'none';
    document.body.appendChild(tooltipEl);
  }

  const labels = wrapper.querySelectorAll('.hm-col-label.hm-header[data-streamer-id]');
  labels.forEach(label => {
    const streamerId = parseInt(label.dataset.streamerId, 10);
    if (!streamerId) return;

    const show = (e) => {
      // Use active project's events so "first scraping" matches deployment (same project); fallback to filtered events if no active project
      const activeProject = getActiveProject();
      const baseEvents = activeProject
        ? events.filter(ev => String(ev.projectNumber) === String(activeProject.projectNumber))
        : getFilteredEvents();
      const streamerEvents = baseEvents.filter(ev => ev.streamerId === streamerId);

      const data = computeStreamerTooltipData(streamerId, { deployments, lastCleaned, streamerEvents });
      const { daysToFirstScraping, lastCleanedDate, coatingLabel } = data;
      const deployment = data.deployment;

      let html = `<div class="streamer-tooltip-title">Streamer ${streamerId}</div>`;
      if (deployment.deploymentDate) {
        html += `<div class="streamer-tooltip-row">📅 Deployed: ${new Date(deployment.deploymentDate).toLocaleDateString()}</div>`;
        if (daysToFirstScraping !== null) {
          html += `<div class="streamer-tooltip-row">🌊 Days to first scraping: ${daysToFirstScraping}</div>`;
        } else if (streamerEvents.length === 0) {
          html += `<div class="streamer-tooltip-row">🌊 Days to first scraping: No scraping yet</div>`;
        } else {
          html += `<div class="streamer-tooltip-row">🌊 Days to first scraping: —</div>`;
        }
      } else {
        html += `<div class="streamer-tooltip-row">📅 No deployment date</div>`;
      }
      html += `<div class="streamer-tooltip-row">🛡️ Coating: ${coatingLabel}</div>`;
      html += `<div class="streamer-tooltip-row">🧹 Total cleanings: ${streamerEvents.length}</div>`;
      if (lastCleanedDate) {
        html += `<div class="streamer-tooltip-row">✅ Last cleaned: ${new Date(lastCleanedDate).toLocaleDateString()}</div>`;
      } else {
        html += `<div class="streamer-tooltip-row">✅ Last cleaned: Never</div>`;
      }

      tooltipEl.innerHTML = html;
      tooltipEl.style.display = 'block';
      // Use the same positioning logic as section tooltips
      positionTooltipNearCursor(tooltipEl, e);
    };

    const move = (e) => {
      if (tooltipEl.style.display === 'block') {
        positionTooltipNearCursor(tooltipEl, e);
      }
    };

    const hide = () => {
      tooltipEl.style.display = 'none';
    };

    label.addEventListener('mouseenter', show);
    label.addEventListener('mousemove', move);
    label.addEventListener('mouseleave', hide);
  });
}

/* ------------ Drag-to-select ------------ */

function attachDragListeners() {
  const cells = document.querySelectorAll('.hm-vcell:not(.hm-module)');

  cells.forEach(cell => {
    cell.addEventListener('mousedown', (e) => {
      e.preventDefault();
      hideSectionTooltip();
      const streamerId = parseInt(cell.dataset.streamer);
      const section = parseInt(cell.dataset.section, 10);

      if (!streamerId || isNaN(section)) return;

      dragState.active = true;
      dragState.streamerId = streamerId;
      dragState.start = section;
      dragState.end = section;
      dragState.cells = Array.from(cells);
      updateDragHighlight();
    });

    cell.addEventListener('mouseenter', () => {
      if (!dragState.active) return;

      const streamerId = parseInt(cell.dataset.streamer);
      const section = parseInt(cell.dataset.section, 10);

      if (streamerId === dragState.streamerId && !isNaN(section)) {
        dragState.end = section;
        updateDragHighlight();
      }
    });
  });

  document.addEventListener('mouseup', () => {
    if (dragState.active) {
      showConfirmationModal();
    }
  });
}

function updateDragHighlight() {
  if (!dragState.cells) return;

  const { streamerId, start, end } = dragState;
  const min = Math.min(start, end);
  const max = Math.max(start, end);

  dragState.cells.forEach(cell => {
    const cellStreamer = parseInt(cell.dataset.streamer);
    const cellSection = parseInt(cell.dataset.section, 10);
    const inRange = cellStreamer === streamerId && cellSection >= min && cellSection <= max;
    cell.classList.toggle('dragging', inRange);
  });
}

function clearDragState() {
  if (dragState.cells) {
    dragState.cells.forEach(cell => {
      cell.classList.remove('dragging');
      cell.classList.remove('saved');
    });
  }

  setDragState({
    active: false,
    streamerId: null,
    start: null,
    end: null,
    cells: null,
  });
}

/* ------------ Modal Confirmation ------------ */

let confirmationModalTailOnly = false;

function showConfirmationModal() {
  if (!dragState.active || isFinalizing) return;
  dragState.active = false;
  
  const { streamerId, start, end } = dragState;
  const sectionsPerCable = config.sectionsPerCable ?? 107;
  const min = Math.min(start, end);
  const max = Math.max(start, end);
  const streamerNum = streamerId;
  const streamerInput = safeGet('modal-streamer');
  const startInput = safeGet('modal-start');
  const endInput = safeGet('modal-end');
  const methodSelect = safeGet('modal-method');
  
  const totalSections = getSectionsPerCableWithTail(config);
  const tailOnly = min >= sectionsPerCable;

  streamerInput.max = config.numCables;
  startInput.min = 1;
  endInput.min = 1;
  if (tailOnly) {
    confirmationModalTailOnly = true;
    startInput.max = 5;
    endInput.max = 5;
    startInput.value = min - sectionsPerCable + 1;  // Tail 1-based 1..5
    endInput.value = max - sectionsPerCable + 1;
    safeGet('modal-first-section-label').childNodes[0].textContent = 'First Tail Section ';
    safeGet('modal-last-section-label').childNodes[0].textContent = 'Last Tail Section ';
  } else {
    confirmationModalTailOnly = false;
    startInput.max = totalSections;
    endInput.max = totalSections;
    startInput.value = min + 1;  // Global 1-based
    endInput.value = max + 1;
    safeGet('modal-first-section-label').childNodes[0].textContent = 'First Section ';
    safeGet('modal-last-section-label').childNodes[0].textContent = 'Last Section ';
  }
  streamerInput.value = streamerNum;
  methodSelect.value = selectedMethod;

  const now = new Date();
  safeGet('modal-date').value = now.toISOString().split('T')[0];
  safeGet('modal-time').value = now.toTimeString().slice(0, 5);

  updateModalSummary();
  safeGet('confirmation-modal').classList.add('show');
  
  // Update summary when inputs change
  streamerInput.oninput = updateModalSummary;
  startInput.oninput = updateModalSummary;
  endInput.oninput = updateModalSummary;
  methodSelect.oninput = updateModalSummary;
}

function updateModalSummary() {
  const sectionsPerCable = config.sectionsPerCable ?? 107;
  let min;
  let max;
  if (confirmationModalTailOnly) {
    const startVal = parseInt(safeGet('modal-start').value || 1, 10) - 1;
    const endVal = parseInt(safeGet('modal-end').value || 1, 10) - 1;
    min = Math.min(startVal, endVal) + sectionsPerCable;
    max = Math.max(startVal, endVal) + sectionsPerCable;
  } else {
    const start = parseInt(safeGet('modal-start').value || 1, 10) - 1;
    const end = parseInt(safeGet('modal-end').value || 1, 10) - 1;
    min = Math.min(start, end);
    max = Math.max(start, end);
  }
  const labelFor = (s) =>
    s >= sectionsPerCable
      ? formatSectionLabel(s - sectionsPerCable, 'tail')
      : formatSectionLabel(s, 'active');
  const rangeText = `${labelFor(min)} – ${labelFor(max)}`;
  const channelStart = min < sectionsPerCable ? getChannelRange(min).split('–')[0] : '—';
  const channelEnd = max < sectionsPerCable ? getChannelRange(max).split('–')[1] : '—';
  const channelText = `${channelStart} – ${channelEnd}`;
  const distance = (max - min + 1) * config.sectionLength;

  safeGet('modal-summary-range').textContent = rangeText;
  safeGet('modal-summary-channels').textContent = channelText;
  safeGet('modal-summary-distance').textContent = `${distance} m`;
}

function closeConfirmationModal() {
  confirmationModalTailOnly = false;
  safeGet('confirmation-modal').classList.remove('show');
  clearDragState();
  setIsFinalizing(false);
}

async function confirmCleaning() {
  if (isFinalizing) return;
  if (!isAdminOrAbove()) {
    showAccessDeniedToast('add cleaning events');
    closeConfirmationModal();
    return;
  }
  
  setIsFinalizing(true);
  
  const streamerNum = parseInt(safeGet('modal-streamer').value, 10);
  const sectionsPerCable = config.sectionsPerCable ?? 107;
  let startSection = parseInt(safeGet('modal-start').value, 10);
  let endSection = parseInt(safeGet('modal-end').value, 10);
  if (confirmationModalTailOnly) {
    startSection = (startSection - 1) + sectionsPerCable + 1;
    endSection = (endSection - 1) + sectionsPerCable + 1;
  }
  const method = safeGet('modal-method').value;
  
  // Use project that matches current list filter so the new event appears (important for grand super user where multiple projects can be "active").
  const activeProject = projects.find(p => p.isActive);
  const projectNumber = selectedProjectFilter || config.activeProjectNumber || (activeProject ? activeProject.projectNumber : null);

  const validation = validateStreamerAndSections(streamerNum, startSection, endSection, projectNumber);
  if (!validation.valid) {
    showErrorToast('Out of Range', validation.message);
    setIsFinalizing(false);
    return;
  }
  
  const actualStart = Math.min(startSection, endSection) - 1;
  const actualEnd = Math.max(startSection, endSection) - 1;
  const streamerId = streamerNum;
  
  try {
    const dateVal = safeGet('modal-date').value;
    const timeVal = safeGet('modal-time').value;
    const cleanedAt = (dateVal && timeVal)
      ? new Date(`${dateVal}T${timeVal}`).toISOString()
      : new Date().toISOString();

    const body = {
      streamerId: streamerId,
      sectionIndexStart: actualStart,
      sectionIndexEnd: actualEnd,
      cleaningMethod: method,
      cleanedAt,
      cleaningCount: 1,
      projectNumber: projectNumber,
      vesselTag: config.vesselTag || 'TTN'
    };
    
    const res = await API.apiCall('/api/events', {
      method: 'POST',
      body: JSON.stringify(body),
      action: 'add cleaning events'
    });
    
    closeConfirmationModal();
    await refreshEverything();
    await renderHeatmap();
    await refreshStatsFiltered();
    const count = Array.isArray(res?.created) ? res.created.length : 1;
    if (count === 2) {
      showSuccessToast('Events added', '2 events added (active + tail).');
    } else {
      showSuccessToast('Event added', 'Cleaning event saved.');
    }
  } catch (err) {
    console.error(err);
    showErrorToast('Save Failed', 'Failed to save cleaning event. Please try again.');
  } finally {
    setIsFinalizing(false);
  }
}

/* ------------ Statistics ------------ */

async function refreshStatsFiltered() {
  const startDate = safeGet('filter-start')?.value;
  const endDate = safeGet('filter-end')?.value;

  try {
    // Prepare query params with project filter
    let statsParams = new URLSearchParams();
    if (selectedProjectFilter) statsParams.append('project', selectedProjectFilter);
    
    // Get overall stats from backend
    const overallStats = await API.apiCall(`/api/stats?${statsParams}`);
    
    // Prepare filtered query params
    let params = new URLSearchParams();
    if (startDate) params.append('start', startDate);
    if (endDate) params.append('end', endDate);
    if (selectedProjectFilter) params.append('project', selectedProjectFilter);
    
    // Get filtered stats (or overall if no filters)
    const data = await API.apiCall(`/api/stats/filter?${params}`);
    
    // Use totals from overall stats API
    const totalActiveSections = overallStats.totalAvailableSections;
    const totalTailSections = overallStats.totalAvailableTail;
    const totalSections = totalActiveSections + totalTailSections;
    
    // Determine which stats to display based on filters
    let displayStats;
    if (startDate || endDate) {
      // Show filtered stats
      displayStats = data;
    } else {
      // Show overall stats (no filter)
      displayStats = overallStats;
    }
    
    // Calculate overall coverage
    const totalCleanedSections = displayStats.uniqueCleanedSections || 0;
    const overallCoverage = totalSections > 0
      ? ((totalCleanedSections / totalSections) * 100).toFixed(1)
      : 0;
    
    // Calculate active coverage
    const cleanedActiveCount = displayStats.activeCleanedSections || 0;
    const activeCoverage = totalActiveSections > 0
      ? ((cleanedActiveCount / totalActiveSections) * 100).toFixed(1)
      : 0;
    
    // Calculate tail coverage
    const cleanedTailCount = displayStats.tailCleanedSections || 0;
    const tailCoverage = totalTailSections > 0
      ? ((cleanedTailCount / totalTailSections) * 100).toFixed(1)
      : 0;

    // Update UI - Overall Coverage
    safeGet('kpi-coverage').textContent = `${overallCoverage}%`;
    safeGet('kpi-coverage-sub').textContent = `${totalCleanedSections} / ${totalSections} sections`;

    // Update UI - Breakdown
    if (totalTailSections > 0) {
      safeGet('kpi-breakdown').textContent = 
        `Active: ${activeCoverage}% (${cleanedActiveCount}/${totalActiveSections}) · Tail: ${tailCoverage}% (${cleanedTailCount}/${totalTailSections})`;
    } else {
      safeGet('kpi-breakdown').textContent = 
        `Active: ${activeCoverage}% (${cleanedActiveCount}/${totalActiveSections})`;
    }

    // Update other KPIs (distance, events, last cleaning)
    safeGet('kpi-distance').textContent = fmtKm(data.totalDistance);
    safeGet('kpi-distance-sub').textContent = `${data.totalDistance} meters cleaned`;

    safeGet('kpi-events').textContent = data.events;
    safeGet('kpi-events-sub').textContent = `${data.events} log entries`;

    if (data.lastCleaning) {
      const lastDate = new Date(data.lastCleaning);
      safeGet('kpi-last').textContent = lastDate.toLocaleDateString();
      safeGet('kpi-last-sub').textContent = lastDate.toLocaleTimeString();
    } else {
      safeGet('kpi-last').textContent = '—';
      safeGet('kpi-last-sub').textContent = 'No events';
    }

    // Calculate Days to First Scraping per-streamer breakdown
    const deployDaysBreakdownDiv = safeGet('deploy-days-breakdown');
    if (deployDaysBreakdownDiv) {
      const activeProject = projects.find(p => p.isActive === true);
      
      if (!activeProject) {
        deployDaysBreakdownDiv.innerHTML = '<h3 class="section-title">Days to First Scraping per Streamer</h3><p class="info-text-md">Requires active project with deployment dates</p>';
      } else if (data.events === 0) {
        deployDaysBreakdownDiv.innerHTML = '<h3 class="section-title">Days to First Scraping per Streamer</h3><p class="info-text-md">No cleaning events yet</p>';
      } else {
        try {
          // Get filtered events for calculation
          let filteredEvents = events;
          if (selectedProjectFilter) {
            filteredEvents = filteredEvents.filter(e => String(e.projectNumber) === selectedProjectFilter);
          }
          if (startDate || endDate) {
            filteredEvents = filteredEvents.filter(e => {
              const eventDate = new Date(e.cleanedAt).toISOString().split('T')[0];
              if (startDate && endDate) {
                return eventDate >= startDate && eventDate <= endDate;
              } else if (startDate) {
                return eventDate >= startDate;
              } else if (endDate) {
                return eventDate <= endDate;
              }
              return true;
            });
          }

          const streamerDeployments = await API.apiCall(`/api/projects/${activeProject.id}/streamer-deployments`);

          // Collect days for each streamer
          const streamerDays = [];
          let maxDays = 0;

          for (let streamerNum = 1; streamerNum <= config.numCables; streamerNum++) {
            const streamerId = streamerNum;
            const streamerEvents = filteredEvents.filter(e => e.streamerId === streamerId);

            // Get deployment date for this streamer
            const deployment = streamerDeployments[streamerNum];
            const deployDate = deployment?.deploymentDate;

            if (deployDate && streamerEvents.length > 0) {
              // Find first cleaning for this streamer
              const firstCleaning = streamerEvents.sort((a, b) => 
                new Date(a.cleanedAt) - new Date(b.cleanedAt)
              )[0];

              const days = Math.floor(
                (new Date(firstCleaning.cleanedAt) - new Date(deployDate)) / (1000 * 60 * 60 * 24)
              );

              if (days >= 0) {
                streamerDays.push({ streamerNum, days });
                if (days > maxDays) {
                  maxDays = days;
                }
              }
            }
          }

          // Generate breakdown HTML
          if (streamerDays.length === 0) {
            deployDaysBreakdownDiv.innerHTML = '<h3 class="section-title">Days to First Scraping per Streamer</h3><p class="info-text-md">No deployment dates configured</p>';
          } else {
            deployDaysBreakdownDiv.innerHTML = '<h3 class="section-title">Days to First Scraping per Streamer</h3>';
            
            // Sort by streamer number for consistent display
            streamerDays.sort((a, b) => a.streamerNum - b.streamerNum);
            
            streamerDays.forEach(({ streamerNum, days }) => {
              const percentage = maxDays > 0 ? (days / maxDays) * 100 : 0;
              const bar = document.createElement('div');
              bar.innerHTML = `
                <div class="bar-label">
                  <span>Streamer ${streamerNum}</span>
                  <span>${days} days</span>
                </div>
                <div class="bar">
                  <div class="bar-fill" style="width: ${percentage}%"></div>
                </div>
              `;
              deployDaysBreakdownDiv.appendChild(bar);
            });
          }
        } catch (err) {
          console.error('Failed to calculate days to first scraping', err);
          deployDaysBreakdownDiv.innerHTML = '<h3 class="section-title">Days to First Scraping per Streamer</h3><p class="error-text-md">Calculation error</p>';
        }
      }
    }

    // Method breakdown
    const methodBreakdownDiv = safeGet('method-breakdown');
    if (methodBreakdownDiv && data.byMethod && Object.keys(data.byMethod).length > 0) {
      methodBreakdownDiv.innerHTML = '<h3 style="margin-top: 0">Distance by Method</h3>';
      Object.keys(data.byMethod).forEach(method => {
        const distance = data.byMethod[method];
        const bar = document.createElement('div');
        bar.innerHTML = `
          <div class="bar-label">
            <span>${method}</span>
            <span>${distance} m</span>
          </div>
          <div class="bar">
            <div class="bar-fill" style="width: ${(distance / data.totalDistance) * 100}%"></div>
          </div>
        `;
        methodBreakdownDiv.appendChild(bar);
      });
    }

    // Update streamer cards with same date filter
    await renderStreamerCards(startDate, endDate);

  } catch (err) {
    console.error(err);
  }
}

async function resetFilter() {
  // Clear the date inputs
  const startInput = safeGet('filter-start');
  const endInput = safeGet('filter-end');
  
  if (startInput) startInput.value = '';
  if (endInput) endInput.value = '';
  
  // Refresh stats without filters (show all data)
  await refreshStatsFiltered();
}

async function refreshEverything() {
  await loadEvents();
  await renderLog();
  await renderAlerts();
  await renderStreamerCards(); // No filters = show all data
}

/* ------------ Sorting ------------ */

let sortState = { column: 'date', ascending: false };

async function sortTable(column) {
  if (sortState.column === column) {
    sortState.ascending = !sortState.ascending;
  } else {
    sortState.column = column;
    sortState.ascending = true;
  }

  const sortedEvents = [...events].sort((a, b) => {
    let valA, valB;

    switch (column) {
      case 'date':
        valA = new Date(a.cleanedAt).getTime();
        valB = new Date(b.cleanedAt).getTime();
        break;
      case 'project':
        valA = a.projectNumber || '';
        valB = b.projectNumber || '';
        break;
      case 'streamer':
        valA = a.streamerId;
        valB = b.streamerId;
        break;
      case 'section':
        valA = a.sectionIndexStart;
        valB = b.sectionIndexStart;
        break;
      case 'distance':
        valA = eventDistance(a);
        valB = eventDistance(b);
        break;
      case 'method':
        valA = a.cleaningMethod;
        valB = b.cleaningMethod;
        break;
      case 'addedby':
        valA = (a.addedByUsertag || '').toLowerCase();
        valB = (b.addedByUsertag || '').toLowerCase();
        break;
      default:
        return 0;
    }

    if (valA < valB) return sortState.ascending ? -1 : 1;
    if (valA > valB) return sortState.ascending ? 1 : -1;
    return 0;
  });

  setEvents(sortedEvents);
  await renderLog();
  updateSortIcons();
}

function updateSortIcons() {
  document.querySelectorAll('.sortable').forEach(th => {
    const icon = th.querySelector('.sort-icon');
    if (th.dataset.sort === sortState.column) {
      icon.textContent = sortState.ascending ? '↑' : '↓';
      th.classList.add('sorted');
    } else {
      icon.textContent = '↕';
      th.classList.remove('sorted');
    }
  });
}

/* ------------ Sidebar Navigation ------------ */

function setupSidebarNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const targetId = item.dataset.target;
      const targetSection = document.getElementById(targetId);

      if (targetSection) {
        targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

        // Update active state
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
      }
    });
  });
}

/* ------------ Event Listeners Setup ------------ */

function setupEventListeners() {
  // Config
  safeGet('btn-save-config')?.addEventListener('click', Projects.saveConfig);
  safeGet('btn-cleanup-streamers')?.addEventListener('click', Projects.cleanupOrphanedStreamers);

  // Method tiles
  document.querySelectorAll('.method-tile').forEach(tile => {
    tile.addEventListener('click', () => selectMethod(tile.dataset.method));
  });

  // Manual event entry
  safeGet('btn-add-event')?.addEventListener('click', addEvent);

  // CSV
  safeGet('btn-export-csv')?.addEventListener('click', exportCsv);
  safeGet('btn-import-csv')?.addEventListener('click', importCsv);
  safeGet('csv-input')?.addEventListener('change', (e) => {
    if (e.target.files[0]) {
      handleCsvFile(e.target.files[0]);
    }
  });

  // Clear all events modal
  safeGet('btn-clear-all')?.addEventListener('click', showClearAllModal);
  safeGet('btn-clear-all-confirm')?.addEventListener('click', confirmClearAllEvents);
  safeGet('btn-clear-all-cancel')?.addEventListener('click', closeClearAllModal);
  safeGet('btn-clear-all-close')?.addEventListener('click', closeClearAllModal);
  document.querySelector('#clear-all-modal .modal-overlay')?.addEventListener('click', closeClearAllModal);
  safeGet('clear-all-confirm-input')?.addEventListener('input', () => {
    const btn = safeGet('btn-clear-all-confirm');
    const input = safeGet('clear-all-confirm-input');
    if (btn && input) {
      btn.disabled = input.value.trim().toUpperCase() !== 'DELETE';
    }
  });

  // Filter stats
  safeGet('btn-apply-filter')?.addEventListener('click', refreshStatsFiltered);
  safeGet('btn-reset-filter')?.addEventListener('click', resetFilter);

  // Project management
  safeGet('btn-create-project')?.addEventListener('click', Projects.createProject);
  safeGet('btn-activate-project')?.addEventListener('click', Projects.activateSelectedProject);
  safeGet('btn-clear-project')?.addEventListener('click', Projects.clearActiveProject);
  safeGet('btn-save-project-comments')?.addEventListener('click', Projects.saveProjectComments);

  // Project selector change event (for filtering)
  safeGet('project-selector')?.addEventListener('change', (e) => {
    Projects.setProjectFilter(e.target.value);
  });

  // Backup management
  safeGet('btn-create-backup')?.addEventListener('click', Projects.createBackup);
  safeGet('btn-refresh-backups')?.addEventListener('click', Projects.loadBackups);

  // Streamer deployment configuration
  safeGet('btn-save-streamer-deployments')?.addEventListener('click', Projects.saveStreamerDeployments);
  safeGet('btn-set-all-date')?.addEventListener('click', Projects.setAllDeploymentDates);
  safeGet('btn-set-all-coating')?.addEventListener('click', Projects.setAllCoatingStatus);
  safeGet('btn-clear-all-streamers')?.addEventListener('click', Projects.clearAllStreamerDeployments);

  // Modal - Set All Deployment Date
  safeGet('btn-set-all-date-close')?.addEventListener('click', Projects.closeSetAllDateModal);
  safeGet('btn-set-all-date-cancel')?.addEventListener('click', Projects.closeSetAllDateModal);
  safeGet('btn-set-all-date-apply')?.addEventListener('click', Projects.applySetAllDateModal);
  document.querySelector('#set-all-date-modal .modal-overlay')?.addEventListener('click', Projects.closeSetAllDateModal);

  // Modal - Set All Coating
  safeGet('btn-set-all-coating-close')?.addEventListener('click', Projects.closeSetAllCoatingModal);
  safeGet('btn-set-all-coating-cancel')?.addEventListener('click', Projects.closeSetAllCoatingModal);
  safeGet('btn-set-all-coating-apply')?.addEventListener('click', Projects.applySetAllCoatingModal);
  document.querySelector('#set-all-coating-modal .modal-overlay')?.addEventListener('click', Projects.closeSetAllCoatingModal);
  document.querySelectorAll('#set-all-coating-modal .coating-modal-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#set-all-coating-modal .coating-modal-option').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Modal - Clear All Deployments
  safeGet('btn-clear-all-deployments-close')?.addEventListener('click', Projects.closeClearAllDeploymentsModal);
  safeGet('btn-clear-all-deployments-cancel')?.addEventListener('click', Projects.closeClearAllDeploymentsModal);
  safeGet('btn-clear-all-deployments-confirm')?.addEventListener('click', Projects.confirmClearAllDeployments);
  document.querySelector('#clear-all-deployments-modal .modal-overlay')?.addEventListener('click', Projects.closeClearAllDeploymentsModal);

  // Modal - Clear One Streamer
  safeGet('btn-clear-one-deployment-close')?.addEventListener('click', Projects.closeClearOneDeploymentModal);
  safeGet('btn-clear-one-deployment-cancel')?.addEventListener('click', Projects.closeClearOneDeploymentModal);
  safeGet('btn-clear-one-deployment-confirm')?.addEventListener('click', () => Projects.confirmClearOneDeployment());
  document.querySelector('#clear-one-deployment-modal .modal-overlay')?.addEventListener('click', Projects.closeClearOneDeploymentModal);

  // Modal - Cleanup Orphaned Streamers
  safeGet('btn-cleanup-orphaned-close')?.addEventListener('click', Projects.closeCleanupOrphanedModal);
  safeGet('btn-cleanup-orphaned-cancel')?.addEventListener('click', Projects.closeCleanupOrphanedModal);
  safeGet('btn-cleanup-orphaned-confirm')?.addEventListener('click', async () => {
    await Projects.performCleanupOrphanedStreamers();
    Projects.closeCleanupOrphanedModal();
  });
  document.querySelector('#cleanup-orphaned-modal .modal-overlay')?.addEventListener('click', Projects.closeCleanupOrphanedModal);

  // Modal - Confirmation
  safeGet('btn-modal-close')?.addEventListener('click', closeConfirmationModal);
  safeGet('btn-modal-cancel')?.addEventListener('click', closeConfirmationModal);
  safeGet('btn-modal-confirm')?.addEventListener('click', confirmCleaning);
  safeGet('modal-overlay')?.addEventListener('click', closeConfirmationModal);

  // Modal - Delete
  safeGet('btn-delete-close')?.addEventListener('click', closeDeleteModal);
  safeGet('btn-delete-cancel')?.addEventListener('click', closeDeleteModal);
  safeGet('btn-delete-confirm')?.addEventListener('click', confirmDeleteEvent);
  document.querySelector('#delete-modal .modal-overlay')?.addEventListener('click', closeDeleteModal);

  // Modal - Force Delete Project
  safeGet('btn-force-delete-project-close')?.addEventListener('click', Projects.closeForceDeleteProjectModal);
  safeGet('btn-force-delete-project-cancel')?.addEventListener('click', Projects.closeForceDeleteProjectModal);
  document.querySelector('#force-delete-project-modal .modal-overlay')?.addEventListener('click', Projects.closeForceDeleteProjectModal);
  safeGet('force-delete-project-input')?.addEventListener('input', () => {
    const btn = safeGet('btn-force-delete-project-confirm');
    const inp = safeGet('force-delete-project-input');
    if (btn && inp) btn.disabled = inp.value.trim() !== 'DELETE';
  });
  safeGet('btn-force-delete-project-confirm')?.addEventListener('click', () => Projects.confirmForceDeleteProject());

  // Modal - Edit
  safeGet('btn-edit-close')?.addEventListener('click', closeEditModal);
  safeGet('btn-edit-cancel')?.addEventListener('click', closeEditModal);
  safeGet('btn-edit-save')?.addEventListener('click', saveEditedEvent);
  document.querySelector('#edit-modal .modal-overlay')?.addEventListener('click', closeEditModal);

  // Sortable table headers
  document.querySelectorAll('.sortable').forEach(th => {
    th.addEventListener('click', () => sortTable(th.dataset.sort));
  });
}


// ------------ Project Collapse Toggle ------------
function setupProjectCollapse() {
  const projectHeader = document.querySelector('.project-header');
  const projectContent = document.getElementById('project-content');
  const collapseIcon = document.getElementById('project-collapse-icon');
  
  if (projectHeader && projectContent && collapseIcon) {
    // Load saved state from localStorage
    const isCollapsed = localStorage.getItem('projectCollapsed') === 'true';
    
    if (isCollapsed) {
      projectContent.classList.add('collapsed');
      collapseIcon.classList.add('collapsed');
    }
    
    projectHeader.addEventListener('click', () => {
      const collapsed = projectContent.classList.toggle('collapsed');
      collapseIcon.classList.toggle('collapsed');
      
      // Save state to localStorage
      localStorage.setItem('projectCollapsed', collapsed);
    });
  }
}

/* ------------ Init ------------ */

async function initApp() {
  Projects.initProjects({
    refreshEverything,
    renderHeatmap,
    refreshStatsFiltered,
  });
  await Projects.loadConfig();
  if (config.activeProjectNumber) {
    setSelectedProjectFilter(String(config.activeProjectNumber));
  }
  await Projects.loadProjects();
  Projects.updateActiveProjectBanner();
  await Projects.loadBackups();
  await refreshEverything();
  await renderHeatmap();
  await Projects.renderStreamerDeploymentGrid();
  await refreshStatsFiltered();

  // Set default date/time for manual entry
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toTimeString().slice(0, 5);
  const evtDate = safeGet('evt-date');
  const evtTime = safeGet('evt-time');
  if (evtDate) evtDate.value = dateStr;
  if (evtTime) evtTime.value = timeStr;

  initModals();
  setupEventListeners();
  setupSidebarNavigation();
  setupProjectCollapse();

  // Update UI based on role after everything is loaded
  updateUIForRole();
  
  initPDFGeneration();
}

/* ------------ Initialization ------------ */

async function init() {
  setOnShowAppCallback(async () => {
    await initApp();
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
