/**
 * DOM helpers, toasts, and shared UI utilities.
 */

export function safeGet(id) {
  const el = document.getElementById(id);
  if (!el) console.warn(`[UI] Element #${id} not found`);
  return el;
}

export function setStatus(el, msg, isError = false) {
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("status-error", isError);
  el.classList.toggle("status-info", !isError);
  if (msg) setTimeout(() => { el.textContent = ""; }, 4000);
}

export function showToast(type, title, message, duration = 5000) {
  const container = document.getElementById("toast-container");
  if (!container) return null;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const icons = {
    error: "🚫",
    warning: "⚠️",
    success: "✅",
    info: "ℹ️",
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

  const closeBtn = toast.querySelector(".toast-close");
  closeBtn.addEventListener("click", () => dismissToast(toast));

  container.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => dismissToast(toast), duration);
  }

  return toast;
}

export function dismissToast(toast) {
  if (!toast || toast.classList.contains("toast-exit")) return;

  toast.classList.add("toast-exit");
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 300);
}

export function showErrorToast(title, message) {
  return showToast("error", title, message);
}

export function showWarningToast(title, message) {
  return showToast("warning", title, message);
}

export function showSuccessToast(title, message) {
  return showToast("success", title, message);
}

export function showInfoToast(title, message) {
  return showToast("info", title, message);
}

export function showAccessDeniedToast(action = "perform this action") {
  return showErrorToast(
    "Access Denied",
    `Administrator access required to ${action}. Please login with an admin account.`
  );
}

export function formatDateTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}
