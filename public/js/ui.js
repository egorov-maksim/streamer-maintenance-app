/**
 * DOM helpers, toasts, and shared UI utilities.
 */

let notyfInstance = null;

function getNotyf() {
  if (!window.Notyf) {
    console.warn("[UI] Notyf library not loaded");
    return null;
  }
  if (!notyfInstance) {
    notyfInstance = new window.Notyf({
      duration: 5000,
      dismissible: true,
      position: { x: "right", y: "top" },
      types: [
        { type: "success", background: "#059669" },
        { type: "error", background: "#dc2626" },
        { type: "warning", background: "#d97706" },
        { type: "info", background: "#2563eb" },
      ],
    });
  }
  return notyfInstance;
}

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
  const notyf = getNotyf();
  if (!notyf) return null;

  const text = message ? `${title}: ${message}` : title;

  return notyf.open({
    type,
    message: text,
    duration,
    className: `toast toast-${type}`,
  });
}

export function dismissToast(toastRef) {
  if (!toastRef) return;
  const notyf = getNotyf();
  if (notyf && typeof notyf.dismiss === "function") {
    notyf.dismiss(toastRef);
  }
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
