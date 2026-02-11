/**
 * Authentication: session, role checks, login/logout UI, showLogin/showApp, updateUIForRole.
 */

import {
  authToken,
  currentUser,
  projects,
  setAuthToken,
  setCurrentUser,
} from "./state.js";
import { apiCall, fetchSession } from "./api.js";
import { safeGet } from "./ui.js";

let onShowAppCallback = null;

export function setOnShowAppCallback(fn) {
  onShowAppCallback = fn;
}

export function saveSession(token, user) {
  setAuthToken(token);
  setCurrentUser(user);
  localStorage.setItem("authToken", token);
  localStorage.setItem("currentUser", JSON.stringify(user));
}

export function loadSession() {
  const token = localStorage.getItem("authToken");
  const userStr = localStorage.getItem("currentUser");
  if (token && userStr) {
    setAuthToken(token);
    setCurrentUser(JSON.parse(userStr));
    return true;
  }
  return false;
}

export function clearSession() {
  setAuthToken(null);
  setCurrentUser(null);
  localStorage.removeItem("authToken");
  localStorage.removeItem("currentUser");
}

export async function validateSession() {
  if (!authToken) return false;
  try {
    const data = await fetchSession();
    if (data) {
      setCurrentUser({ username: data.username, role: data.role });
      return true;
    }
    clearSession();
    return false;
  } catch (err) {
    console.error("Session validation failed:", err);
    clearSession();
    return false;
  }
}

export function isSuperUser() {
  return currentUser?.role === "superuser";
}

export function isAdminOrAbove() {
  return currentUser?.role === "admin" || currentUser?.role === "superuser";
}

export function isAdmin() {
  return currentUser?.role === "admin";
}

export function isViewer() {
  return currentUser?.role === "viewer";
}

export async function handleLogin(event) {
  event.preventDefault();

  const usernameInput = safeGet("login-username");
  const passwordInput = safeGet("login-password");
  const errorDiv = safeGet("login-error");
  const submitBtn = safeGet("login-submit");
  const btnText = submitBtn?.querySelector(".btn-text");
  const btnLoader = submitBtn?.querySelector(".btn-loader");

  const username = usernameInput?.value?.trim() || "";
  const password = passwordInput?.value || "";

  if (!username || !password) {
    if (errorDiv) {
      errorDiv.textContent = "Please enter username and password";
      errorDiv.classList.remove("hidden");
    }
    return;
  }

  if (btnText) btnText.classList.add("hidden");
  if (btnLoader) {
    btnLoader.classList.remove("hidden");
    btnLoader.classList.add("inline");
  }
  if (submitBtn) {
    submitBtn.disabled = true;
  }
  if (errorDiv) errorDiv.classList.add("hidden");

  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json();

    if (res.ok) {
      saveSession(data.token, { username: data.username, role: data.role });
      showApp();
    } else {
      if (errorDiv) {
        errorDiv.textContent = data.error || "Login failed";
        errorDiv.classList.remove("hidden");
      }
    }
  } catch (err) {
    console.error("Login error:", err);
    if (errorDiv) {
      errorDiv.textContent = "Connection error. Please try again.";
      errorDiv.classList.remove("hidden");
    }
  } finally {
    if (btnText) {
      btnText.classList.remove("hidden");
      btnText.classList.add("inline");
    }
    if (btnLoader) {
      btnLoader.classList.add("hidden");
      btnLoader.classList.remove("inline");
    }
    if (submitBtn) submitBtn.disabled = false;
  }
}

export async function handleLogout() {
  try {
    await apiCall("api/logout", { method: "POST" });
  } catch (err) {
    console.error("Logout error:", err);
  }
  clearSession();
  showLogin();
}

export function showLogin() {
  window.scrollTo(0, 0);
  document.body.style.overflow = "hidden";
  const loginPage = safeGet("login-page");
  const appContainer = safeGet("app-container");
  if (loginPage) {
    loginPage.classList.add("flex");
    loginPage.classList.remove("hidden");
  }
  if (appContainer) appContainer.classList.add("hidden");

  const usernameInput = safeGet("login-username");
  const passwordInput = safeGet("login-password");
  const errorDiv = safeGet("login-error");
  if (usernameInput) usernameInput.value = "";
  if (passwordInput) passwordInput.value = "";
  if (errorDiv) errorDiv.classList.add("hidden");
}

export function showApp() {
  window.scrollTo(0, 0);
  document.body.style.overflow = "auto";
  const loginPage = safeGet("login-page");
  const appContainer = safeGet("app-container");
  if (loginPage) {
    loginPage.classList.add("hidden");
    loginPage.classList.remove("flex");
  }
  if (appContainer) appContainer.classList.remove("hidden");

  const userDisplayName = safeGet("user-display-name");
  const userRoleBadge = safeGet("user-role-badge");
  if (userDisplayName && currentUser) {
    userDisplayName.textContent = currentUser.username;
  }
  if (userRoleBadge && currentUser) {
    userRoleBadge.textContent =
      currentUser.role === "admin" ? "Administrator" : "Viewer";
    userRoleBadge.className = `user-role-badge ${currentUser.role === "admin" ? "admin" : "viewer"}`;
  }

  updateUIForRole();
  if (typeof onShowAppCallback === "function") {
    onShowAppCallback();
  }
}

export function updateUIForRole() {
  const isSuperUserRole = isSuperUser();
  const isAdminRole = isAdminOrAbove();

  document.querySelectorAll(".superuser-only").forEach((el) =>
    el.classList.toggle("hidden", !isSuperUserRole)
  );

  document.querySelectorAll(".admin-only").forEach((el) =>
    el.classList.toggle("hidden", !isAdminRole)
  );

  document.querySelectorAll(".btn-edit, .btn-delete").forEach((btn) =>
    btn.classList.toggle("hidden", !isAdminRole)
  );

  const btnClearAll = safeGet("btn-clear-all");
  if (btnClearAll) btnClearAll.classList.toggle("hidden", !isSuperUserRole);

  const btnSaveConfig = safeGet("btn-save-config");
  if (btnSaveConfig) btnSaveConfig.classList.toggle("hidden", !isSuperUserRole);

  const btnAddEvent = safeGet("btn-add-event");
  if (btnAddEvent) btnAddEvent.classList.toggle("hidden", !isAdminRole);

  const configInputs = document.querySelectorAll(
    "#cfg-numCables, #cfg-sectionsPerCable, #cfg-sectionLength, #cfg-moduleFrequency, #cfg-channelsPerSection, #cfg-useRopeForTail"
  );
  configInputs.forEach((input) => {
    input.disabled = !isSuperUserRole;
  });

  const projectCommentsEl = safeGet("project-comments");
  if (projectCommentsEl) {
    const activeProject = projects.find((p) => p.isActive === true);
    projectCommentsEl.disabled = !isSuperUserRole || !activeProject;
  }

  const manualEntryInputs = document.querySelectorAll(
    "#evt-streamer, #evt-start, #evt-end, #evt-method, #evt-date, #evt-time"
  );
  manualEntryInputs.forEach((input) => {
    input.disabled = !isAdminRole;
  });

  const btnCreateProject = safeGet("btn-create-project");
  if (btnCreateProject) btnCreateProject.classList.toggle("hidden", !isSuperUserRole);

  const btnActivateProject = safeGet("btn-activate-project");
  if (btnActivateProject) btnActivateProject.classList.toggle("hidden", !isSuperUserRole);

  const btnClearProject = safeGet("btn-clear-project");
  if (btnClearProject) {
    if (isSuperUserRole) {
      const activeProject = projects.find((p) => p.isActive === true);
      btnClearProject.classList.toggle("hidden", !activeProject);
    } else {
      btnClearProject.classList.add("hidden");
    }
  }

  const projectInputs = document.querySelectorAll(
    "#new-project-number, #new-project-name, #new-project-vessel"
  );
  projectInputs.forEach((input) => {
    input.disabled = !isSuperUserRole;
  });

  const deploymentInputs = document.querySelectorAll(
    ".streamer-deploy-date, .streamer-coating-status"
  );
  deploymentInputs.forEach((input) => {
    input.disabled = !isSuperUserRole;
  });

  const roleBadge = safeGet("user-role-badge");
  if (roleBadge) {
    if (isSuperUserRole) {
      roleBadge.textContent = "Super User";
      roleBadge.className = "user-role-badge superuser";
    } else if (isAdminRole) {
      roleBadge.textContent = "Administrator";
      roleBadge.className = "user-role-badge admin";
    } else {
      roleBadge.textContent = "Viewer";
      roleBadge.className = "user-role-badge viewer";
    }
  }
}

export function setupPasswordToggle() {
  const toggle = safeGet("password-toggle");
  const passwordInput = safeGet("login-password");
  if (toggle && passwordInput) {
    toggle.addEventListener("click", () => {
      if (passwordInput.type === "password") {
        passwordInput.type = "text";
        toggle.textContent = "🙈";
      } else {
        passwordInput.type = "password";
        toggle.textContent = "👁️";
      }
    });
  }
}
