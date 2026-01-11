/* =========================
   Streamer Maintenance App
   public/app.js
   ========================= */

/* ------------ Global State ------------ */

let config = null;

let events = [];
let selectedMethod = "rope";
let projects = [];
let selectedProjectFilter = null; // For filtering events by project

// Authentication state
let authToken = null;
let currentUser = null;

/* ------------ Auth Helpers ------------ */

function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  return headers;
}

function isAdmin() {
  return currentUser?.role === 'admin';
}

// Save session to localStorage
function saveSession(token, user) {
  authToken = token;
  currentUser = user;
  localStorage.setItem('authToken', token);
  localStorage.setItem('currentUser', JSON.stringify(user));
}

// Load session from localStorage
function loadSession() {
  const token = localStorage.getItem('authToken');
  const userStr = localStorage.getItem('currentUser');
  if (token && userStr) {
    authToken = token;
    currentUser = JSON.parse(userStr);
    return true;
  }
  return false;
}

// Clear session
function clearSession() {
  authToken = null;
  currentUser = null;
  localStorage.removeItem('authToken');
  localStorage.removeItem('currentUser');
}

// Validate session with server
async function validateSession() {
  if (!authToken) return false;
  
  try {
    const res = await fetch('api/session', {
      headers: getAuthHeaders()
    });
    
    if (res.ok) {
      const data = await res.json();
      currentUser = { username: data.username, role: data.role };
      return true;
    } else {
      clearSession();
      return false;
    }
  } catch (err) {
    console.error('Session validation failed:', err);
    clearSession();
    return false;
  }
}

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
  el.classList.toggle('status-error', isError);
  el.classList.toggle('status-info', !isError);
  if (msg) setTimeout(() => { el.textContent = ""; }, 4000);
}

/* ------------ Toast Notifications ------------ */

function showToast(type, title, message, duration = 5000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const icons = {
    error: '🚫',
    warning: '⚠️',
    success: '✅',
    info: 'ℹ️'
  };
  
  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || icons.info}</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
    <button class="toast-close" aria-label="Close">×</button>
    <div class="toast-progress"></div>
  `;
  
  // Close button handler
  const closeBtn = toast.querySelector('.toast-close');
  closeBtn.addEventListener('click', () => dismissToast(toast));
  
  container.appendChild(toast);
  
  // Auto dismiss after duration
  if (duration > 0) {
    setTimeout(() => dismissToast(toast), duration);
  }
  
  return toast;
}

function dismissToast(toast) {
  if (!toast || toast.classList.contains('toast-exit')) return;
  
  toast.classList.add('toast-exit');
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 300);
}

function showErrorToast(title, message) {
  return showToast('error', title, message);
}

function showWarningToast(title, message) {
  return showToast('warning', title, message);
}

function showSuccessToast(title, message) {
  return showToast('success', title, message);
}

function showAccessDeniedToast(action = 'perform this action') {
  return showErrorToast(
    'Access Denied',
    `Administrator access required to ${action}. Please login with an admin account.`
  );
}

function formatDateTime(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function sectionCount(evt) {
  return evt.sectionIndexEnd - evt.sectionIndexStart + 1;
}

function eventDistance(evt) {
  return sectionCount(evt) * (config.sectionLength || 1);
}

function toStreamerNum(cableId) {
  return parseInt(cableId.split("-")[1] || "0", 10) + 1;
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
  const channelsPerSection = config.channelsPerSection;
  const startChannel = sectionIndex * channelsPerSection + 1;
  const endChannel = startChannel + channelsPerSection - 1;
  return `Ch ${startChannel}–${endChannel}`;
}

function formatAS(sectionIndex) {
  return `AS${String(sectionIndex + 1).padStart(2, '0')}`;
}


// Helper: Fetch EB range from server API
// Finds closest module AT OR BEFORE startSection and AT OR AFTER endSection
async function getEBRange(startSection, endSection) {
  try {
    const res = await fetch(`api/eb-range?start=${startSection}&end=${endSection}`);
    if (!res.ok) throw new Error('Failed to fetch EB range');
    const data = await res.json();
    return data.ebRange || '-';
  } catch (err) {
    console.error('getEBRange error:', err);
    return '-';
  }
}

function formatEB(num) {
  return `EB${String(num).padStart(2, '0')}`;
}


// Helper: Get config for a specific project (or fall back to current config)
function getConfigForProject(projectNumber) {
  const pn = (projectNumber || "").trim();
  if (pn && Array.isArray(projects)) {
    const p = projects.find(x => x.projectNumber === pn);
    if (p) {
      return {
        numCables: p.numCables || config.numCables,
        sectionsPerCable: p.sectionsPerCable || config.sectionsPerCable,
        sectionLength: p.sectionLength || config.sectionLength,
        moduleFrequency: p.moduleFrequency || config.moduleFrequency,
        channelsPerSection: p.channelsPerSection || config.channelsPerSection,
        useRopeForTail: p.useRopeForTail !== null && p.useRopeForTail !== undefined
          ? p.useRopeForTail === true || p.useRopeForTail === 1
          : config.useRopeForTail
      };
    }
  }
  return config;
}

// UPDATED: Now accepts a config object
function getSectionsPerCableWithTail(cfg = config) {
  const base = cfg.sectionsPerCable || 0;
  const tail = cfg.useRopeForTail ? 0 : 5;
  return base + tail;
}

// UPDATED: Now accepts a config object
function getMaxSectionIndex(cfg = config) {
  return getSectionsPerCableWithTail(cfg);
}

// Single validation function - uses the helpers
function validateStreamerAndSections(streamerNum, startSection, endSection, projectNumber = null) {
  const eventConfig = getConfigForProject(projectNumber);
  const maxStreamer = eventConfig.numCables;
  const maxSection = getMaxSectionIndex(eventConfig); // ← Use helper!

  if (
    Number.isNaN(streamerNum) || streamerNum < 1 || streamerNum > maxStreamer ||
    Number.isNaN(startSection) || startSection < 1 || startSection > maxSection ||
    Number.isNaN(endSection) || endSection < 1 || endSection > maxSection
  ) {
    return {
      valid: false,
      maxStreamer,
      maxSection,
      message: `Streamer must be 1-${maxStreamer}, sections must be 1-${maxSection}.`
    };
  }

  return { valid: true, maxStreamer, maxSection };
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
    evt.cableId === cableId &&
    sectionIndex >= evt.sectionIndexStart &&
    sectionIndex <= evt.sectionIndexEnd
  );

  const totalCleanings = sectionEvents.length;

  // Get last cleaned date
  let lastCleaned = null;
  let lastMethod = null;
  let daysSince = null;

  if (sectionEvents.length > 0) {
    const sortedEvents = sectionEvents.sort((a, b) =>
      new Date(b.cleanedAt) - new Date(a.cleanedAt)
    );
    lastCleaned = sortedEvents[0].cleanedAt;
    lastMethod = sortedEvents[0].cleaningMethod;
    daysSince = Math.floor((Date.now() - new Date(lastCleaned)) / (1000 * 60 * 60 * 24));
  }

  // Count methods used
  const methodCounts = {};
  sectionEvents.forEach(evt => {
    methodCounts[evt.cleaningMethod] = (methodCounts[evt.cleaningMethod] || 0) + 1;
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

/* ------------ Login/Logout UI ------------ */

async function handleLogin(event) {
  event.preventDefault();
  
  const usernameInput = safeGet('login-username');
  const passwordInput = safeGet('login-password');
  const errorDiv = safeGet('login-error');
  const submitBtn = safeGet('login-submit');
  const btnText = submitBtn.querySelector('.btn-text');
  const btnLoader = submitBtn.querySelector('.btn-loader');
  
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  
  if (!username || !password) {
    errorDiv.textContent = 'Please enter username and password';
    errorDiv.classList.remove('hidden');
    return;
  }
  
  // Show loading state
  btnText.classList.add('hidden');
  btnLoader.classList.remove('hidden');
  btnLoader.classList.add('inline');
  submitBtn.disabled = true;
  errorDiv.classList.add('hidden');
  
  try {
    const res = await fetch('api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    
    const data = await res.json();
    
    if (res.ok) {
      saveSession(data.token, { username: data.username, role: data.role });
      showApp();
    } else {
      errorDiv.textContent = data.error || 'Login failed';
      errorDiv.classList.remove('hidden');
    }
  } catch (err) {
    console.error('Login error:', err);
    errorDiv.textContent = 'Connection error. Please try again.';
    errorDiv.classList.remove('hidden');
  } finally {
    btnText.classList.remove('hidden');
    btnText.classList.add('inline');
    btnLoader.classList.add('hidden');
    btnLoader.classList.remove('inline');
    submitBtn.disabled = false;
  }
}

async function handleLogout() {
  try {
    await fetch('api/logout', {
      method: 'POST',
      headers: getAuthHeaders()
    });
  } catch (err) {
    console.error('Logout error:', err);
  }
  
  clearSession();
  showLogin();
}

function showLogin() {
  window.scrollTo(0, 0);
  document.body.style.overflow = 'hidden';
  safeGet('login-page').classList.add('flex');
  safeGet('login-page').classList.remove('hidden');
  safeGet('app-container').classList.add('hidden');
  
  // Clear form
  const usernameInput = safeGet('login-username');
  const passwordInput = safeGet('login-password');
  const errorDiv = safeGet('login-error');
  
  if (usernameInput) usernameInput.value = '';
  if (passwordInput) passwordInput.value = '';
  if (errorDiv) errorDiv.classList.add('hidden');
}

function showApp() {
  window.scrollTo(0, 0);
  document.body.style.overflow = 'auto';
  const loginPage = safeGet('login-page');
  if (loginPage) {
    loginPage.classList.add('hidden');
    loginPage.classList.remove('flex');
  }
  safeGet('app-container').classList.remove('hidden');
  
  // Update user display
  const userDisplayName = safeGet('user-display-name');
  const userRoleBadge = safeGet('user-role-badge');
  
  if (userDisplayName && currentUser) {
    userDisplayName.textContent = currentUser.username;
  }
  
  if (userRoleBadge && currentUser) {
    userRoleBadge.textContent = currentUser.role === 'admin' ? 'Administrator' : 'Viewer';
    userRoleBadge.className = `user-role-badge ${currentUser.role === 'admin' ? 'admin' : 'viewer'}`;
  }
  
  // Update UI based on role
  updateUIForRole();
  
  // Initialize app
  initApp();
}

function updateUIForRole() {
  const isAdminUser = isAdmin();
  
  // Hide/show admin-only elements
  const adminOnlyElements = document.querySelectorAll('.admin-only');
  adminOnlyElements.forEach(el => {
    el.classList.toggle('hidden', !isAdminUser);
  });
  
  // Disable buttons for viewers
  const editDeleteBtns = document.querySelectorAll('.btn-edit, .btn-delete');
  editDeleteBtns.forEach(btn => {
    btn.classList.toggle('hidden', !isAdminUser);
  });
  
  // Hide action column header for viewers
  const actionHeaders = document.querySelectorAll('th:last-child');
  // We'll handle this in renderLog instead
  
  // Show/hide manual entry section, clear all button, etc.
  const btnClearAll = safeGet('btn-clear-all');
  if (btnClearAll) btnClearAll.classList.toggle('hidden', !isAdminUser);
  
  const btnSaveConfig = safeGet('btn-save-config');
  if (btnSaveConfig) btnSaveConfig.classList.toggle('hidden', !isAdminUser);
  
  const btnAddEvent = safeGet('btn-add-event');
  if (btnAddEvent) btnAddEvent.classList.toggle('hidden', !isAdminUser);
  
  // Disable config inputs for viewers
  const configInputs = document.querySelectorAll('#cfg-numCables, #cfg-sectionsPerCable, #cfg-sectionLength, #cfg-moduleFrequency, #cfg-channelsPerSection, #cfg-useRopeForTail');
  configInputs.forEach(input => {
    input.disabled = !isAdminUser;
  });
  
  // Disable manual entry inputs for viewers
  const manualEntryInputs = document.querySelectorAll('#evt-streamer, #evt-start, #evt-end, #evt-method, #evt-date, #evt-time');
  manualEntryInputs.forEach(input => {
    input.disabled = !isAdminUser;
  });
  
  // Project management buttons and inputs
  const btnCreateProject = safeGet('btn-create-project');
  if (btnCreateProject) btnCreateProject.classList.toggle('hidden', !isAdminUser);
  
  const btnActivateProject = safeGet('btn-activate-project');
  if (btnActivateProject) btnActivateProject.classList.toggle('hidden', !isAdminUser);
  
  const btnClearProject = safeGet('btn-clear-project');
  if (btnClearProject && isAdminUser) {
    // Only show if there's an active project
    const activeProject = projects.find(p => p.isActive === true);
    btnClearProject.classList.toggle('hidden', !activeProject);
  } else if (btnClearProject) {
    btnClearProject.classList.add('hidden');
  }
  
  // Disable project creation inputs for viewers
  const projectInputs = document.querySelectorAll('#new-project-number, #new-project-name, #new-project-vessel');
  projectInputs.forEach(input => {
    input.disabled = !isAdminUser;
  });
}

function setupPasswordToggle() {
  const toggle = safeGet('password-toggle');
  const passwordInput = safeGet('login-password');
  
  if (toggle && passwordInput) {
    toggle.addEventListener('click', () => {
      if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        toggle.textContent = '🙈';
      } else {
        passwordInput.type = 'password';
        toggle.textContent = '👁️';
      }
    });
  }
}

/* ------------ Config API ------------ */

async function loadConfig() {
  try {
    const res = await fetch('api/config');
    const data = await res.json();
    config = data;
    document.documentElement.style.setProperty('--sections', config.sectionsPerCable);
    populateConfigForm(config);
    updateConfigProjectLabel();
  } catch (err) {
    console.error(err);
  }
}

// Populate configuration form from config object
function populateConfigForm(cfg) {
  safeGet('cfg-numCables').value = cfg.numCables;
  safeGet('cfg-sectionsPerCable').value = cfg.sectionsPerCable;
  safeGet('cfg-sectionLength').value = cfg.sectionLength;
  safeGet('cfg-moduleFrequency').value = cfg.moduleFrequency;
  safeGet('cfg-channelsPerSection').value = cfg.channelsPerSection;
  safeGet('cfg-useRopeForTail').value = cfg.useRopeForTail;
}

// Update the label showing which project the config belongs to
function updateConfigProjectLabel() {
  const label = safeGet('config-project-label');
  if (!label) return;
  
  const activeProject = projects.find(p => p.isActive);
  if (activeProject) {
    label.textContent = `(for ${activeProject.projectNumber})`;
  } else {
    label.textContent = '(global defaults)';
  }
}

// Get current config values from form
function getConfigFromForm() {
  return {
    numCables: parseInt(safeGet('cfg-numCables').value, 10),
    sectionsPerCable: parseInt(safeGet('cfg-sectionsPerCable').value, 10),
    sectionLength: parseInt(safeGet('cfg-sectionLength').value, 10),
    moduleFrequency: parseInt(safeGet('cfg-moduleFrequency').value, 10),
    channelsPerSection: parseInt(safeGet('cfg-channelsPerSection').value, 10),
    useRopeForTail: safeGet('cfg-useRopeForTail').value === 'true',
  };
}

async function saveConfig() {
  const statusEl = safeGet('config-status');
  
  if (!isAdmin()) {
    setStatus(statusEl, 'Admin access required', true);
    return;
  }
  
  // Find active project
  const activeProject = projects.find(p => p.isActive);
  
  if (activeProject) {
    // Save to active project
    await saveProjectConfig(activeProject.id);
  } else {
    // Save to global config (legacy behavior)
    await saveGlobalConfig();
  }
}

// Save configuration to a specific project
async function saveProjectConfig(projectId) {
  const statusEl = safeGet('config-status');
  
  try {
    const formConfig = getConfigFromForm();
    const activeProject = projects.find(p => p.id === projectId);
    
    const body = {
      projectName: activeProject?.projectName || null,
      vesselTag: activeProject?.vesselTag || 'TTN',
      ...formConfig
    };

    const res = await fetch(`api/projects/${projectId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });

    if (res.status === 401 || res.status === 403) {
      setStatus(statusEl, 'Admin access required', true);
      return;
    }
    
    if (!res.ok) throw new Error('Failed to save config');

    const updated = await res.json();
    
    // Update local config to reflect changes
    config.numCables = updated.numCables;
    config.sectionsPerCable = updated.sectionsPerCable;
    config.sectionLength = updated.sectionLength;
    config.moduleFrequency = updated.moduleFrequency;
    config.channelsPerSection = updated.channelsPerSection;
    config.useRopeForTail = updated.useRopeForTail;
    
    document.documentElement.style.setProperty('--sections', config.sectionsPerCable);
    setStatus(statusEl, `✅ Configuration saved for ${updated.projectNumber}`);
    
    // Refresh projects list to update stored config
    await loadProjects();
    await refreshEverything();
    await renderHeatmap();
    await refreshStatsFiltered();
  } catch (err) {
    console.error(err);
    setStatus(statusEl, 'Failed to save config', true);
  }
}

// Save to global config (when no project is active)
async function saveGlobalConfig() {
  const statusEl = safeGet('config-status');
  
  try {
    const body = {
      numCables: parseInt(safeGet('cfg-numCables').value, 10),
      sectionsPerCable: parseInt(safeGet('cfg-sectionsPerCable').value, 10),
      sectionLength: parseInt(safeGet('cfg-sectionLength').value, 10),
      moduleFrequency: parseInt(safeGet('cfg-moduleFrequency').value, 10),
      channelsPerSection: parseInt(safeGet('cfg-channelsPerSection').value, 10),
      useRopeForTail: safeGet('cfg-useRopeForTail').value === 'true',
    };

    const res = await fetch('api/config', {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });

    if (res.status === 401 || res.status === 403) {
      setStatus(statusEl, 'Admin access required', true);
      return;
    }
    
    if (!res.ok) throw new Error('Failed to save config');

    const data = await res.json();
    config = data;
    document.documentElement.style.setProperty('--sections', config.sectionsPerCable);
    setStatus(statusEl, '✅ Global configuration updated');

    await refreshEverything();
    await renderHeatmap();
    await refreshStatsFiltered();
  } catch (err) {
    console.error(err);
    setStatus(statusEl, 'Failed to save config', true);
  }
}

/* ------------ Project API ------------ */

let projectEventCounts = {};

async function loadProjects() {
  try {
    // Load projects and event counts in parallel
    const [projectsRes, statsRes] = await Promise.all([
      fetch('api/projects'),
      fetch('api/projects/stats')
    ]);
    
    projects = await projectsRes.json();
    projectEventCounts = await statsRes.json();
    
    renderProjectList();
    populateProjectSelector();
    updateActiveProjectBanner();
    updateConfigProjectLabel();
  } catch (err) {
    console.error('Failed to load projects:', err);
  }
}

async function createProject() {
  const statusEl = safeGet('project-status');
  
  if (!isAdmin()) {
    setStatus(statusEl, 'Admin access required', true);
    return;
  }
  
  const projectNumber = safeGet('new-project-number').value.trim();
  const projectName = safeGet('new-project-name').value.trim();
  const vesselTag = safeGet('new-project-vessel').value.trim() || 'TTN';
  
  if (!projectNumber) {
    setStatus(statusEl, 'Project number is required', true);
    return;
  }
  
  // Get current config values to use as defaults for new project
  const currentConfig = getConfigFromForm();
  
  try {
    const res = await fetch('api/projects', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        projectNumber: projectNumber,
        projectName: projectName,
        vesselTag: vesselTag,
        // Include current streamer config as defaults for the new project
        ...currentConfig
      })
    });
    
    if (res.status === 401 || res.status === 403) {
      setStatus(statusEl, 'Admin access required', true);
      return;
    }
    
    const data = await res.json();
    
    if (!res.ok) {
      setStatus(statusEl, data.error || 'Failed to create project', true);
      return;
    }
    
    // Clear inputs
    safeGet('new-project-number').value = '';
    safeGet('new-project-name').value = '';
    safeGet('new-project-vessel').value = 'TTN';
    
    setStatus(statusEl, '✅ Project created with current configuration');
    await loadProjects();
  } catch (err) {
    console.error(err);
    setStatus(statusEl, 'Failed to create project', true);
  }
}

async function activateProject(projectId) {
  if (!isAdmin()) {
    showAccessDeniedToast('activate project');
    return;
  }
  
  try {
    const res = await fetch(`api/projects/${projectId}/activate`, {
      method: 'PUT',
      headers: getAuthHeaders()
    });
    
    if (!res.ok) throw new Error('Failed');
    
    const project = await res.json();
    
    // Update config with the project's streamer configuration
    if (project) {
      config.numCables = project.numCables;
      config.sectionsPerCable = project.sectionsPerCable;
      config.sectionLength = project.sectionLength;
      config.moduleFrequency = project.moduleFrequency;
      config.channelsPerSection = project.channelsPerSection;
      config.useRopeForTail = project.useRopeForTail;
      config.vesselTag = project.vesselTag;
      config.activeProjectNumber = project.projectNumber;
      selectedProjectFilter = project.projectNumber;
      
      // Update CSS variable and form
      document.documentElement.style.setProperty('--sections', config.sectionsPerCable);
      populateConfigForm(config);
    }
    
    await loadProjects();
    updateActiveProjectBanner();
    updateConfigProjectLabel();
    
    showSuccessToast('Project Activated', `Streamer configuration loaded for ${project.projectNumber}. All new events will be associated with this project.`);
    
    // Refresh UI with new config
    await refreshEverything();
    await renderHeatmap();
    await refreshStatsFiltered();
  } catch (err) {
    console.error(err);
    showErrorToast('Activation Failed', 'Failed to activate project.');
  }
}

async function activateSelectedProject() {
  const selector = safeGet('project-selector');
  const projectNumber = selector.value;
  
  if (!projectNumber) {
    // Clear active project
    await clearActiveProject();
    return;
  }
  
  const project = projects.find(p => p.projectNumber === projectNumber);
  if (project) {
    await activateProject(project.id);
  }
}

async function clearActiveProject() {
  if (!isAdmin()) {
    showAccessDeniedToast('clear active project');
    return;
  }
  
  try {
    const res = await fetch('api/projects/deactivate', {
      method: 'POST',
      headers: getAuthHeaders()
    });
    
    if (!res.ok) throw new Error('Failed');
    
    // Reset to global config
    await loadConfig();
    await loadProjects();
    selectedProjectFilter = null;
    updateActiveProjectBanner();
    updateConfigProjectLabel();
    
    showSuccessToast('Project Cleared', 'Using global configuration. New events will not be associated with any project.');
    
    // Refresh UI
    await refreshEverything();
    await renderHeatmap();
    await refreshStatsFiltered();
  } catch (err) {
    console.error(err);
    showErrorToast('Failed', 'Failed to clear active project.');
  }
}

async function deleteProject(projectId) {
  if (!isAdmin()) {
    showAccessDeniedToast('delete project');
    return;
  }
  
  if (!confirm('Are you sure you want to delete this project? This cannot be undone.')) {
    return;
  }
  
  try {
    const res = await fetch(`api/projects/${projectId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    
    const data = await res.json();
    
    if (!res.ok) {
      showErrorToast('Cannot Delete', data.error || 'Failed to delete project.');
      return;
    }
    
    showSuccessToast('Project Deleted', 'The project has been removed.');
    await loadProjects();
  } catch (err) {
    console.error(err);
    showErrorToast('Delete Failed', 'Failed to delete project.');
  }
}

function renderProjectList() {
  const container = safeGet('project-list');
  if (!container) return;
  
  if (projects.length === 0) {
    container.innerHTML = '<p style="color: #6b7280; font-size: 13px;">No projects created yet.</p>';
    return;
  }
  
  const isAdminUser = isAdmin();
  
  container.innerHTML = projects.map(p => {
    const isActive = p.isActive === true;
    const eventCount = projectEventCounts[p.projectNumber] || 0;
    const eventCountBadge = `<span class="project-event-count" title="Events in this project">${eventCount} events</span>`;
    const activeBadge = isActive ? '<span class="badge badge-active">Active</span>' : '';
    const deleteBtn = isAdminUser && !isActive && eventCount === 0 ? 
      `<button class="btn btn-outline btn-sm btn-delete-project" data-id="${p.id}" title="Delete project">🗑️</button>` : '';
    
    return `
      <div class="project-item ${isActive ? 'active' : ''}">
        <div class="project-item-info">
          <span class="project-number">${p.projectNumber}</span>
          ${p.projectName ? `<span class="project-name">${p.projectName}</span>` : ''}
          <span class="project-vessel">${p.vesselTag || 'TTN'}</span>
          ${eventCountBadge}
          ${activeBadge}
        </div>
        <div class="project-item-actions">
          ${deleteBtn}
        </div>
      </div>
    `;
  }).join('');
  
  // Attach delete listeners
  container.querySelectorAll('.btn-delete-project').forEach(btn => {
    btn.addEventListener('click', () => deleteProject(parseInt(btn.dataset.id)));
  });
}

function populateProjectSelector() {
  const selector = safeGet('project-selector');
  if (!selector) return;
  
  // Keep the first option (All Projects)
  selector.innerHTML = '<option value="">-- All Projects (No Filter) --</option>';
  
  projects.forEach(p => {
    const option = document.createElement('option');
    option.value = p.projectNumber;
    option.textContent = p.projectName ? `${p.projectNumber} - ${p.projectName}` : p.projectNumber;
    if (p.isActive === true) {
      option.textContent += ' (Active)';
    }
    selector.appendChild(option);
  });
  
  // Set current selection to active project
  const activeProject = projects.find(p => p.isActive === true);
  if (activeProject) {
    selector.value = activeProject.projectNumber;
  }
}

function updateActiveProjectBanner() {
  const banner = safeGet('active-project-banner');
  const nameEl = safeGet('active-project-name');
  const vesselEl = safeGet('active-project-vessel');
  const clearBtn = safeGet('btn-clear-project');
  
  if (!banner || !nameEl) return;
  
  const activeProject = projects.find(p => p.isActive === true);
  
  if (activeProject) {
    nameEl.textContent = activeProject.projectName 
      ? `${activeProject.projectNumber} - ${activeProject.projectName}`
      : activeProject.projectNumber;
    vesselEl.textContent = `[${activeProject.vesselTag || 'TTN'}]`;
    banner.classList.add('has-project');
    if (clearBtn && isAdmin()) clearBtn.classList.remove('hidden');
  } else {
    nameEl.textContent = 'No project selected';
    vesselEl.textContent = '';
    banner.classList.remove('has-project');
    if (clearBtn) clearBtn.classList.add('hidden');
  }
}

function setProjectFilter(projectNumber) {
  selectedProjectFilter = projectNumber || null;
  refreshEverything();
  renderHeatmap();
  refreshStatsFiltered();
}

/* ------------ Backup Management API ------------ */

async function loadBackups() {
  const container = safeGet('backup-list');
  if (!container) return;
  
  if (!isAdmin()) {
    container.innerHTML = '';
    return;
  }
  
  try {
    const res = await fetch('api/backups', {
      headers: getAuthHeaders()
    });
    
    if (!res.ok) {
      container.innerHTML = '<div class="backup-empty">Unable to load backups</div>';
      return;
    }
    
    const data = await res.json();
    const backups = data.backups || [];
    
    if (backups.length === 0) {
      container.innerHTML = '<div class="backup-empty">No backups available yet. Backups are created automatically every 12 hours.</div>';
      return;
    }
    
    container.innerHTML = backups.map(backup => {
      const date = new Date(backup.createdAt);
      const formattedDate = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
      const sizeKB = (backup.size / 1024).toFixed(1);
      
      return `
        <div class="backup-item">
          <div class="backup-item-info">
            <span class="backup-filename">${backup.filename}</span>
            <div class="backup-meta">
              <span>📅 ${formattedDate}</span>
              <span>📦 ${sizeKB} KB</span>
            </div>
          </div>
          <div class="backup-item-actions">
            <button class="btn btn-sm btn-restore" data-filename="${backup.filename}" title="Restore this backup">
              🔄 Restore
            </button>
          </div>
        </div>
      `;
    }).join('');
    
    // Attach restore listeners
    container.querySelectorAll('.btn-restore').forEach(btn => {
      btn.addEventListener('click', () => restoreBackup(btn.dataset.filename));
    });
    
  } catch (err) {
    console.error('Failed to load backups:', err);
    container.innerHTML = '<div class="backup-empty">Error loading backups</div>';
  }
}

async function createBackup() {
  const statusEl = safeGet('backup-status');
  
  if (!isAdmin()) {
    showAccessDeniedToast('create backups');
    return;
  }
  
  try {
    setStatus(statusEl, 'Creating backup...', false);
    
    const res = await fetch('api/backups', {
      method: 'POST',
      headers: getAuthHeaders()
    });
    
    if (!res.ok) throw new Error('Failed');
    
    setStatus(statusEl, '✅ Backup created successfully');
    showSuccessToast('Backup Created', 'Database backup has been created successfully.');
    await loadBackups();
  } catch (err) {
    console.error(err);
    setStatus(statusEl, 'Failed to create backup', true);
    showErrorToast('Backup Failed', 'Failed to create backup. Please try again.');
  }
}

async function restoreBackup(filename) {
  if (!isAdmin()) {
    showAccessDeniedToast('restore backups');
    return;
  }
  
  const confirmed = confirm(
    `⚠️ WARNING: Restoring from backup will replace ALL current data!\n\n` +
    `This will:\n` +
    `• Create a backup of the current database first\n` +
    `• Replace the database with the selected backup\n` +
    `• Require a server restart to take effect\n\n` +
    `Are you sure you want to restore from:\n${filename}?`
  );
  
  if (!confirmed) return;
  
  const statusEl = safeGet('backup-status');
  
  try {
    setStatus(statusEl, 'Restoring backup...', false);
    
    const res = await fetch(`api/backups/${encodeURIComponent(filename)}/restore`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    
    const data = await res.json();
    
    if (!res.ok) {
      throw new Error(data.error || 'Failed to restore');
    }
    
    setStatus(statusEl, '✅ Backup restored');
    showSuccessToast(
      'Restore Successful', 
      'Database has been restored. Please restart the server for changes to take full effect.'
    );
    
    // Reload backups and refresh data
    await loadBackups();
    await refreshEverything();
    await renderHeatmap();
    await refreshStatsFiltered();
    
  } catch (err) {
    console.error(err);
    setStatus(statusEl, 'Failed to restore backup', true);
    showErrorToast('Restore Failed', err.message || 'Failed to restore backup. Please try again.');
  }
}

/* ------------ Events API ------------ */

async function loadEvents() {
  let url = 'api/events';
  if (selectedProjectFilter) {
    url += `?project=${encodeURIComponent(selectedProjectFilter)}`;
  }
  const res = await fetch(url);
  events = await res.json();
}

async function addEvent() {
  const statusEl = safeGet("event-status");
  if (!isAdmin()) {
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
    const cableId = `cable-${streamerNum - 1}`;

    const body = {
      cableId: cableId,
      sectionIndexStart: actualStart,
      sectionIndexEnd: actualEnd,
      cleaningMethod: method,
      cleanedAt: datetimeIso,
      cleaningCount: 1,
    };

    const res = await fetch('api/events', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });

    if (res.status === 401 || res.status === 403) {
      setStatus(statusEl, 'Admin access required', true);
      return;
    }
    
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
  const cableIndex = parseInt(evt.cableId.split('-')[1], 10);
  const streamerNum = cableIndex + 1;

  safeGet('delete-event-id').value = evt.id;
  safeGet('delete-streamer-display').textContent = streamerNum;
  safeGet('delete-range-display').textContent = `${formatAS(evt.sectionIndexStart)} – ${formatAS(evt.sectionIndexEnd)}`;
  safeGet('delete-eb-display').textContent = await getEBRange(evt.sectionIndexStart, evt.sectionIndexEnd);
  safeGet('delete-method-display').textContent = evt.cleaningMethod;
  safeGet('delete-date-display').textContent = formatDateTime(evt.cleanedAt);
  safeGet('delete-distance-display').textContent = `${eventDistance(evt)} m`;

  safeGet('delete-modal').classList.add('show');
}

function closeDeleteModal() {
  safeGet('delete-modal').classList.remove('show');
}

async function confirmDeleteEvent() {
  if (!isAdmin()) {
    showAccessDeniedToast('delete events');
    return;
  }
  
  const id = parseInt(safeGet('delete-event-id').value);
  
  try {
    const res = await fetch(`api/events/${id}`, { 
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    
    if (res.status === 401 || res.status === 403) {
      showAccessDeniedToast('delete events');
      return;
    }
    
    if (!res.ok) throw new Error('Failed');

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

  const cableIndex = parseInt(evt.cableId.split('-')[1] || 0, 10);
  const streamerNum = cableIndex + 1;

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
  const cableId = `cable-${streamerNum - 1}`;
  const datetimeIso = new Date(`${dateVal}T${timeVal}`).toISOString();

  const body = {
    cableId: cableId,
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
  if (!isAdmin()) {
    showAccessDeniedToast('edit events');
    return;
  }
  
  try {
    const res = await fetch(`api/events/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });

    if (res.status === 401 || res.status === 403) {
      showAccessDeniedToast('edit events');
      return;
    }
    
    if (!res.ok) throw new Error('Failed');

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
  if (!isAdmin()) {
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
    
    const res = await fetch(url, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    
    if (res.status === 401 || res.status === 403) {
      showAccessDeniedToast('clear all events');
      closeClearAllModal();
      return;
    }
    
    if (!res.ok) throw new Error('Failed');
    
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

  const header = 'Streamer Number,First Section,Last Section,Cleaning Method,Date & Time,Project Number,Vessel Tag';
  const rows = [header];

  events.forEach(evt => {
    const streamerNum = toStreamerNum(evt.cableId);
    const startSection = evt.sectionIndexStart + 1;
    const endSection = evt.sectionIndexEnd + 1;
    const dateStr = new Date(evt.cleanedAt).toISOString();
    const projectNum = evt.projectNumber || '';
    const vesselTag = evt.vesselTag || 'TTN';
    rows.push(`${streamerNum},${startSection},${endSection},${evt.cleaningMethod},"${dateStr}","${projectNum}","${vesselTag}"`);
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
  return line.split(regex).map(p => p.trim().replace(/^"|"$/g, ''));
}

async function handleCsvFile(file) {
  if (!isAdmin()) {
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
      // Optional: project_number and vessel_tag from CSV (columns 5 and 6)
      const projectNumber = parts[5] ? parts[5].replace(/"/g, '').trim() : null;
      const vesselTag = parts[6] ? parts[6].replace(/"/g, '').trim() : 'TTN';

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
        cableId: cableId,
        sectionIndexStart: actualStart,
        sectionIndexEnd: actualEnd,
        cleaningMethod: method,
        cleanedAt: dateObj.toISOString(),
        cleaningCount: 1,
        projectNumber: projectNumber,
        vesselTag: vesselTag,
      };

      try {
        const res = await fetch('api/events', {
          method: 'POST',
          headers: getAuthHeaders(),
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
  
  const isAdminUser = isAdmin();

  // Fetch all EB ranges in parallel for performance
  const ebRangePromises = events.map(evt => 
    getEBRange(evt.sectionIndexStart, evt.sectionIndexEnd)
  );
  const ebRanges = await Promise.all(ebRangePromises);

  events.forEach((evt, idx) => {
    const tr = document.createElement('tr');
    const streamerNum = toStreamerNum(evt.cableId);
    const rangeLabel = `${formatAS(evt.sectionIndexEnd)}–${formatAS(evt.sectionIndexStart)}`;
    const ebRange = ebRanges[idx];
    const distance = eventDistance(evt);
    const projectDisplay = evt.projectNumber || '<span style="color:#9ca3af">—</span>';
    const vesselDisplay = evt.vesselTag || 'TTN';

    const actionButtons = isAdminUser 
      ? `<button class="btn btn-outline btn-edit" data-id="${evt.id}">✏️</button>
         <button class="btn btn-outline btn-delete" data-id="${evt.id}">🗑️</button>`
      : '<span class="view-only-badge">View Only</span>';

    tr.innerHTML = `
      <td>${formatDateTime(evt.cleanedAt)}</td>
      <td>${projectDisplay}</td>
      <td>${vesselDisplay}</td>
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
    let url = 'api/last-cleaned';
    if (selectedProjectFilter) {
      url += `?project=${encodeURIComponent(selectedProjectFilter)}`;
    }
    const res = await fetch(url);
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
    // Add project filter to API call
    let url = 'api/last-cleaned';
    if (selectedProjectFilter) {
      url += `?project=${encodeURIComponent(selectedProjectFilter)}`;
    }
    const res = await fetch(url);
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
      let filteredEvents = events.filter(evt => evt.cableId === cableId);

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
    let url = 'api/last-cleaned';
    if (selectedProjectFilter) {
      url += `?project=${encodeURIComponent(selectedProjectFilter)}`;
    }
    const res = await fetch(url);
    const data = await res.json();
    const lastCleaned = data.lastCleaned;

    const N = config.sectionsPerCable;
    const cableCount = config.numCables;
    const moduleFreq = config.moduleFrequency;
    const channelsPerSection = config.channelsPerSection;
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
    const streamerInput = safeGet('modal-streamer');
  const startInput = safeGet('modal-start');
  const endInput = safeGet('modal-end');
  const methodSelect = safeGet('modal-method');
  
  // Calculate the TRUE max section including tails from current config
  const totalSections = getSectionsPerCableWithTail(config);
  
  // Set max attributes based on ACTUAL config (not validation)
  streamerInput.max = config.numCables;
  startInput.min = 1;
  startInput.max = totalSections;  // ✅ Use calculated value, not validation
  endInput.min = 1;
  endInput.max = totalSections;    // ✅ Use calculated value, not validation
  
  // Set values WITHOUT clamping or validation
  streamerInput.value = streamerNum;
  startInput.value = min + 1;  // Convert 0-based to 1-based
  endInput.value = max + 1;    // Convert 0-based to 1-based
  methodSelect.value = selectedMethod;
  
  updateModalSummary();
  safeGet('confirmation-modal').classList.add('show');
  
  // Update summary when inputs change
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
  if (!isAdmin()) {
    showAccessDeniedToast('add cleaning events');
    closeConfirmationModal();
    return;
  }
  
  isFinalizing = true;
  
  const streamerNum = parseInt(safeGet('modal-streamer').value, 10);
  const startSection = parseInt(safeGet('modal-start').value, 10);
  const endSection = parseInt(safeGet('modal-end').value, 10);
  const method = safeGet('modal-method').value;
  
  // Get active project for validation
  const activeProject = projects.find(p => p.isActive);
  const projectNumber = activeProject ? activeProject.projectNumber : null;
  
  // Use unified validation WITH project number
  const validation = validateStreamerAndSections(streamerNum, startSection, endSection, projectNumber);
  if (!validation.valid) {
    showErrorToast('Out of Range', validation.message);
    isFinalizing = false;
    return;
  }
  
  // Convert to 0-based indices
  const actualStart = Math.min(startSection, endSection) - 1;
  const actualEnd = Math.max(startSection, endSection) - 1;
  const cableId = `cable-${streamerNum - 1}`;
  
  try {
    const now = new Date().toISOString();
    const body = {
      cableId: cableId,                    
      sectionIndexStart: actualStart,     
      sectionIndexEnd: actualEnd,         
      cleaningMethod: method,              
      cleanedAt: now,                      
      cleaningCount: 1,                    
      projectNumber: projectNumber         
    };
    
    const res = await fetch('/api/events', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });
    
    if (res.status === 401 || res.status === 403) {
      showAccessDeniedToast('add cleaning events');
      closeConfirmationModal();
      isFinalizing = false;
      return;
    }
    
    if (!res.ok) throw new Error('Failed to save');
    
    // Success
    closeConfirmationModal();
    await refreshEverything();
    await renderHeatmap();
    await refreshStatsFiltered();
  } catch (err) {
    console.error(err);
    showErrorToast('Save Failed', 'Failed to save cleaning event. Please try again.');
  } finally {
    isFinalizing = false;
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
    const statsRes = await fetch(`/api/stats?${statsParams}`);
    const overallStats = await statsRes.json();
    
    // Prepare filtered query params
    let params = new URLSearchParams();
    if (startDate) params.append('start', startDate);
    if (endDate) params.append('end', endDate);
    if (selectedProjectFilter) params.append('project', selectedProjectFilter);
    
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
        valA = toStreamerNum(a.cableId);
        valB = toStreamerNum(b.cableId);
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
      default:
        return 0;
    }

    if (valA < valB) return sortState.ascending ? -1 : 1;
    if (valA > valB) return sortState.ascending ? 1 : -1;
    return 0;
  });

  events = sortedEvents;
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
  safeGet('btn-create-project')?.addEventListener('click', createProject);
  safeGet('btn-activate-project')?.addEventListener('click', activateSelectedProject);
  safeGet('btn-clear-project')?.addEventListener('click', clearActiveProject);
  
  // Project selector change event (for filtering)
  safeGet('project-selector')?.addEventListener('change', (e) => {
    setProjectFilter(e.target.value);
  });
  
  // Backup management
  safeGet('btn-create-backup')?.addEventListener('click', createBackup);
  safeGet('btn-refresh-backups')?.addEventListener('click', loadBackups);

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
  await loadConfig();
  if (config.activeProjectNumber) {
    selectedProjectFilter = config.activeProjectNumber;
  }
  await loadProjects();
  updateActiveProjectBanner();
  await loadBackups();
  await refreshEverything();
  await renderHeatmap();
  await refreshStatsFiltered();

  // Set default date/time for manual entry
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toTimeString().slice(0, 5);
  const evtDate = safeGet('evt-date');
  const evtTime = safeGet('evt-time');
  if (evtDate) evtDate.value = dateStr;
  if (evtTime) evtTime.value = timeStr;

  setupEventListeners();
  setupSidebarNavigation();
  setupProjectCollapse();
  
  // Update UI based on role after everything is loaded
  updateUIForRole();
  
  if (typeof initPDFGeneration === 'function') {
    initPDFGeneration();
  }  
}

async function init() {
  // Setup login form handler
  const loginForm = safeGet('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
  }
  
  // Setup logout button
  const logoutBtn = safeGet('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleLogout);
  }
  
  // Setup password toggle
  setupPasswordToggle();
  
  // Check if user has a valid session
  if (loadSession()) {
    const isValid = await validateSession();
    if (isValid) {
      showApp();
      return;
    }
  }
  
  // No valid session, show login
  showLogin();
}

init();
