import { safeGet } from "./js/ui.js";
import {
  loadSession,
  validateSession,
  showLogin,
  showApp,
  handleLogin,
  handleLogout,
  setupPasswordToggle,
  setOnShowAppCallback,
} from "./js/auth.js";

async function initOverviewApp() {
  // TODO(Task 8): load /api/overview/vessels and /api/overview, render KPIs, charts and lists.
}

async function init() {
  setOnShowAppCallback(initOverviewApp);

  const loginForm = safeGet("login-form");
  if (loginForm) loginForm.addEventListener("submit", handleLogin);

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
