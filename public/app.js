/* =========================
   Streamer Maintenance App
   public/app.js
   ========================= */

/* ------------ Global State ------------ */

let config = {
  numCables: 12,
  sectionsPerCable: 107,
  sectionLength: 75,
  moduleFrequency: 4,
  useRopeForTail: true,
  channelsPerSection: 6,
};

let events = [];
let selectedMethod = "rope";

/* Shared drag state */
let dragState = {
  active: false,
  cableId: null,
  start: null,
  end: null,
  cells: null,
};

let isFinalizing = false;

/* ------------ Utilities ------------ */

function safeGet(id) {
  const el = document.getElementById(id);
  if (!el) console.warn(`[UI] Element #${id} not found`);
  return el;
}

function setStatus(el, msg, isError = false) {
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? "#ef4444" : "#2563eb";
  if (msg) setTimeout(() => { el.textContent = ""; }, 4000);
}

function formatDateTime(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function sectionCount(evt) {
  return evt.section_index_end - evt.section_index_start + 1;
}

function eventDistance(evt) {
  return sectionCount(evt) * (config.sectionLength || 1);
}

function toStreamerNum(cable_id) {
  return parseInt(cable_id.split("-")[1] || "0", 10) + 1;
}

function ageBucket(days) {
  if (days === null) return "never";
  if (days <= 0) return "fresh";
  if (days >= 14) return "14plus";
  if (days >= 10) return "10plus";
  if (days >= 7) return "7plus";
  if (days >= 4) return "4plus";
  return "fresh";
}

function fmtKm(meters) {
  return `${(meters / 1000).toFixed(1)} km`;
}

function getChannelRange(sectionIndex) {
  const channelsPerSection = config.channelsPerSection || 6;
  const startChannel = sectionIndex * channelsPerSection + 1;
  const endChannel = startChannel + channelsPerSection - 1;
  return `Ch ${startChannel}–${endChannel}`;
}

function formatAS(sectionIndex) {
  return `AS${String(sectionIndex + 1).padStart(2, '0')}`;
}

function formatEB(moduleIndex) {
  return `EB${String(moduleIndex).padStart(2, '0')}`;
}

// Helper: eBird ranges nearest to cleaned section
function getEBRange(startSection, endSection) {
  const moduleFreq = config.moduleFrequency || 4;
  const N = config.sectionsPerCable;

  // Find all module positions
  const modules = [];

  // First module after AS1 (section 0)
  if (0 >= startSection && 0 <= endSection) {
    modules.push(1);
  }

  // Regular modules every moduleFreq sections
  for (let s = 0; s <= N - 1; s++) {
    if (s > 0 && s % moduleFreq === 0 && s >= startSection && s <= endSection) {
      const moduleNum = Math.floor(s / moduleFreq) + 1;
      modules.push(moduleNum);
    }
  }

  // Last module always after last active section (N-1)
  if ((N - 1) >= startSection && (N - 1) <= endSection) {
    const lastModuleNum = Math.floor((N - 1) / moduleFreq) + 1;
    if (!modules.includes(lastModuleNum)) {
      modules.push(lastModuleNum);
    }
  }

  // If no modules in range, find closest before and after
  if (modules.length === 0) {
    const allModules = [];
    allModules.push(1); // First module after AS1
    for (let s = moduleFreq; s <= N - 1; s += moduleFreq) {
      allModules.push(Math.floor(s / moduleFreq) + 1);
    }
    allModules.push(Math.floor((N - 1) / moduleFreq) + 1); // Last module

    const before = allModules.filter(m => {
      const modSection = m === 1 ? 0 : (m - 1) * moduleFreq;
      return modSection < startSection;
    }).pop();

    const after = allModules.find(m => {
      const modSection = m === 1 ? 0 : (m - 1) * moduleFreq;
      return modSection > endSection;
    });

    if (before && after) {
      return `${formatEB(after)} - ${formatEB(before)}`;
    } else if (before) {
      return `Tail Adaptor - ${formatEB(before)}`;
    } else if (after) {
      return `${formatEB(after)}`;
    }
  }

  // Return range of modules found
  if (modules.length === 1) {
    return `${formatEB(modules[0])}`;
  } else if (modules.length > 1) {
    const min = Math.min(...modules);
    const max = Math.max(...modules);
    return `${formatEB(max)} - ${formatEB(min)}`;
  }

  return '-';
}

// Helper: sections per cable including tail (active + tail)
function getSectionsPerCableWithTail() {
  const base = config.sectionsPerCable || 0;
  const tail = config.useRopeForTail ? 0 : 5;
  return base + tail;
}

// Helper: 1‑based max section number for UI validation
function getMaxSectionIndex() {
  return getSectionsPerCableWithTail();
}

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

function showSectionTooltip(e, cableId, sectionIndex) {
  const tooltip = createTooltip();
  const streamerNum = toStreamerNum(cableId);
  const N = config.sectionsPerCable;

  // Determine if it's a tail section
  const isTail = sectionIndex >= N;
  const sectionLabel = formatAS(sectionIndex);

  // Get cleaning history for this specific section
  const sectionEvents = events.filter(evt =>
    evt.cable_id === cableId &&
    sectionIndex >= evt.section_index_start &&
    sectionIndex <= evt.section_index_end
  );

  const totalCleanings = sectionEvents.length;

  // Get last cleaned date
  let lastCleaned = null;
  let lastMethod = null;
  let daysSince = null;

  if (sectionEvents.length > 0) {
    const sortedEvents = sectionEvents.sort((a, b) =>
      new Date(b.cleaned_at) - new Date(a.cleaned_at)
    );
    lastCleaned = sortedEvents[0].cleaned_at;
    lastMethod = sortedEvents[0].cleaning_method;
    daysSince = Math.floor((Date.now() - new Date(lastCleaned)) / (1000 * 60 * 60 * 24));
  }

  // Count methods used
  const methodCounts = {};
  sectionEvents.forEach(evt => {
    methodCounts[evt.cleaning_method] = (methodCounts[evt.cleaning_method] || 0) + 1;
  });

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

  // Show method breakdown if multiple cleanings
  if (totalCleanings > 1) {
    html += `<div class="tooltip-section">`;
    for (const [method, count] of Object.entries(methodCounts)) {
      const icon = getMethodIcon(method);
      html += `
        <div class="tooltip-row">
          <span class="tooltip-method">${icon} ${method}</span>
          <span class="tooltip-value">${count}</span>
        </div>
      `;
    }
    html += `</div>`;
  }

  tooltip.innerHTML = html;

  // Position tooltip near cursor
  const x = e.clientX + 15;
  const y = e.clientY + 15;

  // Adjust if tooltip would go off screen
  const rect = tooltip.getBoundingClientRect();
  const adjustedX = (x + rect.width > window.innerWidth) ? x - rect.width - 30 : x;
  const adjustedY = (y + rect.height > window.innerHeight) ? y - rect.height - 30 : y;

  tooltip.style.left = `${adjustedX}px`;
  tooltip.style.top = `${adjustedY}px`;
  tooltip.classList.add('show');
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
        const cableId = cell.dataset.cable;
        const section = parseInt(cell.dataset.section, 10);
        if (cableId && !isNaN(section)) {
          showSectionTooltip(e, cableId, section);
        }
      }
    });

    cell.addEventListener('mousemove', (e) => {
      if (!dragState.active) {
        const cableId = cell.dataset.cable;
        const section = parseInt(cell.dataset.section, 10);
        if (cableId && !isNaN(section)) {
          showSectionTooltip(e, cableId, section);
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

function isModulePosition(sectionIndex) {
  const N = config.sectionsPerCable;
  const moduleFreq = config.moduleFrequency || 4;
  const firstActive = 0;
  const lastActive = N - 1;

  return (
    sectionIndex === firstActive ||
    sectionIndex === lastActive ||
    (sectionIndex > firstActive &&
      sectionIndex < lastActive &&
      (sectionIndex - firstActive) % moduleFreq === 0)
  );
}

function getModuleNumber(sectionIndex) {
  const moduleFreq = config.moduleFrequency || 4;
  const firstActive = 0;
  if (sectionIndex === firstActive) return 1;
  return Math.floor((sectionIndex - firstActive) / moduleFreq) + 1;
}

/* ------------ Config API ------------ */

async function loadConfig() {
  try {
    const res = await fetch('api/config');
    const data = await res.json();
    config = data;
    document.documentElement.style.setProperty('--sections', config.sectionsPerCable);

    safeGet('cfg-numCables').value = config.numCables;
    safeGet('cfg-sectionsPerCable').value = config.sectionsPerCable;
    safeGet('cfg-sectionLength').value = config.sectionLength;
    safeGet('cfg-moduleFrequency').value = config.moduleFrequency;
    safeGet('cfg-channelsPerSection').value = config.channelsPerSection || 6;
    safeGet('cfg-useRopeForTail').value = String(config.useRopeForTail);
  } catch (err) {
    console.error(err);
  }
}

async function saveConfig() {
  const statusEl = safeGet('config-status');
  try {
    const body = {
      numCables: parseInt(safeGet('cfg-numCables').value || 1, 10),
      sectionsPerCable: parseInt(safeGet('cfg-sectionsPerCable').value || 1, 10),
      sectionLength: parseInt(safeGet('cfg-sectionLength').value || 1, 10),
      moduleFrequency: parseInt(safeGet('cfg-moduleFrequency').value || 1, 10),
      channelsPerSection: parseInt(safeGet('cfg-channelsPerSection').value || 6, 10),
      useRopeForTail: safeGet('cfg-useRopeForTail').value === 'true',
    };

    const res = await fetch('api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error('Failed to save config');

    const data = await res.json();
    config = data;
    document.documentElement.style.setProperty('--sections', config.sectionsPerCable);
    setStatus(statusEl, '✅ Configuration updated');

    await refreshEverything();
    await renderHeatmap();
    await refreshStatsFiltered();
  } catch (err) {
    console.error(err);
    setStatus(statusEl, 'Failed to save config', true);
  }
}

/* ------------ Events API ------------ */

async function loadEvents() {
  const res = await fetch('api/events');
  events = await res.json();
}

async function addEvent() {
  const statusEl = safeGet('event-status');
  try {
    const streamerNum = parseInt(safeGet('evt-streamer').value || 1, 10);
    const startSection = parseInt(safeGet('evt-start').value || 1, 10);
    const endSection = parseInt(safeGet('evt-end').value || 1, 10);
    const method = safeGet('evt-method').value;
    const dateVal = safeGet('evt-date').value;
    const timeVal = safeGet('evt-time').value;

    if (!dateVal || !timeVal) {
      setStatus(statusEl, 'Please select date and time', true);
      return;
    }

    const maxSection = getMaxSectionIndex();

    if (
      streamerNum < 1 ||
      streamerNum > (config.numCables + 1) ||
      startSection < 1 ||
      endSection < 1 ||
      startSection > maxSection ||
      endSection > maxSection
    ) {
      setStatus(statusEl, 'Streamer or section out of range', true);
      return;
    }

    const actualStart = Math.min(startSection, endSection) - 1;
    const actualEnd = Math.max(startSection, endSection) - 1;
    const datetimeIso = new Date(`${dateVal}T${timeVal}`).toISOString();
    const cableId = `cable-${streamerNum - 1}`;

    const body = {
      cable_id: cableId,
      section_index_start: actualStart,
      section_index_end: actualEnd,
      cleaning_method: method,
      cleaned_at: datetimeIso,
      cleaning_count: 1,
    };

    const res = await fetch('api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error('Failed');

    setStatus(statusEl, '✅ Event added');
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
  const cableIndex = parseInt(evt.cable_id.split('-')[1], 10);
  const streamerNum = cableIndex + 1;

  safeGet('delete-event-id').value = evt.id;
  safeGet('delete-streamer-display').textContent = streamerNum;
  safeGet('delete-range-display').textContent = `${formatAS(evt.section_index_start)} – ${formatAS(evt.section_index_end)}`;
  safeGet('delete-eb-display').textContent = getEBRange(evt.section_index_start, evt.section_index_end);
  safeGet('delete-method-display').textContent = evt.cleaning_method;
  safeGet('delete-date-display').textContent = formatDateTime(evt.cleaned_at);
  safeGet('delete-distance-display').textContent = `${eventDistance(evt)} m`;

  safeGet('delete-modal').classList.add('show');
}

function closeDeleteModal() {
  safeGet('delete-modal').classList.remove('show');
}

async function confirmDeleteEvent() {
  const id = parseInt(safeGet('delete-event-id').value);
  
  try {
    const res = await fetch(`api/events/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed');

    closeDeleteModal();
    await refreshEverything();
    await renderHeatmap();
    await refreshStatsFiltered();
  } catch (err) {
    console.error(err);
    alert('Failed to delete event. Please try again.');
  }
}

function editEventPrompt(id) {
  const evt = events.find(e => e.id === id);
  if (!evt) return;

  const cableIndex = parseInt(evt.cable_id.split('-')[1] || 0, 10);
  const streamerNum = cableIndex + 1;

  safeGet('edit-event-id').value = evt.id;
  safeGet('edit-streamer').value = streamerNum;
  safeGet('edit-start').value = evt.section_index_start + 1;
  safeGet('edit-end').value = evt.section_index_end + 1;
  safeGet('edit-method').value = evt.cleaning_method;

  const dateObj = new Date(evt.cleaned_at);
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

  const actualStart = Math.min(startSection, endSection) - 1;
  const actualEnd = Math.max(startSection, endSection) - 1;
  const cableId = `cable-${streamerNum - 1}`;
  const datetimeIso = new Date(`${dateVal}T${timeVal}`).toISOString();

  const body = {
    cable_id: cableId,
    section_index_start: actualStart,
    section_index_end: actualEnd,
    cleaning_method: method,
    cleaned_at: datetimeIso,
    cleaning_count: 1,
  };

  await updateEvent(id, body);
  closeEditModal();
}

async function updateEvent(id, body) {
  try {
    const res = await fetch(`api/events/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error('Failed');

    await refreshEverything();
    await renderHeatmap();
    await refreshStatsFiltered();
  } catch (err) {
    console.error(err);
    alert('Failed to update event');
  }
}

async function clearAllEvents() {
  if (!confirm('Are you sure you want to permanently delete ALL cleaning events?')) return;

  try {
    const res = await fetch('api/events', { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed');

    await refreshEverything();
    await renderHeatmap();
    await refreshStatsFiltered();
  } catch (err) {
    console.error(err);
    alert('Failed to clear events');
  }
}

/* ------------ CSV Import/Export ------------ */

function exportCsv() {
  if (!events.length) {
    alert('No events to export.');
    return;
  }

  const header = 'Streamer Number,First Section,Last Section,Cleaning Method,Date & Time';
  const rows = [header];

  events.forEach(evt => {
    const streamerNum = toStreamerNum(evt.cable_id);
    const startSection = evt.section_index_start + 1;
    const endSection = evt.section_index_end + 1;
    const dateStr = new Date(evt.cleaned_at).toLocaleString();
    rows.push(`${streamerNum},${startSection},${endSection},${evt.cleaning_method},"${dateStr}"`);
  });

  const csv = rows.join('\n');
  
  // Create a Blob from the CSV string
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  
  // Create a temporary download link
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  // Generate filename with current date
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const filename = `streamer-cleaning-events-${dateStr}.csv`;
  
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
  return line.split(regex).map(p => p.trim().replace(/^"|"$/g, ''));
}

async function handleCsvFile(file) {
  const reader = new FileReader();

  reader.onload = async (e) => {
    const content = e.target.result;
    const lines = content.split('\n').filter(l => l.trim());

    if (lines.length < 2) {
      alert('CSV seems empty or invalid.');
      return;
    }

    const dataLines = lines.slice(1);
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < dataLines.length; i++) {
      const line = dataLines[i].trim();
      if (!line) continue;

      const parts = parseCsvLine(line);
      if (parts.length < 5) {
        errorCount++;
        continue;
      }

      const streamerNum = parseInt(parts[0], 10);
      const startSection = parseInt(parts[1], 10);
      const endSection = parseInt(parts[2], 10);
      const method = parts[3];
      const dateTimeStr = parts[4].replace(/"/g, '').trim();

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
      const cableId = `cable-${streamerNum - 1}`;

      const body = {
        cable_id: cableId,
        section_index_start: actualStart,
        section_index_end: actualEnd,
        cleaning_method: method,
        cleaned_at: dateObj.toISOString(),
        cleaning_count: 1,
      };

      try {
        const res = await fetch('api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) throw new Error('Failed');
        successCount++;
      } catch {
        errorCount++;
      }
    }

    await refreshEverything();
    await renderHeatmap();
    await refreshStatsFiltered();

    alert(`CSV import completed.\n✅ ${successCount} events imported\n❌ ${errorCount} errors`);
  };

  reader.readAsText(file);
}

/* ------------ Log rendering ------------ */

function renderLog() {
  const tbody = safeGet('log-body');
  if (!tbody) return;

  tbody.innerHTML = '';

  events.forEach(evt => {
    const tr = document.createElement('tr');
    const streamerNum = toStreamerNum(evt.cable_id);
    const rangeLabel = `${formatAS(evt.section_index_end)}–${formatAS(evt.section_index_start)}`;
    const ebRange = getEBRange(evt.section_index_start, evt.section_index_end);
    const distance = eventDistance(evt);

    tr.innerHTML = `
      <td>${formatDateTime(evt.cleaned_at)}</td>
      <td>Streamer ${streamerNum}</td>
      <td>${rangeLabel}</td>
      <td>${ebRange}</td>
      <td>${distance} m</td>
      <td>${evt.cleaning_method}</td>
      <td>
        <button class="btn btn-outline btn-edit" data-id="${evt.id}">✏️</button>
        <button class="btn btn-outline btn-delete" data-id="${evt.id}">🗑️</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Add event listeners for edit/delete buttons
  document.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', () => editEventPrompt(parseInt(btn.dataset.id)));
  });

  document.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteEvent(parseInt(btn.dataset.id)));
  });
}

/* ------------ Method selection ------------ */

function selectMethod(method) {
  selectedMethod = method;
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
    const res = await fetch('api/last-cleaned');
    const data = await res.json();
    const lastCleaned = data.lastCleaned;

    let critical = 0;
    let warning = 0;
    let uncleaned = 0;

    Object.keys(lastCleaned).forEach(cableId => {
      const sections = lastCleaned[cableId];
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
    const res = await fetch('api/last-cleaned');
    const data = await res.json();
    const lastCleaned = data.lastCleaned;

    const cableCount = config.numCables;
    const N = config.sectionsPerCable;
    const tailSections = config.useRopeForTail ? 0 : 5;
    const totalPerCable = N + tailSections;

    for (let c = 0; c < cableCount; c++) {
      const cableId = `cable-${c}`;
      const sections = lastCleaned[cableId] || [];

      // Filter events by date range if provided
      let filteredEvents = events.filter(evt => evt.cable_id === cableId);

      if (startDate || endDate) {
        filteredEvents = filteredEvents.filter(evt => {
          const evtDate = new Date(evt.cleaned_at).toISOString().split('T')[0];
          if (startDate && evtDate < startDate) return false;
          if (endDate && evtDate > endDate) return false;
          return true;
        });
      }

      // Calculate coverage based on filtered events
      let cleanedCount = 0;
      let totalCleanings = 0;

      sections.forEach((date, idx) => {
        if (!date) return; // Never cleaned
        
        // If filters applied, check if lastCleaned date is in range  
        if (startDate || endDate) {
          const sectionDate = new Date(date).toISOString().split('T')[0];
          
          if (startDate && sectionDate < startDate) return;
          if (endDate && sectionDate > endDate) return;
          
          cleanedCount++;
        } else {
          // No filters - count all cleaned sections
          cleanedCount++;
        }
      });

      const coverage = totalPerCable > 0 ? Math.round((cleanedCount / totalPerCable) * 100) : 0;
      const avgCleanings = cleanedCount > 0 ? (totalCleanings / cleanedCount).toFixed(1) : 0;

      const card = document.createElement('div');
      card.className = 'streamer-card';
      card.innerHTML = `
        <div class="streamer-card-header">
          <div class="streamer-card-title">Streamer ${c + 1}</div>
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
    const res = await fetch('api/last-cleaned');
    const data = await res.json();
    const lastCleaned = data.lastCleaned;

    const N = config.sectionsPerCable;
    const cableCount = config.numCables;
    const moduleFreq = config.moduleFrequency || 4;
    const channelsPerSection = config.channelsPerSection || 6;
    const useTailSections = !config.useRopeForTail;
    const tailSections = useTailSections ? 5 : 0;

    // Calculate total rows = sections + modules + tail sections
    const modulesCount = Math.floor(N / moduleFreq);
    const totalRows = N + modulesCount + tailSections;

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
    for (let s = 0; s < N; s++) {
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
      const isLastModule = sectionNumber === N;

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
    for (let c = cableCount - 1; c >= 0; c--) {
      const cableId = `cable-${c}`;
      const sections = lastCleaned[cableId] || [];

      const col = document.createElement('div');
      col.className = 'hm-col';
      col.style.gridTemplateRows = `36px repeat(${totalRows}, 32px)`;

      // Streamer header
      const label = document.createElement('div');
      label.className = 'hm-col-label';
      label.textContent = `S${c + 1}`;
      label.title = `Streamer ${c + 1}`;
      col.appendChild(label);

      rowIndex = 0;
      let moduleNum = 1;

      for (let s = 0; s < N; s++) {
        // Active section cell
        const cell = document.createElement('div');
        cell.className = 'hm-vcell hm-active-section';
        cell.dataset.cable = cableId;
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
        const isLastModule = sectionNumber === N;

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
        const tailIdx = N + t;
        const tailCell = document.createElement('div');
        tailCell.className = 'hm-vcell hm-tail-section';
        tailCell.dataset.cable = cableId;
        tailCell.dataset.section = tailIdx;
        tailCell.dataset.isTail = 'true';
        tailCell.textContent = `T${t + 1}`;

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
  } catch (err) {
    console.error(err);
  }
}

/* ------------ Drag-to-select ------------ */

function attachDragListeners() {
  const cells = document.querySelectorAll('.hm-vcell:not(.hm-module)');

  cells.forEach(cell => {
    cell.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const cableId = cell.dataset.cable;
      const section = parseInt(cell.dataset.section, 10);

      if (!cableId || isNaN(section)) return;

      dragState.active = true;
      dragState.cableId = cableId;
      dragState.start = section;
      dragState.end = section;
      dragState.cells = Array.from(cells);
      updateDragHighlight();
    });

    cell.addEventListener('mouseenter', () => {
      if (!dragState.active) return;

      const cableId = cell.dataset.cable;
      const section = parseInt(cell.dataset.section, 10);

      if (cableId === dragState.cableId && !isNaN(section)) {
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

  const { cableId, start, end } = dragState;
  const min = Math.min(start, end);
  const max = Math.max(start, end);

  dragState.cells.forEach(cell => {
    const cellCable = cell.dataset.cable;
    const cellSection = parseInt(cell.dataset.section, 10);
    const inRange = cellCable === cableId && cellSection >= min && cellSection <= max;
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

  dragState = {
    active: false,
    cableId: null,
    start: null,
    end: null,
    cells: null,
  };
}

/* ------------ Modal Confirmation ------------ */

function showConfirmationModal() {
  if (!dragState.active || isFinalizing) return;

  dragState.active = false;

  const { cableId, start, end } = dragState;
  const min = Math.min(start, end);
  const max = Math.max(start, end);
  const streamerNum = toStreamerNum(cableId);

  // Active + tail 1‑based max for UI
  const maxSection = getSectionsPerCableWithTail();

  const streamerInput = safeGet('modal-streamer');
  const startInput = safeGet('modal-start');
  const endInput = safeGet('modal-end');
  const methodSelect = safeGet('modal-method');

  // Clamp values so they never exceed maxSection
  const clampedStart = Math.min(min + 1, maxSection);
  const clampedEnd = Math.min(max + 1, maxSection);

  streamerInput.value = streamerNum;
  streamerInput.max = config.numCables;

  startInput.value = clampedStart;
  startInput.min = 1;
  startInput.max = maxSection;

  endInput.value = clampedEnd;
  endInput.min = 1;
  endInput.max = maxSection;

  methodSelect.value = selectedMethod;

  updateModalSummary();
  safeGet('confirmation-modal').classList.add('show');

  streamerInput.oninput = updateModalSummary;
  startInput.oninput = updateModalSummary;
  endInput.oninput = updateModalSummary;
  methodSelect.oninput = updateModalSummary;
}

function updateModalSummary() {
  const start = parseInt(safeGet('modal-start').value || 1, 10) - 1;
  const end = parseInt(safeGet('modal-end').value || 1, 10) - 1;

  const min = Math.min(start, end);
  const max = Math.max(start, end);

  const rangeText = `${formatAS(min)} – ${formatAS(max)}`;
  const channelStart = getChannelRange(min).split('–')[0];
  const channelEnd = getChannelRange(max).split('–')[1];
  const channelText = `${channelStart} – ${channelEnd}`;
  const distance = (max - min + 1) * config.sectionLength;

  safeGet('modal-summary-range').textContent = rangeText;
  safeGet('modal-summary-channels').textContent = channelText;
  safeGet('modal-summary-distance').textContent = `${distance} m`;
}

function closeConfirmationModal() {
  safeGet('confirmation-modal').classList.remove('show');
  clearDragState();
  isFinalizing = false;
}

async function confirmCleaning() {
  if (isFinalizing) return;
  isFinalizing = true;

  const streamerNum = parseInt(safeGet('modal-streamer').value, 10);
  const startSection = parseInt(safeGet('modal-start').value, 10);
  const endSection = parseInt(safeGet('modal-end').value, 10);
  const method = safeGet('modal-method').value;

  const maxSection = getMaxSectionIndex();

  if (
    isNaN(streamerNum) ||
    streamerNum < 1 ||
    streamerNum > config.numCables ||
    isNaN(startSection) ||
    startSection < 1 ||
    startSection > maxSection ||
    isNaN(endSection) ||
    endSection < 1 ||
    endSection > maxSection
  ) {
    alert('Invalid input values');
    isFinalizing = false;
    return;
  }

  const actualStart = Math.min(startSection, endSection) - 1;
  const actualEnd = Math.max(startSection, endSection) - 1;
  const cableId = `cable-${streamerNum - 1}`;

  try {
    const now = new Date().toISOString();

    const body = {
      cable_id: cableId,
      section_index_start: actualStart,
      section_index_end: actualEnd,
      cleaning_method: method,
      cleaned_at: now,
      cleaning_count: 1,
    };

    const res = await fetch('api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error('Failed to save');

    closeConfirmationModal();
    await refreshEverything();
    await renderHeatmap();
    await refreshStatsFiltered();
  } catch (err) {
    console.error(err);
    alert('Failed to save cleaning event');
    isFinalizing = false;
  }
}

/* ------------ Statistics ------------ */

async function refreshStatsFiltered() {
  const startDate = safeGet('filter-start')?.value;
  const endDate = safeGet('filter-end')?.value;

  try {
    // Get overall stats from backend
    const statsRes = await fetch('/api/stats');
    const overallStats = await statsRes.json();
    
    // Prepare filtered query params
    let params = new URLSearchParams();
    if (startDate) params.append('start', startDate);
    if (endDate) params.append('end', endDate);
    
    // Get filtered stats (or overall if no filters)
    const filterRes = await fetch(`/api/stats/filter?${params}`);
    const data = await filterRes.json();
    
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

    // Method breakdown
    const breakdownDiv = safeGet('method-breakdown');
    if (breakdownDiv && data.byMethod && Object.keys(data.byMethod).length > 0) {
      breakdownDiv.innerHTML = '<h3 style="margin-top: 0">Distance by Method</h3>';
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
        breakdownDiv.appendChild(bar);
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
  renderLog();
  await renderAlerts();
  await renderStreamerCards(); // No filters = show all data
}

/* ------------ Sorting ------------ */

let sortState = { column: 'date', ascending: false };

function sortTable(column) {
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
        valA = new Date(a.cleaned_at).getTime();
        valB = new Date(b.cleaned_at).getTime();
        break;
      case 'streamer':
        valA = toStreamerNum(a.cable_id);
        valB = toStreamerNum(b.cable_id);
        break;
      case 'section':
        valA = a.section_index_start;
        valB = b.section_index_start;
        break;
      case 'distance':
        valA = eventDistance(a);
        valB = eventDistance(b);
        break;
      case 'method':
        valA = a.cleaning_method;
        valB = b.cleaning_method;
        break;
      default:
        return 0;
    }

    if (valA < valB) return sortState.ascending ? -1 : 1;
    if (valA > valB) return sortState.ascending ? 1 : -1;
    return 0;
  });

  events = sortedEvents;
  renderLog();
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
  safeGet('btn-save-config')?.addEventListener('click', saveConfig);

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
  safeGet('btn-clear-all')?.addEventListener('click', clearAllEvents);

  // Filter stats
  safeGet('btn-apply-filter')?.addEventListener('click', refreshStatsFiltered);
  safeGet('btn-reset-filter')?.addEventListener('click', resetFilter);

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

// ------------ Configuration Collapse Toggle ------------
function setupConfigCollapse() {
  const configHeader = document.querySelector('.config-header');
  const configContent = document.getElementById('config-content');
  const collapseIcon = document.getElementById('config-collapse-icon');
  
  if (configHeader && configContent && collapseIcon) {
    // Load saved state from localStorage
    const isCollapsed = localStorage.getItem('configCollapsed') === 'true';
    
    if (isCollapsed) {
      configContent.classList.add('collapsed');
      collapseIcon.classList.add('collapsed');
    }
    
    configHeader.addEventListener('click', () => {
      const collapsed = configContent.classList.toggle('collapsed');
      collapseIcon.classList.toggle('collapsed');
      
      // Save state to localStorage
      localStorage.setItem('configCollapsed', collapsed);
    });
  }
}

/* ------------ Init ------------ */

async function init() {
  await loadConfig();
  await refreshEverything();
  await renderHeatmap();
  await refreshStatsFiltered();

  // Set default date/time for manual entry
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toTimeString().slice(0, 5);
  safeGet('evt-date').value = dateStr;
  safeGet('evt-time').value = timeStr;

  setupEventListeners();
  setupSidebarNavigation();
  setupConfigCollapse();
  
  if (typeof initPDFGeneration === 'function') {
    initPDFGeneration();
  }  
}

init();
