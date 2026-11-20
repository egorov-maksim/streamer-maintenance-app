/**
 * Generic modal helpers: open/close by id, Escape key, focus trap.
 *
 * Focus trap lifecycle:
 *   openModal(id)  → trapFocus(el)  — moves focus in, intercepts Tab
 *   closeModal(id) → releaseFocusTrap() — removes handler, restores prior focus
 */

import { safeGet } from "./ui.js";

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

let trapKeyHandler = null;
let trapModalEl = null;
let previousFocus = null;

/**
 * Traps keyboard focus inside modalEl.
 * Saves document.activeElement so releaseFocusTrap() can restore it.
 * @param {HTMLElement} modalEl
 */
export function trapFocus(modalEl) {
  releaseFocusTrap();

  previousFocus = document.activeElement;
  trapModalEl = modalEl;

  const getFocusable = () =>
    Array.from(modalEl.querySelectorAll(FOCUSABLE_SELECTORS)).filter(
      (el) => el.offsetParent !== null && !el.closest('[hidden]')
    );

  // Move focus into the modal, unless the caller already placed it on a field inside.
  if (!modalEl.contains(document.activeElement)) {
    const focusable = getFocusable();
    if (focusable.length > 0) focusable[0].focus();
  }

  // Listen on the document so Tab is also caught when focus has slipped out of the modal
  // (for example after the focused button became disabled).
  trapKeyHandler = (e) => {
    if (e.key !== 'Tab') return;
    const nodes = getFocusable();
    if (nodes.length === 0) { e.preventDefault(); return; }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (!modalEl.contains(active)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  document.addEventListener('keydown', trapKeyHandler);
}

/**
 * Releases the current focus trap and returns focus to the element that
 * was active when the modal opened.
 */
export function releaseFocusTrap() {
  if (trapKeyHandler) {
    document.removeEventListener('keydown', trapKeyHandler);
  }
  trapKeyHandler = null;
  trapModalEl = null;

  if (previousFocus && typeof previousFocus.focus === 'function') {
    // If the trigger element was removed from the DOM while the modal was open,
    // fall back to body rather than silently calling focus on a detached node.
    if (document.contains(previousFocus)) {
      previousFocus.focus();
    } else {
      document.body.focus();
    }
  }
  previousFocus = null;
}

export function openModal(modalId) {
  const el = safeGet(modalId);
  if (!el) return;
  el.classList.add('show');
  trapFocus(el);
}

export function closeModal(modalId) {
  const el = safeGet(modalId);
  if (!el) return;
  el.classList.remove('show');
  releaseFocusTrap();
}

/**
 * Keeps the focus trap in step with every `.modal`, including the ones that are shown
 * and hidden by toggling the `show` class directly instead of calling openModal/closeModal.
 */
function watchModalVisibility() {
  if (typeof MutationObserver === 'undefined') return;
  const observer = new MutationObserver((mutations) => {
    for (const { target } of mutations) {
      if (!(target instanceof HTMLElement) || !target.classList.contains('modal')) continue;
      const shown = target.classList.contains('show');
      if (shown && trapModalEl !== target) {
        trapFocus(target);
      } else if (!shown && trapModalEl === target) {
        releaseFocusTrap();
      }
    }
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
}

/**
 * Bind Escape key to close the topmost visible modal, and trap focus in any open modal.
 * Call once after DOM ready (e.g. from initApp).
 */
export function initModals() {
  watchModalVisibility();
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const openModalEl = document.querySelector('.modal.show');
    if (openModalEl && openModalEl.id) {
      closeModal(openModalEl.id);
    }
  });
}
