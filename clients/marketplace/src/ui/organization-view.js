import { navigate, pushSameDocumentHistory } from "../application/router.js";
import { confirmNavigationLoss, hasNavigationLossRisk } from "../application/navigation-loss-guard.js";
import { accountRepository } from "../infrastructure/http/account-repository.js";
import { managementRepository } from "../infrastructure/http/management-repository.js";
import { icon } from "./icons.js";
import { openActionDialog } from "./feedback-primitives.js";
import { openResourceCreateDialog } from "./resource-create-dialog.js";
import { openOrganizationMemberDialog, openOrganizationRoleDialog } from "./organization-management-dialogs.js";
import "./venue-create-dialog.js";

const SECTIONS = new Set(["overview", "people", "roles", "venues", "rules", "physical", "settings"]);
const PAGE_STATE_KEYS = Object.freeze({ member: "memberPage", venue: "venuePage", namespace: "namespacePage", physicalVocabulary: "physicalVocabularyPage" });
function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function has(operations, code) { return (operations || []).some((entry) => entry.code === code); }
function roleNames(roles = []) { return roles.map((role) => role.name).join(" · ") || "Nessun ruolo"; }
function venueStateLabel(state) { if (state === "published") return "Pubblicata"; if (state === "working") return "Configurazione in corso"; return "Da configurare"; }
function resourceStateLabel(state, publishedLabel = "Pubblicata") { if (state?.mode === "published") return `${publishedLabel}${state.version ? ` · v${state.version}` : ""}`; if (state?.mode === "working") return `Bozza${state.version ? ` · v${state.version}` : ""}`; return "Da configurare"; }
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
function sectionBrowserUrl(state, overrides = {}) {
  const logical = new URL(sectionRoute(state, overrides), window.location.origin);
  return `${window.location.pathname}${logical.search}${logical.hash}`;
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
  audit = null;
  taskDialog = null;

  connectedCallback() { this.addEventListener("click", this.onClick); this.addEventListener("submit", this.onSubmit); this.load(); }
  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("submit", this.onSubmit);
    this.taskDialog?.close({ restoreFocus: false, notify: false });
    this.taskDialog = null;
  }
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

  async refreshAfterDialog(message) {
    this.message = message;
    this.busy = true;
    this.error = null;
    this.render();
    try { this.data = await managementRepository.organization(this.state.organizationId, this.state); }
    catch (error) { this.error = error instanceof Error ? error.message : "Organizzazione non disponibile"; }
    finally { this.busy = false; this.render(); }
  }

  async confirmLocalNavigation(to) {
    if (!hasNavigationLossRisk()) return true;
    return confirmNavigationLoss({ kind: "section", from: sectionRoute(this.state), to });
  }

  async setSection(section) {
    const normalized = this.availableSectionCodes().has(section) ? section : "overview";
    if (normalized === this.state.section) return;
    const nextState = { ...this.state, section: normalized };
    if (!await this.confirmLocalNavigation(sectionRoute(nextState))) return;
    this.state = nextState;
    this.message = null;
    this.error = null;
    const nextUrl = sectionBrowserUrl(this.state);
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (currentUrl !== nextUrl) pushSameDocumentHistory(nextUrl);
    this.render();
    requestAnimationFrame(() => this.querySelector(".organization-section, .organization-overview")?.focus({ preventScroll: true }));
  }

  async setPage(kind, page) {
    const stateKey = PAGE_STATE_KEYS[kind];
    const normalizedPage = Math.max(1, Number(page) || 1);
    if (!stateKey || normalizedPage === this.state[stateKey]) return;
    const nextState = { ...this.state, [stateKey]: normalizedPage };
    if (!await this.confirmLocalNavigation(sectionRoute(nextState))) return;
    this.state = nextState;
    this.message = null;
    this.error = null;
    const nextUrl = sectionBrowserUrl(this.state);
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (currentUrl !== nextUrl) pushSameDocumentHistory(nextUrl);
    await this.load();
    requestAnimationFrame(() => this.querySelector(".organization-section, .organization-overview")?.focus({ preventScroll: true }));
  }

  openMemberDialog(member = null) {
    if (this.taskDialog) return;
    this.taskDialog = openOrganizationMemberDialog({
      organizationId: this.state.organizationId,
      roles: this.data.roles || [],
      member,
      onDismiss: () => { this.taskDialog = null; },
      onSaved: () => {
        this.taskDialog = null;
        void this.refreshAfterDialog(member ? "Ruoli aggiornati." : "Persona aggiunta all'organizzazione.");
      },
    });
  }

  openRoleDialog(role = null) {
    if (this.taskDialog) return;
    this.taskDialog = openOrganizationRoleDialog({
      organizationId: this.state.organizationId,
      permissionCatalog: this.data.permissionCatalog || {},
      role,
      onDismiss: () => { this.taskDialog = null; },
      onSaved: () => {
        this.taskDialog = null;
        void this.refreshAfterDialog(role ? "Ruolo aggiornato." : "Ruolo creato.");
      },
    });
  }

  openResourceDialog(type) {
    if (this.taskDialog) return;
    this.taskDialog = openResourceCreateDialog({
      type,
      ownerType: "organization",
      ownerId: this.state.organizationId,
      applyStarterByDefault: false,
      onDismiss: () => { this.taskDialog = null; },
      onCreated: ({ id: createdId }) => {
        this.taskDialog = null;
        if (type === "physical") navigate(`/physical-vocabularies/editor?physicalVocabularyId=${encodeURIComponent(createdId)}`);
        else navigate(`/namespaces/editor?namespaceId=${encodeURIComponent(createdId)}`);
      },
    });
  }

  async confirmSensitiveAction(action) {
    const confirmed = await openActionDialog({
      title: action.title,
      message: `${action.label} — ${action.detail}`,
      confirmLabel: action.confirmLabel || "Conferma",
      cancelLabel: "Annulla",
      tone: action.danger === false ? "warning" : "danger",
    });
    if (!confirmed) return;
    const callbacks = {
      "member.remove": () => accountRepository.removeOrganizationMember(this.state.organizationId, action.id),
      "owner.grant": () => accountRepository.grantOrganizationOwner(this.state.organizationId, action.id),
      "owner.revoke": () => accountRepository.revokeOrganizationOwner(this.state.organizationId, action.id),
      "role.remove": () => accountRepository.removeOrganizationRole(this.state.organizationId, action.id),
    };
    await this.execute(callbacks[action.type], `${action.label}: operazione completata.`);
  }

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-context-hub]")) { navigate("/context"); return; }
    if (target?.closest("[data-public-profile]")) { navigate(`/organizations/public?organizationId=${encodeURIComponent(this.state.organizationId)}`); return; }
    const section = target?.closest("[data-organization-section]");
    if (section) { await this.setSection(section.dataset.organizationSection); return; }
    const venue = target?.closest("[data-venue]");
    if (venue) { navigate(`/venues/editor?venueId=${encodeURIComponent(venue.dataset.venue)}`); return; }
    const namespace = target?.closest("[data-namespace]");
    if (namespace) { navigate(`/namespaces/editor?namespaceId=${encodeURIComponent(namespace.dataset.namespace)}`); return; }
    const physicalVocabulary = target?.closest("[data-physical-vocabulary]");
    if (physicalVocabulary) { navigate(`/physical-vocabularies/editor?physicalVocabularyId=${encodeURIComponent(physicalVocabulary.dataset.physicalVocabulary)}`); return; }
    const page = target?.closest("[data-page-kind]");
    if (page && Number(page.dataset.page) > 0) { await this.setPage(page.dataset.pageKind, Number(page.dataset.page)); return; }

    if (target?.closest("[data-member-add]")) { this.openMemberDialog(); return; }
    const editMember = target?.closest("[data-member-edit]");
    if (editMember) {
      const member = this.data.members.results.find((entry) => String(entry.id) === String(editMember.dataset.memberEdit));
      if (member) this.openMemberDialog(member);
      return;
    }
    if (target?.closest("[data-role-create]")) { this.openRoleDialog(); return; }
    const editRole = target?.closest("[data-role-edit]");
    if (editRole) {
      const role = this.data.roles.find((entry) => String(entry.id || entry._id) === String(editRole.dataset.roleEdit));
      if (role) this.openRoleDialog(role);
      return;
    }
    if (target?.closest("[data-create-namespace-open]")) { this.openResourceDialog("namespace"); return; }
    if (target?.closest("[data-create-physical-open]")) { this.openResourceDialog("physical"); return; }

    const removeMember = target?.closest("[data-member-remove]");
    if (removeMember) { await this.confirmSensitiveAction({ type: "member.remove", id: removeMember.dataset.userId, label: removeMember.dataset.username, title: "Rimuovere questa persona?", detail: "Perderà l'accesso all'organizzazione. Le risorse esistenti non saranno eliminate." }); return; }
    const grantOwner = target?.closest("[data-owner-grant]");
    if (grantOwner) { await this.confirmSensitiveAction({ type: "owner.grant", id: grantOwner.dataset.userId, label: grantOwner.dataset.username, title: "Nominare un nuovo Owner?", detail: "L'Owner potrà concedere e revocare questa autorità radice.", danger: false, confirmLabel: "Nomina Owner" }); return; }
    const revokeOwner = target?.closest("[data-owner-revoke]");
    if (revokeOwner) { await this.confirmSensitiveAction({ type: "owner.revoke", id: revokeOwner.dataset.userId, label: revokeOwner.dataset.username, title: "Revocare l'autorità Owner?", detail: "I ruoli ordinari della persona resteranno invariati." }); return; }
    const removeRole = target?.closest("[data-role-remove]");
    if (removeRole) { await this.confirmSensitiveAction({ type: "role.remove", id: removeRole.dataset.roleRemove, label: removeRole.dataset.roleName, title: "Eliminare questo ruolo?", detail: "L'operazione è consentita solo se il ruolo non è assegnato." }); return; }

    if (target?.closest("[data-audit-load]")) {
      this.busy = true; this.render();
      try { this.audit = await accountRepository.organizationAuthorizationEvents(this.state.organizationId); }
      catch (error) { this.error = error instanceof Error ? error.message : "Registro non disponibile"; }
      finally { this.busy = false; this.render(); }
    }
  };

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.matches("[data-update-organization]")) return;
    event.preventDefault();
    const data = new FormData(form);
    await this.execute(() => accountRepository.updateOrganization(this.state.organizationId, { name: String(data.get("name") || ""), description: String(data.get("description") || "") }), "Organizzazione aggiornata.");
  };

  renderOverview() {
    const sections = this.availableSectionCodes();
    const cards = [
      sections.has("people") ? ["people", icon("user", { size: 20 }), this.data.members.total, "Persone"] : null,
      sections.has("roles") ? ["roles", icon("shield", { size: 20 }), this.data.roles.length, "Ruoli"] : null,
      sections.has("venues") ? ["venues", icon("building", { size: 20 }), this.data.venues.total, "Sedi"] : null,
      sections.has("rules") ? ["rules", icon("book", { size: 20 }), this.data.namespaces.total, "Regole"] : null,
      sections.has("physical") ? ["physical", icon("route", { size: 20 }), this.data.physicalVocabularies.total, "Vocabolari fisici"] : null,
    ].filter(Boolean).map(([section, mark, count, label]) => `<button type="button" data-organization-section="${section}"><span>${mark}</span><strong>${count}</strong><small>${label}</small></button>`).join("");
    return `<section class="organization-overview" tabindex="-1"><div class="organization-overview__intro"><span class="eyebrow">Panoramica</span><h2>Uno spazio costruito sulle tue responsabilità</h2><p>Vedi soltanto dati e strumenti necessari ai tuoi permessi. I ruoli si combinano senza richiedere un ruolo attivo.</p></div>${cards ? `<div class="organization-summary-grid">${cards}</div>` : `<div class="empty-state compact"><h3>Accesso essenziale</h3><p>Se ti servono altri strumenti, chiedi al referente dell'organizzazione di aggiornare i tuoi ruoli.</p></div>`}</section>`;
  }

  renderPeople() {
    const { organization, members, roles } = this.data;
    const rows = members.results.map((member) => {
      const actions = [
        has(member.availableOperations, "organization.member.roles.update") ? `<button type="button" data-member-edit="${escapeHtml(member.id)}">${icon("edit", { size: 14 })} Ruoli</button>` : "",
        has(member.availableOperations, "organization.owner.grant") ? `<button class="button-secondary" type="button" data-owner-grant data-user-id="${escapeHtml(member.id)}" data-username="${escapeHtml(member.username)}">Nomina Owner</button>` : "",
        has(member.availableOperations, "organization.owner.revoke") ? `<button class="button-secondary" type="button" data-owner-revoke data-user-id="${escapeHtml(member.id)}" data-username="${escapeHtml(member.username)}">Revoca Owner</button>` : "",
        has(member.availableOperations, "organization.member.remove") ? `<button class="danger" type="button" data-member-remove data-user-id="${escapeHtml(member.id)}" data-username="${escapeHtml(member.username)}">Rimuovi</button>` : "",
      ].join("");
      return `<li class="organization-person"><span class="avatar">${escapeHtml(member.username[0].toUpperCase())}</span><span class="identity"><strong>${escapeHtml(member.username)}</strong><small>${escapeHtml(roleNames(member.roles))}</small>${member.isOwner ? `<span class="owner-badge">Owner</span>` : ""}</span><span class="actions">${actions}</span></li>`;
    }).join("");
    const canAdd = has(organization.availableOperations, "organization.member.add") && roles.length > 0;
    return `<section class="organization-section" tabindex="-1"><div class="section-heading"><div><span class="eyebrow">Persone</span><h2>Membri e responsabilità</h2><p>Ogni membro ha uno o più ruoli. Il badge Owner rappresenta un'autorità separata.</p></div><div class="button-row"><span class="count">${members.total}</span>${canAdd ? `<button type="button" data-member-add>${icon("plus", { size: 16 })} Aggiungi persona</button>` : ""}</div></div><ul class="organization-people">${rows || `<li class="empty-state">Nessun membro visibile.</li>`}</ul>${pagination("member", members)}</section>`;
  }

  renderRoles() {
    const canCreate = has(this.data.organization.availableOperations, "organization.role.create");
    const cards = this.data.roles.map((role) => `<article class="role-card"><header><div><span class="resource-mark">${icon("shield", { size: 18 })}</span><div><h3>${escapeHtml(role.name)}</h3><p>${escapeHtml(role.description || "Ruolo personalizzato dell'organizzazione.")}</p></div></div><span class="count">${role.assignmentCount} ${role.assignmentCount === 1 ? "persona" : "persone"}</span></header><div class="role-card__permissions"><strong>${role.permissionCodes.length} permessi effettivi</strong><small>${escapeHtml(role.permissionCodes.slice(0, 5).join(" · "))}${role.permissionCodes.length > 5 ? " …" : ""}</small></div><div class="button-row">${has(role.availableOperations, "organization.role.update") ? `<button type="button" data-role-edit="${escapeHtml(role.id || role._id)}">${icon("edit", { size: 14 })} Modifica</button>` : ""}${has(role.availableOperations, "organization.role.remove") ? `<button class="danger" type="button" data-role-remove="${escapeHtml(role.id || role._id)}" data-role-name="${escapeHtml(role.name)}">${icon("trash", { size: 14 })} Elimina</button>` : ""}</div></article>`).join("");
    return `<section class="organization-section" tabindex="-1"><div class="section-heading"><div><span class="eyebrow">Ruoli</span><h2>Ruoli locali e permessi</h2><p>Le modifiche hanno effetto immediato su tutte le persone a cui il ruolo è assegnato.</p></div>${canCreate ? `<button type="button" data-role-create>${icon("plus", { size: 15 })} Nuovo ruolo</button>` : ""}</div><div class="role-card-grid">${cards || `<div class="empty-state">Nessun ruolo disponibile.</div>`}</div></section>`;
  }

  renderVenues() {
    const { organization, venues } = this.data;
    const canCreate = has(organization.availableOperations, "venue.create");
    const cards = venues.results.map((venue) => `<article class="account-resource-card"><header><span class="resource-mark">${icon("building", { size: 19 })}</span><div><span class="eyebrow">${escapeHtml(venueStateLabel(venue.physicalState))}</span><h3>${escapeHtml(venue.name)}</h3></div></header><p>${escapeHtml(venue.description || "Nessuna descrizione disponibile.")}</p>${venue.availableOperations.length ? `<button type="button" data-venue="${escapeHtml(venue.id)}">${has(venue.availableOperations, "venue.edit") ? "Gestisci sede e spazi fisici" : "Modifica profilo sede"} ${icon("chevron", { size: 15 })}</button>` : ""}</article>`).join("");
    const actions = `<div class="venue-section-actions"><span class="count">${venues.total}</span>${canCreate ? `<artaround-venue-create-dialog organization-id="${escapeHtml(this.state.organizationId)}"></artaround-venue-create-dialog>` : ""}</div>`;
    return `<section class="organization-section" tabindex="-1"><div class="section-heading"><div><span class="eyebrow">Sedi</span><h2>Sedi e spazi fisici</h2><p>Profilo pubblico e configurazione fisica sono capability indipendenti.</p></div>${actions}</div><div class="account-resource-grid">${cards || `<div class="empty-state account-empty">${icon("building", { size: 25 })}<h3>Nessuna sede</h3><p>Aggiungi una sede e scegli il vocabolario fisico con cui iniziare a configurarne gli spazi.</p></div>`}</div>${pagination("venue", venues)}</section>`;
  }

  renderRules() {
    const { organization, namespaces } = this.data;
    const cards = namespaces.results.map((namespace) => `<article class="account-resource-card"><header><span class="resource-mark">${icon("book", { size: 19 })}</span><div><span class="eyebrow">${escapeHtml(resourceStateLabel(namespace.state, "Privata"))}</span><h3>${escapeHtml(namespace.name)}</h3></div></header><p>${escapeHtml(namespace.description || "Nessuna descrizione disponibile.")}</p>${namespace.availableOperations.length ? `<button type="button" data-namespace="${escapeHtml(namespace.id)}">${has(namespace.availableOperations, "namespace.edit") ? "Modifica regole editoriali" : "Visualizza regole editoriali"} ${icon("chevron", { size: 15 })}</button>` : ""}</article>`).join("");
    const create = has(organization.availableOperations, "namespace.create") ? `<button type="button" data-create-namespace-open>${icon("plus", { size: 16 })} Nuove regole editoriali</button>` : "";
    return `<section class="organization-section" tabindex="-1"><div class="section-heading"><div><span class="eyebrow">Regole editoriali</span><h2>Namespace</h2><p>Definiscono linguaggio, durate, presentazione e criteri editoriali usati dai contenuti dell'organizzazione.</p></div><div class="button-row"><span class="count">${namespaces.total}</span>${create}</div></div><div class="account-resource-grid">${cards || `<div class="empty-state account-empty">${icon("book", { size: 25 })}<h3>Nessuna regola editoriale</h3></div>`}</div>${pagination("namespace", namespaces)}</section>`;
  }

  renderPhysicalVocabularies() {
    const { organization, physicalVocabularies } = this.data;
    const cards = physicalVocabularies.results.map((entry) => `<article class="account-resource-card"><header><span class="resource-mark">${icon("route", { size: 19 })}</span><div><span class="eyebrow">${escapeHtml(resourceStateLabel(entry.state))}</span><h3>${escapeHtml(entry.name)}</h3></div></header><p>${escapeHtml(entry.description || "Linguaggio fisico riutilizzabile per spazi, collegamenti e routing.")}</p>${entry.availableOperations.length ? `<button type="button" data-physical-vocabulary="${escapeHtml(entry.id)}">${has(entry.availableOperations, "physical_vocabulary.edit") ? "Configura vocabolario fisico" : "Visualizza vocabolario fisico"} ${icon("chevron", { size: 15 })}</button>` : ""}</article>`).join("");
    const create = has(organization.availableOperations, "physical_vocabulary.create") ? `<button type="button" data-create-physical-open>${icon("plus", { size: 16 })} Nuovo vocabolario fisico</button>` : "";
    return `<section class="organization-section" tabindex="-1"><div class="section-heading"><div><span class="eyebrow">Dominio fisico</span><h2>Vocabolari fisici</h2><p>Definiscono tipi di luoghi, collegamenti, caratteristiche e profili di routing. Sono risorse autonome: le sedi adottano una loro revisione pubblicata.</p></div><div class="button-row"><span class="count">${physicalVocabularies.total}</span>${create}</div></div><div class="account-resource-grid">${cards || `<div class="empty-state account-empty">${icon("route", { size: 25 })}<h3>Nessun vocabolario fisico</h3><p>Creane uno per iniziare a configurare mappe e routing delle sedi.</p></div>`}</div>${pagination("physicalVocabulary", physicalVocabularies)}</section>`;
  }

  renderAudit() {
    if (!this.data.settings.canViewAudit) return "";
    if (!this.audit) return `<section class="settings-card"><div><h3>Registro autorizzativo</h3><p>Consulta modifiche a ruoli, membership e Owner.</p></div><button type="button" data-audit-load>${icon("history", { size: 15 })} Carica registro</button></section>`;
    const rows = this.audit.results.map((event) => `<li><span><strong>${escapeHtml(event.eventType)}</strong><small>${escapeHtml(new Date(event.createdAt).toLocaleString("it-IT"))}</small></span><code>${escapeHtml(event.targetType)}</code></li>`).join("");
    return `<section class="settings-card settings-card--stack"><div><h3>Registro autorizzativo</h3><p>${this.audit.total} eventi conservati.</p></div><ul class="audit-list">${rows || `<li>Nessun evento.</li>`}</ul></section>`;
  }

  renderSettings() {
    const { organization, settings } = this.data;
    return `<section class="organization-section" tabindex="-1"><div class="section-heading"><div><span class="eyebrow">Impostazioni</span><h2>Governance e profilo</h2><p>Owner e permessi ordinari restano deliberatamente separati.</p></div></div>${settings.canManageProfile ? `<section class="settings-card"><div><h3>Profilo dell'organizzazione</h3><p>Nome e descrizione usati nelle superfici pubbliche.</p></div><form data-update-organization><label>Nome<input name="name" value="${escapeHtml(organization.name)}" required></label><label>Descrizione<textarea name="description">${escapeHtml(organization.description || "")}</textarea></label><button>${icon("check", { size: 15 })} Salva profilo</button></form></section>` : ""}${settings.canManageOwners ? `<section class="settings-card"><div><h3>Autorità Owner</h3><p>Puoi nominare o revocare Owner nella sezione Persone. L'ultimo Owner non può essere rimosso.</p></div><button class="button-secondary" type="button" data-organization-section="people">Apri Persone</button></section>` : ""}${this.renderAudit()}</section>`;
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
    this.innerHTML = `<main class="page organization-page" aria-busy="${this.busy}"><nav class="breadcrumb" aria-label="Contesto e percorso"><button type="button" data-context-hub>${icon("arrowLeft", { size: 16 })} Cambia area</button><span>/</span><span>Gestione organizzazione</span><span>/</span><span>${escapeHtml(organization.name)}</span></nav><header class="organization-header"><div><span class="eyebrow">Gestione organizzazione</span><h1>${escapeHtml(organization.name)}</h1><p>${escapeHtml(organization.description || "Nessuna descrizione disponibile.")}</p><div class="organization-role-summary"><span>${escapeHtml(roleNames(organization.roles))}</span>${organization.isOwner ? `<span class="owner-badge">Owner</span>` : ""}</div></div><button class="button-secondary" type="button" data-public-profile>Visualizza profilo pubblico</button></header><nav class="organization-tabs" aria-label="Sezioni gestione organizzazione">${tabs}</nav>${this.busy ? `<p role="status">Aggiornamento…</p>` : ""}${this.message ? `<p class="feedback-success" role="status">${icon("check", { size: 16 })} ${escapeHtml(this.message)}</p>` : ""}${this.error ? `<p role="alert">${icon("warning", { size: 16 })} ${escapeHtml(this.error)}</p>` : ""}${this.renderCurrentSection()}</main>`;
  }
}

customElements.define("artaround-organization-view", ArtAroundOrganizationView);
