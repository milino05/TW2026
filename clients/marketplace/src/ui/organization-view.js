import { navigate } from "../application/router.js";
import { accountRepository } from "../infrastructure/http/account-repository.js";
import { managementRepository } from "../infrastructure/http/management-repository.js";
import { icon } from "./icons.js";

const SECTIONS = new Set(["overview", "people", "roles", "venues", "rules", "physical", "settings"]);
function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function has(operations, code) { return (operations || []).some((entry) => entry.code === code); }
function roleNames(roles = []) { return roles.map((role) => role.name).join(" · ") || "Nessun ruolo"; }
function venueStateLabel(state) { if (state === "published") return "Pubblicata"; if (state === "working") return "Configurazione in corso"; return "Da configurare"; }
function resourceStateLabel(state) { if (state?.mode === "published") return `Pubblicata${state.version ? ` · v${state.version}` : ""}`; if (state?.mode === "working") return `Bozza${state.version ? ` · v${state.version}` : ""}`; return "Da configurare"; }
function queryState() {
  const params = new URLSearchParams(window.location.search);
  const section = SECTIONS.has(params.get("section")) ? params.get("section") : "overview";
  return {
    organizationId: params.get("organizationId"), section,
    memberPage: Math.max(1, Number(params.get("memberPage")) || 1),
    venuePage: Math.max(1, Number(params.get("venuePage")) || 1),
    namespacePage: Math.max(1, Number(params.get("namespacePage")) || 1),
    physicalVocabularyPage: Math.max(1, Number(params.get("physicalVocabularyPage")) || 1),
    limit: 8,
  };
}
function sectionRoute(state, overrides = {}) {
  const next = { ...state, ...overrides };
  const params = new URLSearchParams({ organizationId: String(next.organizationId), section: next.section || "overview" });
  if (next.memberPage > 1) params.set("memberPage", String(next.memberPage));
  if (next.venuePage > 1) params.set("venuePage", String(next.venuePage));
  if (next.namespacePage > 1) params.set("namespacePage", String(next.namespacePage));
  if (next.physicalVocabularyPage > 1) params.set("physicalVocabularyPage", String(next.physicalVocabularyPage));
  return `/organizations/detail?${params.toString()}`;
}
function pagination(kind, data) {
  if (!data || data.total <= data.pageSize) return "";
  return `<nav class="pagination" aria-label="Pagine ${kind}"><button type="button" data-page-kind="${kind}" data-page="${data.page - 1}" ${data.page <= 1 ? "disabled" : ""}>${icon("arrowLeft", { size: 14 })} Precedente</button><span>Pagina ${data.page} di ${Math.ceil(data.total / data.pageSize)}</span><button type="button" data-page-kind="${kind}" data-page="${data.page + 1}" ${data.page * data.pageSize >= data.total ? "disabled" : ""}>Successiva ${icon("chevron", { size: 14 })}</button></nav>`;
}

export class ArtAroundOrganizationView extends HTMLElement {
  state = queryState();
  data = null;
  busy = false;
  error = null;
  message = null;
  memberEditor = null;
  roleEditor = null;
  confirmation = null;
  audit = null;

  connectedCallback() { this.addEventListener("click", this.onClick); this.addEventListener("submit", this.onSubmit); this.load(); }
  disconnectedCallback() { this.removeEventListener("click", this.onClick); this.removeEventListener("submit", this.onSubmit); }
  availableSectionCodes() { return new Set((this.data?.organization?.availableSections || []).map((section) => section.code)); }

  async load() {
    if (!this.state.organizationId) { this.error = "Organizzazione non specificata"; this.render(); return; }
    this.busy = true; this.error = null; this.render();
    try {
      this.data = await managementRepository.organization(this.state.organizationId, this.state);
      if (!this.availableSectionCodes().has(this.state.section)) {
        this.state.section = "overview";
        this.message = "La sezione richiesta non è disponibile con i tuoi permessi.";
      }
    } catch (error) { this.error = error instanceof Error ? error.message : "Organizzazione non disponibile"; }
    finally { this.busy = false; this.render(); }
  }
  async execute(callback, message) {
    this.busy = true; this.error = null; this.message = null; this.render();
    let result = null;
    try { result = await callback(); this.message = message; this.data = await managementRepository.organization(this.state.organizationId, this.state); }
    catch (error) { this.error = error instanceof Error ? error.message : "Operazione non riuscita"; }
    finally { this.busy = false; this.render(); }
    return result;
  }
  selectedRoleIds(formData) { return formData.getAll("roleIds").map(String).filter(Boolean); }

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-back]")) { navigate("/profile#account-organizations"); return; }
    if (target?.closest("[data-public-profile]")) { navigate(`/organizations/public?organizationId=${encodeURIComponent(this.state.organizationId)}`); return; }
    const section = target?.closest("[data-organization-section]");
    if (section) { navigate(sectionRoute(this.state, { section: section.dataset.organizationSection })); return; }
    const venue = target?.closest("[data-venue]");
    if (venue) { navigate(`/venues/editor?venueId=${encodeURIComponent(venue.dataset.venue)}`); return; }
    const namespace = target?.closest("[data-namespace]");
    if (namespace) { navigate(`/namespaces/editor?namespaceId=${encodeURIComponent(namespace.dataset.namespace)}`); return; }
    const physicalVocabulary = target?.closest("[data-physical-vocabulary]");
    if (physicalVocabulary) { navigate(`/physical-vocabularies/editor?physicalVocabularyId=${encodeURIComponent(physicalVocabulary.dataset.physicalVocabulary)}`); return; }
    const page = target?.closest("[data-page-kind]");
    if (page && Number(page.dataset.page) > 0) { navigate(sectionRoute(this.state, { [`${page.dataset.pageKind}Page`]: Number(page.dataset.page) })); return; }

    const editMember = target?.closest("[data-member-edit]");
    if (editMember) { this.memberEditor = editMember.dataset.memberEdit; this.render(); return; }
    if (target?.closest("[data-member-edit-cancel]")) { this.memberEditor = null; this.render(); return; }
    const createRole = target?.closest("[data-role-create]");
    if (createRole) { this.roleEditor = { mode: "create" }; this.render(); return; }
    const editRole = target?.closest("[data-role-edit]");
    if (editRole) { this.roleEditor = { mode: "edit", roleId: editRole.dataset.roleEdit }; this.render(); return; }
    if (target?.closest("[data-role-edit-cancel]")) { this.roleEditor = null; this.render(); return; }

    const removeMember = target?.closest("[data-member-remove]");
    if (removeMember) this.confirmation = { type: "member.remove", id: removeMember.dataset.userId, label: removeMember.dataset.username, title: "Rimuovere questa persona?", detail: "Perderà l'accesso all'organizzazione. Le risorse esistenti non saranno eliminate." };
    const grantOwner = target?.closest("[data-owner-grant]");
    if (grantOwner) this.confirmation = { type: "owner.grant", id: grantOwner.dataset.userId, label: grantOwner.dataset.username, title: "Nominare un nuovo Owner?", detail: "L'Owner potrà concedere e revocare questa autorità radice." };
    const revokeOwner = target?.closest("[data-owner-revoke]");
    if (revokeOwner) this.confirmation = { type: "owner.revoke", id: revokeOwner.dataset.userId, label: revokeOwner.dataset.username, title: "Revocare l'autorità Owner?", detail: "I ruoli ordinari della persona resteranno invariati." };
    const removeRole = target?.closest("[data-role-remove]");
    if (removeRole) this.confirmation = { type: "role.remove", id: removeRole.dataset.roleRemove, label: removeRole.dataset.roleName, title: "Eliminare questo ruolo?", detail: "L'operazione è consentita solo se il ruolo non è assegnato." };
    if (removeMember || grantOwner || revokeOwner || removeRole) { this.render(); return; }
    if (target?.closest("[data-confirm-cancel]")) { this.confirmation = null; this.render(); return; }
    if (target?.closest("[data-confirm-action]") && this.confirmation) { await this.confirmAction(); return; }
    if (target?.closest("[data-audit-load]")) {
      this.busy = true; this.render();
      try { this.audit = await accountRepository.organizationAuthorizationEvents(this.state.organizationId); }
      catch (error) { this.error = error instanceof Error ? error.message : "Registro non disponibile"; }
      finally { this.busy = false; this.render(); }
    }
  };

  async confirmAction() {
    const action = this.confirmation; this.confirmation = null;
    const callbacks = {
      "member.remove": () => accountRepository.removeOrganizationMember(this.state.organizationId, action.id),
      "owner.grant": () => accountRepository.grantOrganizationOwner(this.state.organizationId, action.id),
      "owner.revoke": () => accountRepository.revokeOrganizationOwner(this.state.organizationId, action.id),
      "role.remove": () => accountRepository.removeOrganizationRole(this.state.organizationId, action.id),
    };
    await this.execute(callbacks[action.type], `${action.label}: operazione completata.`);
  }

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    event.preventDefault(); const data = new FormData(form);
    if (form.matches("[data-update-organization]")) {
      await this.execute(() => accountRepository.updateOrganization(this.state.organizationId, { name: String(data.get("name") || ""), description: String(data.get("description") || "") }), "Organizzazione aggiornata.");
    } else if (form.matches("[data-add-member]")) {
      await this.execute(() => accountRepository.addOrganizationMember(this.state.organizationId, { username: String(data.get("username") || ""), roleIds: this.selectedRoleIds(data) }), "Persona aggiunta all'organizzazione.");
    } else if (form.matches("[data-update-member-roles]")) {
      const userId = String(data.get("userId") || "");
      const result = await this.execute(() => accountRepository.updateOrganizationMemberRoles(this.state.organizationId, userId, this.selectedRoleIds(data)), "Ruoli aggiornati.");
      if (result) this.memberEditor = null;
    } else if (form.matches("[data-role-editor]")) {
      const payload = { name: String(data.get("name") || ""), description: String(data.get("description") || ""), permissionCodes: data.getAll("permissionCodes").map(String) };
      const roleId = String(data.get("roleId") || "");
      const result = await this.execute(() => roleId
        ? accountRepository.updateOrganizationRole(this.state.organizationId, roleId, payload)
        : accountRepository.createOrganizationRole(this.state.organizationId, payload), roleId ? "Ruolo aggiornato." : "Ruolo creato.");
      if (result) this.roleEditor = null;
    } else if (form.matches("[data-create-venue]")) {
      await this.execute(() => accountRepository.createVenue({ ownerOrganizationId: this.state.organizationId, name: String(data.get("name") || ""), description: String(data.get("description") || "") }), "Sede creata.");
    } else if (form.matches("[data-create-namespace]")) {
      const created = await this.execute(() => accountRepository.createNamespace({ ownerType: "organization", ownerId: this.state.organizationId, name: String(data.get("name") || ""), description: String(data.get("description") || "") }), "Regole editoriali create.");
      const createdId = created?.namespace?._id || created?.namespace?.id;
      if (createdId) navigate(`/namespaces/editor?namespaceId=${encodeURIComponent(createdId)}`);
    } else if (form.matches("[data-create-physical-vocabulary]")) {
      const created = await this.execute(() => accountRepository.createPhysicalVocabulary({
        ownerType: "organization", ownerId: this.state.organizationId,
        name: String(data.get("name") || ""), description: String(data.get("description") || ""),
        applyStarter: String(data.get("startingPoint") || "starter") !== "blank",
      }), "Vocabolario fisico creato.");
      const createdId = created?.physicalVocabulary?._id || created?.physicalVocabulary?.id;
      if (createdId) navigate(`/physical-vocabularies/editor?physicalVocabularyId=${encodeURIComponent(createdId)}`);
    }
  };

  renderConfirmation() {
    if (!this.confirmation) return "";
    return `<section class="confirmation-panel organization-confirmation" role="alert"><div><span class="eyebrow">Operazione sensibile</span><strong>${escapeHtml(this.confirmation.title)}</strong><p><b>${escapeHtml(this.confirmation.label)}</b> — ${escapeHtml(this.confirmation.detail)}</p></div><div class="button-row"><button class="danger" type="button" data-confirm-action ${this.busy ? "disabled" : ""}>Conferma</button><button class="button-secondary" type="button" data-confirm-cancel>Annulla</button></div></section>`;
  }
  renderRoleChoices(selectedIds = [], { name = "roleIds" } = {}) {
    const selected = new Set(selectedIds.map(String));
    const assignableRoles = (this.data.roles || []).filter((role) => role.assignable || selected.has(String(role.id || role._id)));
    return `<fieldset class="role-choice-grid"><legend>Ruoli assegnati</legend>${assignableRoles.map((role) => `<label class="role-choice"><input type="checkbox" name="${name}" value="${escapeHtml(role.id || role._id)}" ${selected.has(String(role.id || role._id)) ? "checked" : ""}><span><strong>${escapeHtml(role.name)}</strong><small>${escapeHtml(role.description || `${role.permissionCodes.length} permessi`)}</small></span></label>`).join("")}</fieldset>`;
  }
  renderOverview() {
    const sections = this.availableSectionCodes();
    const cards = [
      sections.has("people") ? ["people", icon("user", { size: 20 }), this.data.members.total, "Persone"] : null,
      sections.has("roles") ? ["roles", icon("shield", { size: 20 }), this.data.roles.length, "Ruoli"] : null,
      sections.has("venues") ? ["venues", icon("building", { size: 20 }), this.data.venues.total, "Sedi"] : null,
      sections.has("rules") ? ["rules", icon("book", { size: 20 }), this.data.namespaces.total, "Regole"] : null,
      sections.has("physical") ? ["physical", icon("route", { size: 20 }), this.data.physicalVocabularies.total, "Vocabolari fisici"] : null,
    ].filter(Boolean).map(([section, mark, count, label]) => `<button type="button" data-organization-section="${section}"><span>${mark}</span><strong>${count}</strong><small>${label}</small></button>`).join("");
    return `<section class="organization-overview"><div class="organization-overview__intro"><span class="eyebrow">Panoramica</span><h2>Uno spazio costruito sulle tue responsabilità</h2><p>Vedi soltanto dati e strumenti necessari ai tuoi permessi. I ruoli si combinano senza richiedere un ruolo attivo.</p></div>${cards ? `<div class="organization-summary-grid">${cards}</div>` : `<div class="empty-state compact"><h3>Accesso essenziale</h3><p>Se ti servono altri strumenti, chiedi al referente dell'organizzazione di aggiornare i tuoi ruoli.</p></div>`}</section>`;
  }

  renderPeople() {
    const { organization, members, roles } = this.data;
    const rows = members.results.map((member) => {
      const editing = this.memberEditor === String(member.id);
      const actions = [
        has(member.availableOperations, "organization.member.roles.update") ? `<button type="button" data-member-edit="${escapeHtml(member.id)}">${icon("edit", { size: 14 })} Ruoli</button>` : "",
        has(member.availableOperations, "organization.owner.grant") ? `<button class="button-secondary" type="button" data-owner-grant data-user-id="${escapeHtml(member.id)}" data-username="${escapeHtml(member.username)}">Nomina Owner</button>` : "",
        has(member.availableOperations, "organization.owner.revoke") ? `<button class="button-secondary" type="button" data-owner-revoke data-user-id="${escapeHtml(member.id)}" data-username="${escapeHtml(member.username)}">Revoca Owner</button>` : "",
        has(member.availableOperations, "organization.member.remove") ? `<button class="danger" type="button" data-member-remove data-user-id="${escapeHtml(member.id)}" data-username="${escapeHtml(member.username)}">Rimuovi</button>` : "",
      ].join("");
      return `<li class="organization-person"><span class="avatar">${escapeHtml(member.username[0].toUpperCase())}</span><span class="identity"><strong>${escapeHtml(member.username)}</strong><small>${escapeHtml(roleNames(member.roles))}</small>${member.isOwner ? `<span class="owner-badge">Owner</span>` : ""}</span><span class="actions">${actions}</span>${editing ? `<form class="member-role-editor" data-update-member-roles><input type="hidden" name="userId" value="${escapeHtml(member.id)}">${this.renderRoleChoices(member.roles.map((role) => role.id))}<div class="button-row"><button>Salva ruoli</button><button class="button-secondary" type="button" data-member-edit-cancel>Annulla</button></div></form>` : ""}</li>`;
    }).join("");
    return `<section class="organization-section"><div class="section-heading"><div><span class="eyebrow">Persone</span><h2>Membri e responsabilità</h2><p>Ogni membro ha uno o più ruoli. Il badge Owner rappresenta un'autorità separata.</p></div><span class="count">${members.total}</span></div>${this.renderConfirmation()}<ul class="organization-people">${rows || `<li class="empty-state">Nessun membro visibile.</li>`}</ul>${pagination("member", members)}${has(organization.availableOperations, "organization.member.add") ? `<details class="account-create" ${roles.length ? "" : "hidden"}><summary>${icon("plus", { size: 16 })} Aggiungi persona</summary><form data-add-member><label>Username esatto<input name="username" required placeholder="username"></label>${this.renderRoleChoices()}<p class="note">La membership viene creata solo con almeno un ruolo.</p><button>${icon("plus", { size: 16 })} Aggiungi persona</button></form></details>` : ""}</section>`;
  }
  roleForEditor() { return this.roleEditor?.mode === "edit" ? this.data.roles.find((role) => String(role.id || role._id) === this.roleEditor.roleId) : null; }
  renderRoleEditor() {
    if (!this.roleEditor) return "";
    const role = this.roleForEditor(); const selected = new Set((role?.permissionCodes || []).map(String)); const groups = this.data.permissionCatalog?.groups || [];
    return `<form class="role-editor" data-role-editor><header><div><span class="eyebrow">${role ? "Modifica ruolo" : "Nuovo ruolo"}</span><h3>${role ? escapeHtml(role.name) : "Definisci responsabilità chiare"}</h3><p>I prerequisiti di lettura vengono aggiunti automaticamente. Non esistono deny, gerarchie o wildcard.</p></div></header>${role ? `<input type="hidden" name="roleId" value="${escapeHtml(role.id || role._id)}">` : ""}<div class="role-editor__metadata"><label>Nome<input name="name" required maxlength="80" value="${escapeHtml(role?.name || "")}" placeholder="Es. Responsabile mostre"></label><label>Descrizione<textarea name="description" maxlength="500" placeholder="Quali responsabilità copre questo ruolo?">${escapeHtml(role?.description || "")}</textarea></label></div><div class="permission-groups">${groups.map((group) => `<fieldset><legend>${escapeHtml(group.label)}</legend>${group.permissions.map((permission) => `<label class="permission-choice ${permission.highImpact ? "permission-choice--high" : ""}"><input type="checkbox" name="permissionCodes" value="${escapeHtml(permission.code)}" ${selected.has(permission.code) ? "checked" : ""}><span><strong>${escapeHtml(permission.label)}${permission.highImpact ? ` <em>Impatto elevato</em>` : ""}</strong><code>${escapeHtml(permission.code)}</code>${permission.dependencies.length ? `<small>Richiede: ${escapeHtml(permission.dependencies.join(", "))}</small>` : ""}</span></label>`).join("")}</fieldset>`).join("")}</div><div class="button-row"><button>${icon("check", { size: 15 })} ${role ? "Salva ruolo" : "Crea ruolo"}</button><button class="button-secondary" type="button" data-role-edit-cancel>Annulla</button></div></form>`;
  }
  renderRoles() {
    const canCreate = has(this.data.organization.availableOperations, "organization.role.create");
    const cards = this.data.roles.map((role) => `<article class="role-card"><header><div><span class="resource-mark">${icon("shield", { size: 18 })}</span><div><h3>${escapeHtml(role.name)}</h3><p>${escapeHtml(role.description || "Ruolo personalizzato dell'organizzazione.")}</p></div></div><span class="count">${role.assignmentCount} ${role.assignmentCount === 1 ? "persona" : "persone"}</span></header><div class="role-card__permissions"><strong>${role.permissionCodes.length} permessi effettivi</strong><small>${escapeHtml(role.permissionCodes.slice(0, 5).join(" · "))}${role.permissionCodes.length > 5 ? " …" : ""}</small></div><div class="button-row">${has(role.availableOperations, "organization.role.update") ? `<button type="button" data-role-edit="${escapeHtml(role.id || role._id)}">${icon("edit", { size: 14 })} Modifica</button>` : ""}${has(role.availableOperations, "organization.role.remove") ? `<button class="danger" type="button" data-role-remove="${escapeHtml(role.id || role._id)}" data-role-name="${escapeHtml(role.name)}">${icon("trash", { size: 14 })} Elimina</button>` : ""}</div></article>`).join("");
    return `<section class="organization-section"><div class="section-heading"><div><span class="eyebrow">Ruoli</span><h2>Ruoli locali e permessi</h2><p>Le modifiche hanno effetto immediato su tutte le persone a cui il ruolo è assegnato.</p></div>${canCreate ? `<button type="button" data-role-create>${icon("plus", { size: 15 })} Nuovo ruolo</button>` : ""}</div>${this.renderConfirmation()}${this.renderRoleEditor()}<div class="role-card-grid">${cards || `<div class="empty-state">Nessun ruolo disponibile.</div>`}</div></section>`;
  }

  renderVenues() {
    const { organization, venues, physicalVocabularies } = this.data;
    const cards = venues.results.map((venue) => `<article class="account-resource-card"><header><span class="resource-mark">${icon("building", { size: 19 })}</span><div><span class="eyebrow">${escapeHtml(venueStateLabel(venue.physicalState))}</span><h3>${escapeHtml(venue.name)}</h3></div></header><p>${escapeHtml(venue.description || "Nessuna descrizione disponibile.")}</p>${venue.availableOperations.length ? `<button type="button" data-venue="${escapeHtml(venue.id)}">${has(venue.availableOperations, "venue.edit") ? "Gestisci sede e spazi fisici" : "Modifica profilo sede"} ${icon("chevron", { size: 15 })}</button>` : ""}</article>`).join("");
    const physicalHint = this.availableSectionCodes().has("physical") && physicalVocabularies.total === 0
      ? `<div class="empty-state compact"><h3>Prima sede fisica?</h3><p>Per configurare mappa e routing serve un vocabolario fisico. Puoi prepararlo prima oppure seguire l'onboarding quando inizi la configurazione della sede.</p><button type="button" class="button-secondary" data-organization-section="physical">Prepara vocabolario fisico</button></div>` : "";
    return `<section class="organization-section"><div class="section-heading"><div><span class="eyebrow">Sedi</span><h2>Sedi e spazi fisici</h2><p>Profilo pubblico e configurazione fisica sono capability indipendenti.</p></div><span class="count">${venues.total}</span></div>${physicalHint}<div class="account-resource-grid">${cards || `<div class="empty-state account-empty">${icon("building", { size: 25 })}<h3>Nessuna sede</h3></div>`}</div>${pagination("venue", venues)}${has(organization.availableOperations, "venue.create") ? `<details class="account-create"><summary>${icon("plus", { size: 16 })} Nuova sede</summary><form data-create-venue><label>Nome<input name="name" required placeholder="Nome della sede"></label><label>Descrizione<textarea name="description" placeholder="Caratteristiche e funzione della sede"></textarea></label><button>${icon("plus", { size: 16 })} Crea sede</button></form></details>` : ""}</section>`;
  }
  renderRules() {
    const { organization, namespaces } = this.data;
    const cards = namespaces.results.map((namespace) => `<article class="account-resource-card"><header><span class="resource-mark">${icon("book", { size: 19 })}</span><div><span class="eyebrow">${escapeHtml(resourceStateLabel(namespace.state))}</span><h3>${escapeHtml(namespace.name)}</h3></div></header><p>${escapeHtml(namespace.description || "Nessuna descrizione disponibile.")}</p>${namespace.availableOperations.length ? `<button type="button" data-namespace="${escapeHtml(namespace.id)}">${has(namespace.availableOperations, "namespace.edit") ? "Modifica regole editoriali" : "Visualizza regole editoriali"} ${icon("chevron", { size: 15 })}</button>` : ""}</article>`).join("");
    return `<section class="organization-section"><div class="section-heading"><div><span class="eyebrow">Regole editoriali</span><h2>Namespace</h2><p>Definiscono linguaggio, durate, presentazione e criteri editoriali usati dai contenuti dell'organizzazione.</p></div><span class="count">${namespaces.total}</span></div><div class="account-resource-grid">${cards || `<div class="empty-state account-empty">${icon("book", { size: 25 })}<h3>Nessuna regola editoriale</h3></div>`}</div>${pagination("namespace", namespaces)}${has(organization.availableOperations, "namespace.create") ? `<details class="account-create"><summary>${icon("plus", { size: 16 })} Nuove regole editoriali</summary><form data-create-namespace><label>Nome<input name="name" required placeholder="Es. Regole della collezione permanente"></label><label>Scopo e pubblico<textarea name="description" placeholder="A chi sono destinate e per quali contenuti?"></textarea></label><button>${icon("plus", { size: 16 })} Crea e configura</button></form></details>` : ""}</section>`;
  }
  renderPhysicalVocabularies() {
    const { organization, physicalVocabularies } = this.data;
    const cards = physicalVocabularies.results.map((entry) => `<article class="account-resource-card"><header><span class="resource-mark">${icon("route", { size: 19 })}</span><div><span class="eyebrow">${escapeHtml(resourceStateLabel(entry.state))}</span><h3>${escapeHtml(entry.name)}</h3></div></header><p>${escapeHtml(entry.description || "Linguaggio fisico riutilizzabile per spazi, collegamenti e routing.")}</p>${entry.availableOperations.length ? `<button type="button" data-physical-vocabulary="${escapeHtml(entry.id)}">${has(entry.availableOperations, "physical_vocabulary.edit") ? "Configura vocabolario fisico" : "Visualizza vocabolario fisico"} ${icon("chevron", { size: 15 })}</button>` : ""}</article>`).join("");
    const create = has(organization.availableOperations, "physical_vocabulary.create") ? `<details class="account-create"><summary>${icon("plus", { size: 16 })} Nuovo vocabolario fisico</summary><form data-create-physical-vocabulary><div class="namespace-create-intro"><strong>Come vuoi partire?</strong><p>La configurazione base è consigliata: aggiunge servizi, scale, ascensori, caratteristiche di accessibilità e profili comuni, ma potrai modificarli o rimuoverli.</p></div><label>Nome<input name="name" required placeholder="Es. Vocabolario fisico del museo"></label><label>Descrizione<textarea name="description" placeholder="Quali sedi o esigenze deve coprire?"></textarea></label><fieldset><legend>Punto di partenza</legend><label class="check"><input type="radio" name="startingPoint" value="starter" checked><span><strong>Usa configurazione base</strong><small>Consigliato per partire rapidamente da una base modificabile.</small></span></label><label class="check"><input type="radio" name="startingPoint" value="blank"><span><strong>Parti da zero</strong><small>Crea una bozza vuota e definisci tutto manualmente.</small></span></label></fieldset><button>${icon("plus", { size: 16 })} Crea e configura</button></form></details>` : "";
    return `<section class="organization-section"><div class="section-heading"><div><span class="eyebrow">Dominio fisico</span><h2>Vocabolari fisici</h2><p>Definiscono tipi di luoghi, collegamenti, caratteristiche e profili di routing. Sono risorse autonome: le sedi adottano una loro revisione pubblicata.</p></div><span class="count">${physicalVocabularies.total}</span></div><div class="account-resource-grid">${cards || `<div class="empty-state account-empty">${icon("route", { size: 25 })}<h3>Nessun vocabolario fisico</h3><p>Creane uno per iniziare a configurare mappe e routing delle sedi.</p></div>`}</div>${pagination("physicalVocabulary", physicalVocabularies)}${create}</section>`;
  }

  renderAudit() {
    if (!this.data.settings.canViewAudit) return "";
    if (!this.audit) return `<section class="settings-card"><div><h3>Registro autorizzativo</h3><p>Consulta modifiche a ruoli, membership e Owner.</p></div><button type="button" data-audit-load>${icon("history", { size: 15 })} Carica registro</button></section>`;
    const rows = this.audit.results.map((event) => `<li><span><strong>${escapeHtml(event.eventType)}</strong><small>${escapeHtml(new Date(event.createdAt).toLocaleString("it-IT"))}</small></span><code>${escapeHtml(event.targetType)}</code></li>`).join("");
    return `<section class="settings-card settings-card--stack"><div><h3>Registro autorizzativo</h3><p>${this.audit.total} eventi conservati.</p></div><ul class="audit-list">${rows || `<li>Nessun evento.</li>`}</ul></section>`;
  }
  renderSettings() {
    const { organization, settings } = this.data;
    return `<section class="organization-section"><div class="section-heading"><div><span class="eyebrow">Impostazioni</span><h2>Governance e profilo</h2><p>Owner e permessi ordinari restano deliberatamente separati.</p></div></div>${settings.canManageProfile ? `<section class="settings-card"><div><h3>Profilo dell'organizzazione</h3><p>Nome e descrizione usati nelle superfici pubbliche.</p></div><form data-update-organization><label>Nome<input name="name" value="${escapeHtml(organization.name)}" required></label><label>Descrizione<textarea name="description">${escapeHtml(organization.description || "")}</textarea></label><button>${icon("check", { size: 15 })} Salva profilo</button></form></section>` : ""}${settings.canManageOwners ? `<section class="settings-card"><div><h3>Autorità Owner</h3><p>Puoi nominare o revocare Owner nella sezione Persone. L'ultimo Owner non può essere rimosso.</p></div><button class="button-secondary" type="button" data-organization-section="people">Apri Persone</button></section>` : ""}${this.renderAudit()}</section>`;
  }

  renderCurrentSection() {
    if (this.state.section === "people") return this.renderPeople();
    if (this.state.section === "roles") return this.renderRoles();
    if (this.state.section === "venues") return this.renderVenues();
    if (this.state.section === "rules") return this.renderRules();
    if (this.state.section === "physical") return this.renderPhysicalVocabularies();
    if (this.state.section === "settings") return this.renderSettings();
    return this.renderOverview();
  }
  tabLabel(section) {
    const counts = { people: this.data.members.total, roles: this.data.roles.length, venues: this.data.venues.total, rules: this.data.namespaces.total, physical: this.data.physicalVocabularies.total };
    return counts[section.code] === undefined ? section.label : `${section.label} (${counts[section.code]})`;
  }
  render() {
    if (!this.data) { this.innerHTML = `<main class="page organization-page"><p role="${this.error ? "alert" : "status"}">${escapeHtml(this.error || "Caricamento organizzazione…")}</p></main>`; return; }
    const organization = this.data.organization;
    const tabs = organization.availableSections.map((section) => `<button type="button" data-organization-section="${escapeHtml(section.code)}" aria-current="${this.state.section === section.code ? "page" : "false"}">${escapeHtml(this.tabLabel(section))}</button>`).join("");
    this.innerHTML = `<main class="page organization-page" aria-busy="${this.busy}"><nav class="breadcrumb" aria-label="Percorso"><button type="button" data-back>${icon("arrowLeft", { size: 16 })} Account</button><span>/</span><span>Gestione organizzazione</span><span>/</span><span>${escapeHtml(organization.name)}</span></nav><header class="organization-header"><div><span class="eyebrow">Gestione organizzazione</span><h1>${escapeHtml(organization.name)}</h1><p>${escapeHtml(organization.description || "Nessuna descrizione disponibile.")}</p><div class="organization-role-summary"><span>${escapeHtml(roleNames(organization.roles))}</span>${organization.isOwner ? `<span class="owner-badge">Owner</span>` : ""}</div></div><button class="button-secondary" type="button" data-public-profile>Visualizza profilo pubblico</button></header><nav class="organization-tabs" aria-label="Sezioni gestione organizzazione">${tabs}</nav>${this.busy ? `<p role="status">Aggiornamento…</p>` : ""}${this.message ? `<p class="feedback-success" role="status">${icon("check", { size: 16 })} ${escapeHtml(this.message)}</p>` : ""}${this.error ? `<p role="alert">${icon("warning", { size: 16 })} ${escapeHtml(this.error)}</p>` : ""}${this.renderCurrentSection()}</main>`;
  }
}

customElements.define("artaround-organization-view", ArtAroundOrganizationView);
