import { accountRepository } from "../infrastructure/http/account-repository.js";
import { icon } from "./icons.js";
import { createTaskDialog } from "./task-dialog.js";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function roleId(role) { return String(role?.id || role?._id || ""); }

function renderRoleChoices(roles, selectedIds) {
  const selected = new Set([...selectedIds].map(String));
  const assignable = (roles || []).filter((role) => role.assignable || selected.has(roleId(role)));
  return `<fieldset class="role-choice-grid"><legend>Ruoli assegnati</legend>${assignable.map((role) => `<label class="role-choice"><input type="checkbox" name="roleIds" value="${escapeHtml(roleId(role))}" ${selected.has(roleId(role)) ? "checked" : ""}><span><strong>${escapeHtml(role.name)}</strong><small>${escapeHtml(role.description || `${role.permissionCodes?.length || 0} permessi`)}</small></span></label>`).join("")}</fieldset>`;
}

export function openOrganizationMemberDialog({ organizationId, roles = [], member = null, onSaved = null, onDismiss = null } = {}) {
  const editing = Boolean(member);
  const state = {
    username: member?.username || "",
    roleIds: new Set((member?.roles || []).map((role) => String(role.id || role._id))),
    dirty: false,
    busy: false,
    error: null,
  };
  let dialog = null;
  const formId = "organization-member-dialog-form";

  const body = () => `${state.error ? `<artaround-callout tone="danger" role="alert">${escapeHtml(state.error)}</artaround-callout>` : ""}<form id="${formId}" data-member-dialog-form>
    ${editing ? `<div class="task-context-summary"><span class="eyebrow">Persona</span><strong>${escapeHtml(state.username)}</strong></div>` : `<label>Username esatto<input name="username" required autocomplete="off" placeholder="username" value="${escapeHtml(state.username)}"></label>`}
    ${renderRoleChoices(roles, state.roleIds)}
    <p class="note">La membership deve avere almeno un ruolo. L'autorità Owner resta separata dai ruoli ordinari.</p>
  </form>`;

  const footer = () => `<button type="button" class="button-secondary" data-modal-dismiss ${state.busy ? "disabled" : ""}>Annulla</button><button type="submit" form="${formId}" ${state.busy ? "disabled" : ""}>${icon("check", { size: 15 })} ${state.busy ? "Salvataggio…" : editing ? "Salva ruoli" : "Aggiungi persona"}</button>`;

  async function save(form) {
    if (state.busy) return;
    const data = new FormData(form);
    state.username = editing ? state.username : String(data.get("username") || "").trim();
    state.roleIds = new Set(data.getAll("roleIds").map(String).filter(Boolean));
    if (!state.roleIds.size) {
      state.error = "Seleziona almeno un ruolo.";
      dialog?.render();
      return;
    }
    state.busy = true;
    state.error = null;
    dialog?.render();
    try {
      const result = editing
        ? await accountRepository.updateOrganizationMemberRoles(organizationId, String(member.id), [...state.roleIds])
        : await accountRepository.addOrganizationMember(organizationId, { username: state.username, roleIds: [...state.roleIds] });
      state.dirty = false;
      dialog?.close({ restoreFocus: true, notify: false });
      dialog = null;
      onSaved?.(result);
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Operazione non riuscita";
      state.busy = false;
      dialog?.render();
      dialog?.focus(editing ? "input[name='roleIds']" : "input[name='username']");
    }
  }

  dialog = createTaskDialog({
    eyebrow: editing ? "Ruoli della persona" : "Nuova membership",
    title: editing ? `Modifica i ruoli di ${state.username}` : "Aggiungi una persona",
    description: editing ? "Aggiorna le responsabilità ordinarie senza modificare l'autorità Owner." : "Aggiungi una persona all'organizzazione e assegnale almeno un ruolo.",
    size: "compact",
    initialFocus: editing ? "input[name='roleIds']" : "input[name='username']",
    renderBody: body,
    renderFooter: footer,
    isBusy: () => state.busy,
    isDirty: () => state.dirty,
    onDiscard: () => { state.dirty = false; },
    onDismiss: (reason) => { dialog = null; onDismiss?.(reason); },
    onInput: (event) => {
      const field = event.target instanceof HTMLInputElement ? event.target : null;
      if (!field?.form?.matches("[data-member-dialog-form]")) return;
      if (field.name === "username") state.username = field.value;
      state.dirty = true;
    },
    onChange: (event) => {
      const field = event.target instanceof HTMLInputElement ? event.target : null;
      if (!field?.form?.matches("[data-member-dialog-form]") || field.name !== "roleIds") return;
      if (field.checked) state.roleIds.add(field.value); else state.roleIds.delete(field.value);
      state.dirty = true;
    },
    onSubmit: (event) => {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (!form?.matches("[data-member-dialog-form]")) return;
      event.preventDefault();
      if (!form.reportValidity()) return;
      void save(form);
    },
  });
  return dialog;
}

export function openOrganizationRoleDialog({ organizationId, permissionCatalog = {}, role = null, onSaved = null, onDismiss = null } = {}) {
  const editing = Boolean(role);
  const state = {
    step: "details",
    name: role?.name || "",
    description: role?.description || "",
    permissionCodes: new Set((role?.permissionCodes || []).map(String)),
    dirty: false,
    busy: false,
    error: null,
  };
  let dialog = null;
  const detailsFormId = "organization-role-details-form";
  const permissionsFormId = "organization-role-permissions-form";

  const stepper = () => `<ol class="collection-create-stepper" aria-label="Configurazione ruolo"><li class="${state.step === "details" ? "is-current" : "is-complete"}" ${state.step === "details" ? 'aria-current="step"' : ""}><span>${state.step === "details" ? "1" : "✓"}</span><strong>Dettagli</strong></li><li class="${state.step === "permissions" ? "is-current" : ""}" ${state.step === "permissions" ? 'aria-current="step"' : ""}><span>2</span><strong>Permessi</strong></li></ol>`;

  const details = () => `<form id="${detailsFormId}" data-role-details-form><div class="role-editor__metadata"><label>Nome<input name="name" required maxlength="80" value="${escapeHtml(state.name)}" placeholder="Es. Responsabile mostre"></label><label>Descrizione<textarea name="description" maxlength="500" placeholder="Quali responsabilità copre questo ruolo?">${escapeHtml(state.description)}</textarea></label></div><p class="note">I prerequisiti di lettura vengono aggiunti automaticamente. Non esistono deny, gerarchie o wildcard.</p></form>`;

  const permissions = () => `<form id="${permissionsFormId}" data-role-permissions-form><div class="permission-groups">${(permissionCatalog.groups || []).map((group) => `<fieldset><legend>${escapeHtml(group.label)}</legend>${group.permissions.map((permission) => `<label class="permission-choice ${permission.highImpact ? "permission-choice--high" : ""}"><input type="checkbox" name="permissionCodes" value="${escapeHtml(permission.code)}" ${state.permissionCodes.has(permission.code) ? "checked" : ""}><span><strong>${escapeHtml(permission.label)}${permission.highImpact ? ` <em>Impatto elevato</em>` : ""}</strong><code>${escapeHtml(permission.code)}</code>${permission.dependencies.length ? `<small>Richiede: ${escapeHtml(permission.dependencies.join(", "))}</small>` : ""}</span></label>`).join("")}</fieldset>`).join("")}</div></form>`;

  const body = () => `${stepper()}${state.error ? `<artaround-callout tone="danger" role="alert">${escapeHtml(state.error)}</artaround-callout>` : ""}${state.step === "permissions" ? permissions() : details()}`;
  const footer = () => state.step === "permissions"
    ? `<button type="button" class="button-secondary" data-role-back ${state.busy ? "disabled" : ""}>← Indietro</button><button type="submit" form="${permissionsFormId}" ${state.busy ? "disabled" : ""}>${icon("check", { size: 15 })} ${state.busy ? "Salvataggio…" : editing ? "Salva ruolo" : "Crea ruolo"}</button>`
    : `<button type="button" class="button-secondary" data-modal-dismiss>Annulla</button><button type="submit" form="${detailsFormId}">Continua ${icon("chevron", { size: 15 })}</button>`;

  async function save(form) {
    if (state.busy) return;
    const data = new FormData(form);
    state.permissionCodes = new Set(data.getAll("permissionCodes").map(String));
    state.busy = true;
    state.error = null;
    dialog?.render();
    try {
      const payload = { name: state.name.trim(), description: state.description.trim(), permissionCodes: [...state.permissionCodes] };
      const result = editing
        ? await accountRepository.updateOrganizationRole(organizationId, roleId(role), payload)
        : await accountRepository.createOrganizationRole(organizationId, payload);
      state.dirty = false;
      dialog?.close({ restoreFocus: true, notify: false });
      dialog = null;
      onSaved?.(result);
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Ruolo non salvato";
      state.busy = false;
      dialog?.render();
    }
  }

  dialog = createTaskDialog({
    eyebrow: editing ? "Modifica ruolo" : "Nuovo ruolo",
    title: editing ? role.name : "Definisci responsabilità chiare",
    description: "Configura prima l'identità del ruolo e poi i permessi effettivi.",
    size: "large",
    initialFocus: "input[name='name']",
    renderBody: body,
    renderFooter: footer,
    isBusy: () => state.busy,
    isDirty: () => state.dirty,
    onDiscard: () => { state.dirty = false; },
    onDismiss: (reason) => { dialog = null; onDismiss?.(reason); },
    onClick: (event) => {
      if (event.target instanceof Element && event.target.closest("[data-role-back]")) {
        state.step = "details";
        state.error = null;
        dialog?.render();
        dialog?.focus("input[name='name']");
      }
    },
    onInput: (event) => {
      const field = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ? event.target : null;
      if (!field?.form?.matches("[data-role-details-form]")) return;
      if (field.name === "name") state.name = field.value;
      if (field.name === "description") state.description = field.value;
      state.dirty = true;
    },
    onChange: (event) => {
      const field = event.target instanceof HTMLInputElement ? event.target : null;
      if (!field?.form?.matches("[data-role-permissions-form]") || field.name !== "permissionCodes") return;
      if (field.checked) state.permissionCodes.add(field.value); else state.permissionCodes.delete(field.value);
      state.dirty = true;
    },
    onSubmit: (event) => {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (form?.matches("[data-role-details-form]")) {
        event.preventDefault();
        const data = new FormData(form);
        state.name = String(data.get("name") || "");
        state.description = String(data.get("description") || "");
        if (!form.reportValidity()) return;
        state.step = "permissions";
        state.error = null;
        dialog?.render();
        dialog?.focus("input[name='permissionCodes']");
        return;
      }
      if (form?.matches("[data-role-permissions-form]")) {
        event.preventDefault();
        void save(form);
      }
    },
  });
  return dialog;
}
