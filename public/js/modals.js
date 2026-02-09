/**
 * Generic modal helpers: open/close by id, Escape key to close topmost modal.
 */

import { safeGet } from "./ui.js";

export function openModal(modalId) {
  const el = safeGet(modalId);
  if (el) el.classList.add("show");
}

export function closeModal(modalId) {
  const el = safeGet(modalId);
  if (el) el.classList.remove("show");
}

/**
 * Bind Escape key to close the topmost visible modal.
 * Call once after DOM ready (e.g. from initApp).
 */
export function initModals() {
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const openModalEl = document.querySelector(".modal.show");
    if (openModalEl && openModalEl.id) {
      closeModal(openModalEl.id);
    }
  });
}
