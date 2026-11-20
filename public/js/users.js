/**
 * User management on the Config page: list, add, edit and remove accounts.
 * GrandSuperUser manages every account; a SuperUser manages the accounts on their vessel.
 * What each account allows (canEdit, canChangeRole, canDelete) comes from the server.
 */

import * as API from "./api.js";
import { safeGet, showErrorToast, showSuccessToast, escapeHtml } from "./ui.js";
import { openModal, closeModal } from "./modals.js";

const ROLE_LABELS = {
  grandsuperuser: "GrandSuperUser",
  supervisor: "Supervisor",
  superuser: "SuperUser",
  admin: "Admin",
  viewer: "Viewer",
};

/** Last response of GET /api/users: users plus what the logged-in manager may assign. */
let directory = { users: [], assignableRoles: [], canChooseVessel: false, ownVesselTag: null, minPasswordLength: 8 };

/** Account being edited or deleted in the open modal; null when adding. */
let activeUser = null;

function roleLabel(role) {
  return ROLE_LABELS[role] || role;
}

export async function loadUsers() {
  const body = safeGet("user-list-body");
  if (!body) return;
  try {
    directory = await API.fetchUsers();
    renderUsers();
  } catch (err) {
    console.error("Failed to load users", err);
    body.innerHTML = `<tr><td colspan="5" class="text-muted">Could not load users</td></tr>`;
  }
}

function renderUsers() {
  const body = safeGet("user-list-body");
  if (!body) return;
  body.innerHTML = "";

  if (directory.users.length === 0) {
    body.innerHTML = `<tr><td colspan="5" class="text-muted">No users</td></tr>`;
    return;
  }

  for (const user of directory.users) {
    const row = document.createElement("tr");
    const created = user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—";
    const youTag = user.isSelf ? ' <span class="user-you-tag">you</span>' : "";
    row.innerHTML = `
      <td>${escapeHtml(user.username)}${youTag}</td>
      <td><span class="user-role-badge ${escapeHtml(user.role)}">${escapeHtml(roleLabel(user.role))}</span></td>
      <td>${user.vesselTag ? escapeHtml(user.vesselTag) : "All vessels"}</td>
      <td>${created}</td>
      <td class="user-actions"></td>
    `;

    const actions = row.querySelector(".user-actions");
    if (user.canEdit) {
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn btn-sm btn-secondary";
      editBtn.textContent = "✏️ Edit";
      editBtn.addEventListener("click", () => openUserModal(user));
      actions.appendChild(editBtn);
    }
    if (user.canDelete) {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn btn-sm btn-outline btn-outline-danger";
      deleteBtn.textContent = "🗑️ Delete";
      deleteBtn.addEventListener("click", () => openDeleteModal(user));
      actions.appendChild(deleteBtn);
    }
    if (!user.canEdit && !user.canDelete) {
      actions.innerHTML = '<span class="text-muted">—</span>';
    }
    body.appendChild(row);
  }
}

/** The vessel field only matters for roles tied to a vessel, and only GrandSuperUser picks it. */
function syncVesselField() {
  const roleSel = safeGet("user-role");
  const vesselInput = safeGet("user-vessel");
  const hint = safeGet("user-vessel-hint");
  if (!roleSel || !vesselInput) return;

  const isGrandRole = roleSel.value === "grandsuperuser";
  const isSupervisorRole = roleSel.value === "supervisor";
  if (isGrandRole || isSupervisorRole) {
    vesselInput.value = "";
    vesselInput.disabled = true;
    if (hint) {
      hint.textContent = isSupervisorRole
        ? "Supervisor has read-only access to all vessels."
        : "GrandSuperUser always has access to all vessels.";
    }
  } else if (!directory.canChooseVessel) {
    vesselInput.value = directory.ownVesselTag || "";
    vesselInput.disabled = true;
    if (hint) hint.textContent = "Accounts you create belong to your vessel.";
  } else {
    vesselInput.disabled = roleSel.disabled;
    if (hint) hint.textContent = "Short vessel code, e.g. TTN.";
  }
}

/**
 * Open the add/edit dialog.
 * @param {Object|null} user - account to edit, or null to add a new one
 */
function openUserModal(user = null) {
  activeUser = user;
  const editing = Boolean(user);

  safeGet("user-modal-title").textContent = editing ? `Edit User — ${user.username}` : "Add User";
  safeGet("btn-user-save").textContent = editing ? "Save" : "Add User";

  const usernameInput = safeGet("user-username");
  usernameInput.value = editing ? user.username : "";
  usernameInput.disabled = editing;

  const passwordInput = safeGet("user-password");
  passwordInput.value = "";
  passwordInput.type = "password";
  safeGet("user-password-show").checked = false;
  safeGet("user-password-label").textContent = editing ? "New password" : "Password";
  safeGet("user-password-hint").textContent = editing
    ? `Leave blank to keep the current password. At least ${directory.minPasswordLength} characters.`
    : `At least ${directory.minPasswordLength} characters. Give it to the user; they cannot change it themselves.`;

  // Roles the manager may assign, plus the account's current role so it always shows.
  const roleSel = safeGet("user-role");
  const roles = [...directory.assignableRoles];
  if (editing && !roles.includes(user.role)) roles.unshift(user.role);
  roleSel.innerHTML = "";
  for (const role of roles) {
    const opt = document.createElement("option");
    opt.value = role;
    opt.textContent = roleLabel(role);
    roleSel.appendChild(opt);
  }
  roleSel.value = editing ? user.role : roles.includes("viewer") ? "viewer" : roles[0];
  roleSel.disabled = editing && !user.canChangeRole;

  safeGet("user-vessel").value = editing ? user.vesselTag || "" : directory.ownVesselTag || "";
  syncVesselField();

  safeGet("user-self-note").classList.toggle("hidden", !(editing && user.isSelf));
  safeGet("user-form-error").textContent = "";

  openModal("user-modal");
  requestAnimationFrame(() => (editing ? passwordInput : usernameInput).focus());
}

function closeUserModal() {
  safeGet("user-password").value = "";
  activeUser = null;
  closeModal("user-modal");
}

async function saveUser() {
  const errorEl = safeGet("user-form-error");
  const saveBtn = safeGet("btn-user-save");
  const username = safeGet("user-username").value.trim();
  const password = safeGet("user-password").value;
  const role = safeGet("user-role").value;
  const vesselTag = safeGet("user-vessel").value.trim();
  const editing = Boolean(activeUser);
  errorEl.textContent = "";

  if (!editing && !username) {
    errorEl.textContent = "Enter a username.";
    return;
  }
  if ((!editing || password) && password.length < directory.minPasswordLength) {
    errorEl.textContent = `Password must be at least ${directory.minPasswordLength} characters.`;
    return;
  }

  saveBtn.disabled = true;
  try {
    if (editing) {
      const changes = {};
      if (password) changes.password = password;
      if (activeUser.canChangeRole) {
        if (role !== activeUser.role) changes.role = role;
        if (role !== "grandsuperuser" && role !== "supervisor" && vesselTag !== (activeUser.vesselTag || "")) changes.vesselTag = vesselTag;
        // Leaving GrandSuperUser or Supervisor needs a vessel even if the field text did not change.
        if (changes.role && role !== "grandsuperuser" && role !== "supervisor") changes.vesselTag = vesselTag;
      }
      if (Object.keys(changes).length === 0) {
        errorEl.textContent = "Nothing was changed.";
        return;
      }
      const name = activeUser.username;
      await API.updateUser(activeUser.id, changes);
      closeUserModal();
      showSuccessToast("User updated", `${name} must log in again if their password, role or vessel changed.`);
    } else {
      await API.createUser({ username, password, role, vesselTag });
      closeUserModal();
      showSuccessToast("User added", `${username} can now log in.`);
    }
    await loadUsers();
  } catch (err) {
    console.error("Saving user failed", err);
    errorEl.textContent = err.message === "Forbidden" ? "You are not allowed to do this." : err.message || "Could not save user.";
  } finally {
    saveBtn.disabled = false;
  }
}

function openDeleteModal(user) {
  activeUser = user;
  safeGet("user-delete-message").textContent = `Delete user "${user.username}"?`;
  openModal("user-delete-modal");
}

function closeDeleteModal() {
  activeUser = null;
  closeModal("user-delete-modal");
}

async function confirmDeleteUser() {
  if (!activeUser) return;
  const { id, username } = activeUser;
  const confirmBtn = safeGet("btn-user-delete-confirm");
  confirmBtn.disabled = true;
  try {
    await API.deleteUser(id);
    closeDeleteModal();
    showSuccessToast("User deleted", `${username} can no longer log in.`);
    await loadUsers();
  } catch (err) {
    console.error("Deleting user failed", err);
    closeDeleteModal();
    if (err.message !== "Forbidden") showErrorToast("Delete failed", err.message || "Could not delete user.");
  } finally {
    confirmBtn.disabled = false;
  }
}

let initialised = false;

/** Wire the user management controls. Safe to call again after a re-login. */
export function initUserManagement() {
  if (initialised) return;
  initialised = true;
  safeGet("btn-add-user")?.addEventListener("click", () => openUserModal(null));
  safeGet("btn-user-save")?.addEventListener("click", saveUser);
  safeGet("btn-user-cancel")?.addEventListener("click", closeUserModal);
  safeGet("btn-user-modal-close")?.addEventListener("click", closeUserModal);
  document.querySelector("#user-modal .modal-overlay")?.addEventListener("click", closeUserModal);
  safeGet("user-role")?.addEventListener("change", syncVesselField);
  safeGet("user-password-show")?.addEventListener("change", (event) => {
    safeGet("user-password").type = event.target.checked ? "text" : "password";
  });
  safeGet("user-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveUser();
  });

  safeGet("btn-user-delete-confirm")?.addEventListener("click", confirmDeleteUser);
  safeGet("btn-user-delete-cancel")?.addEventListener("click", closeDeleteModal);
  safeGet("btn-user-delete-close")?.addEventListener("click", closeDeleteModal);
  document.querySelector("#user-delete-modal .modal-overlay")?.addEventListener("click", closeDeleteModal);
}
