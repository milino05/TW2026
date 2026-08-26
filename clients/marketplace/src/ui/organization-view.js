import { navigate } from "../application/router.js";
import { accountRepository } from "../infrastructure/http/account-repository.js";
import { managementRepository } from "../infrastructure/http/management-repository.js";
import { icon } from "./icons.js";

const SECTIONS = new Set(["overview", "people", "venues", "rules"]);
function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function has(operations, code) { return (operations || []).some((entry) => entry.code === code); }
function roleLabel(role) { return role === "manager" ? "Manager" : "Operatore"; }
function venueStateLabel(state) { if (state === "published") return "Pubblicata"; if (state === "working") return "Configurazione in corso"; return "Da configurare"; }
function rulesStateLabel(state) { if (state?.mode === "published") return `Pubblicate${state.version ? ` · v${state.version}` : ""}`; if (state?.mode === "working") return `Bozza${state.version ? ` · v${state.version}` : ""}`; return "Da configurare"; }
function queryState() { const params = new URLSearchParams(window.location.search); const section = SECTIONS.has(params.get("section")) ? params.get("section") : "overview"; return { organizationId: params.get("organizationId"), section, memberPage: Math.max(1, Number(params.get("memberPage")) || 1), venuePage: Math.max(1, Number(params.get("venuePage")) || 1), namespacePage: Math.max(1, Number(params.get("namespacePage")) || 1), limit: 8 }; }
function sectionRoute(state, overrides = {}) { const next = { ...state, ...overrides }; const params = new URLSearchParams({ organizationId: String(next.organizationId), section: next.section || "overview" }); if (next.memberPage > 1) params.set("memberPage", String(next.memberPage)); if (next.venuePage > 1) params.set("venuePage", String(next.venuePage)); if (next.namespacePage > 1) params.set("namespacePage", String(next.namespacePage)); return `/organizations/detail?${params.toString()}`; }
function pagination(kind, data) { if (!data || data.total <= data.pageSize) return ""; return `<nav class="pagination" aria-label="Pagine ${kind}"><button type="button" data-page-kind="${kind}" data-page="${data.page - 1}" ${data.page <= 1 ? "disabled" : ""}>${icon("arrowLeft", { size: 14 })} Precedente</button><span>Pagina ${data.page} di ${Math.ceil(data.total / data.pageSize)}</span><button type="button" data-page-kind="${kind}" data-page="${data.page + 1}" ${data.page * data.pageSize >= data.total ? "disabled" : ""}>Successiva ${icon("chevron", { size: 14 })}</button></nav>`; }

export class ArtAroundOrganizationView extends HTMLElement {
  state = queryState();
  data = null;
  busy = false;
  error = null;
  message = null;
  memberRemoval = null;

  connectedCallback() { this.addEventListener("click", this.onClick); this.addEventListener("submit", this.onSubmit); this.load(); }
  disconnectedCallback() { this.removeEventListener("click", this.onClick); this.removeEventListener("submit", this.onSubmit); }

  async load() {
    if (!this.state.organizationId) { this.error = "Organizzazione non specificata"; this.render(); return; }
    this.busy = true; this.error = null; this.render();
    try { this.data = await managementRepository.organization(this.state.organizationId, this.state); }
    catch (error) { this.error = error instanceof Error ? error.message : "Organizzazione non disponibile"; }
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
    const page = target?.closest("[data-page-kind]");
    if (page && Number(page.dataset.page) > 0) { navigate(sectionRoute(this.state, { [`${page.dataset.pageKind}Page`]: Number(page.dataset.page) })); return; }
    const role = target?.closest("[data-member-role]");
    if (role) { await this.execute(() => accountRepository.updateOrganizationMemberRole(this.state.organizationId, role.dataset.userId, role.dataset.memberRole), "Ruolo aggiornato."); return; }
    const remove = target?.closest("[data-member-remove]");
    if (remove) { this.memberRemoval = { userId: remove.dataset.userId, username: remove.dataset.username }; this.message = null; this.render(); return; }
    if (target?.closest("[data-cancel-member-remove]")) { this.memberRemoval = null; this.render(); return; }
    if (target?.closest("[data-confirm-member-remove]") && this.memberRemoval) {
      const current = this.memberRemoval;
      this.memberRemoval = null;
      await this.execute(() => accountRepository.removeOrganizationMember(this.state.organizationId, current.userId), `${current.username} è stato rimosso dall'organizzazione.`);
    }
  };

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    const data = new FormData(form);
    if (form.matches("[data-update-organization]")) { event.preventDefault(); await this.execute(() => accountRepository.updateOrganization(this.state.organizationId, { name: String(data.get("name") || ""), description: String(data.get("description") || "") }), "Organizzazione aggiornata."); }
    else if (form.matches("[data-add-member]")) { event.preventDefault(); await this.execute(() => accountRepository.addOrganizationMember(this.state.organizationId, { username: String(data.get("username") || ""), role: "operator" }), "Persona aggiunta come operatore."); }
    else if (form.matches("[data-create-venue]")) { event.preventDefault(); await this.execute(() => accountRepository.createVenue({ ownerOrganizationId: this.state.organizationId, name: String(data.get("name") || ""), description: String(data.get("description") || "") }), "Sede creata."); }
    else if (form.matches("[data-create-namespace]")) { event.preventDefault(); const created = await this.execute(() => accountRepository.createNamespace({ ownerType: "organization", ownerId: this.state.organizationId, name: String(data.get("name") || ""), description: String(data.get("description") || "") }), "Regole editoriali create."); const createdId = created?.namespace?._id || created?.namespace?.id; if (createdId) navigate(`/namespaces/editor?namespaceId=${encodeURIComponent(createdId)}`); }
  };

  renderRemovalConfirmation() {
    if (!this.memberRemoval) return "";
    return `<section class="confirmation-panel organization-confirmation" role="alert"><div><strong>Rimuovere ${escapeHtml(this.memberRemoval.username)} dall'organizzazione?</strong><p>Perderà l'accesso come membro dell'organizzazione. Le risorse restano di proprietà dei rispettivi owner.</p></div><div class="button-row"><button class="danger" type="button" data-confirm-member-remove ${this.busy ? "disabled" : ""}>Conferma rimozione</button><button class="button-secondary" type="button" data-cancel-member-remove>Annulla</button></div></section>`;
  }

  renderOverview() {
    const { organization, members, venues, namespaces } = this.data;
    return `<section class="organization-overview"><div class="organization-overview__intro"><span class="eyebrow">Panoramica</span><h2>Gestione dell'organizzazione</h2><p>Persone, sedi e regole editoriali sono aree amministrative distinte. Il profilo pubblico resta separato da questa console.</p></div><div class="organization-summary-grid"><button type="button" data-organization-section="people"><span>${icon("user", { size: 20 })}</span><strong>${members.total}</strong><small>Persone</small></button><button type="button" data-organization-section="venues"><span>${icon("building", { size: 20 })}</span><strong>${venues.total}</strong><small>Sedi</small></button><button type="button" data-organization-section="rules"><span>${icon("book", { size: 20 })}</span><strong>${namespaces.total}</strong><small>Regole editoriali</small></button></div>${has(organization.availableOperations, "organization.update") ? `<details class="account-create"><summary>${icon("edit", { size: 16 })} Impostazioni organizzazione</summary><form data-update-organization><label>Nome<input name="name" value="${escapeHtml(organization.name)}" required></label><label>Descrizione<textarea name="description">${escapeHtml(organization.description || "")}</textarea></label><button>${icon("check", { size: 16 })} Salva modifiche</button></form></details>` : ""}</section>`;
  }

  renderPeople() {
    const { organization, members } = this.data;
    const rows = members.results.map((member) => {
      const actions = [
        has(member.availableOperations, "organization.member.promote") ? `<button type="button" data-member-role="manager" data-user-id="${escapeHtml(member.id)}">Promuovi a manager</button>` : "",
        has(member.availableOperations, "organization.member.demote") ? `<button class="button-secondary" type="button" data-member-role="operator" data-user-id="${escapeHtml(member.id)}">Imposta operatore</button>` : "",
        has(member.availableOperations, "organization.member.remove") ? `<button class="danger" type="button" data-member-remove data-user-id="${escapeHtml(member.id)}" data-username="${escapeHtml(member.username)}">Rimuovi</button>` : "",
      ].join("");
      return `<li class="organization-person"><span class="avatar">${escapeHtml(member.username[0].toUpperCase())}</span><span class="identity"><strong>${escapeHtml(member.username)}</strong><small>${member.isCreator ? "Creatore · " : ""}${escapeHtml(roleLabel(member.role))}</small></span><span class="actions">${actions}</span></li>`;
    }).join("");
    return `<section class="organization-section"><div class="section-heading"><div><span class="eyebrow">Persone</span><h2>Membri dell'organizzazione</h2><p>I ruoli e le azioni disponibili sono determinati dal backend.</p></div><span class="count">${members.total}</span></div>${this.renderRemovalConfirmation()}<ul class="organization-people">${rows || `<li class="empty-state">Nessun membro.</li>`}</ul>${pagination("member", members)}${has(organization.availableOperations, "organization.member.add") ? `<details class="account-create"><summary>${icon("plus", { size: 16 })} Aggiungi persona</summary><form data-add-member><label>Username esatto<input name="username" required placeholder="username"></label><p class="note">La persona verrà aggiunta inizialmente come operatore.</p><button>${icon("plus", { size: 16 })} Aggiungi</button></form></details>` : ""}</section>`;
  }

  renderVenues() {
    const { organization, venues } = this.data;
    const cards = venues.results.map((venue) => `<article class="account-resource-card"><header><span class="resource-mark">${icon("building", { size: 19 })}</span><div><span class="eyebrow">${escapeHtml(venueStateLabel(venue.physicalState))}</span><h3>${escapeHtml(venue.name)}</h3></div></header><p>${escapeHtml(venue.description || "Nessuna descrizione disponibile.")}</p><button type="button" data-venue="${escapeHtml(venue.id)}">Gestisci sede e spazi fisici ${icon("chevron", { size: 15 })}</button></article>`).join("");
    return `<section class="organization-section"><div class="section-heading"><div><span class="eyebrow">Sedi</span><h2>Sedi e spazi fisici</h2><p>Luoghi, oggetti esposti e configurazione fisica dell'organizzazione.</p></div><span class="count">${venues.total}</span></div><div class="account-resource-grid">${cards || `<div class="empty-state account-empty">${icon("building", { size: 25 })}<h3>Nessuna sede</h3><p>Crea la prima sede per configurare gli spazi fisici.</p></div>`}</div>${pagination("venue", venues)}${has(organization.availableOperations, "venue.create") ? `<details class="account-create"><summary>${icon("plus", { size: 16 })} Nuova sede</summary><form data-create-venue><label>Nome<input name="name" required placeholder="Nome della sede"></label><label>Descrizione<textarea name="description" placeholder="Caratteristiche e funzione della sede"></textarea></label><button>${icon("plus", { size: 16 })} Crea sede</button></form></details>` : ""}</section>`;
  }

  renderRules() {
    const { organization, namespaces } = this.data;
    const cards = namespaces.results.map((namespace) => `<article class="account-resource-card"><header><span class="resource-mark">${icon("book", { size: 19 })}</span><div><span class="eyebrow">${escapeHtml(rulesStateLabel(namespace.state))}</span><h3>${escapeHtml(namespace.name)}</h3></div></header><p>${escapeHtml(namespace.description || "Nessuna descrizione disponibile.")}</p><button type="button" data-namespace="${escapeHtml(namespace.id)}">Modifica regole editoriali ${icon("chevron", { size: 15 })}</button></article>`).join("");
    return `<section class="organization-section"><div class="section-heading"><div><span class="eyebrow">Regole editoriali</span><h2>Regole editoriali dell'organizzazione</h2><p>Vocabolari, livelli, durate e criteri usati dai contenuti dell'organizzazione.</p></div><span class="count">${namespaces.total}</span></div><div class="account-resource-grid">${cards || `<div class="empty-state account-empty">${icon("book", { size: 25 })}<h3>Nessuna regola editoriale</h3><p>Crea le regole che guideranno l'authoring dell'organizzazione.</p></div>`}</div>${pagination("namespace", namespaces)}${has(organization.availableOperations, "namespace.create") ? `<details class="account-create"><summary>${icon("plus", { size: 16 })} Nuove regole editoriali</summary><form data-create-namespace><div class="namespace-create-intro"><strong>Da dove si parte?</strong><p>Crea il contenitore delle regole: nella schermata successiva troverai spiegazioni, tutorial e un modello già pronto facoltativo.</p></div><label>Nome<input name="name" required placeholder="Es. Regole della collezione permanente"><small>Usa un nome che faccia capire a quale progetto o collezione si applicano.</small></label><label>Scopo e pubblico<textarea name="description" placeholder="Es. Indicazioni per raccontare le opere a un pubblico adulto non specialista."></textarea><small>Descrivi in una frase per quali contenuti e visitatori sono pensate.</small></label><button>${icon("plus", { size: 16 })} Crea e configura</button></form></details>` : ""}</section>`;
  }

  renderCurrentSection() {
    if (this.state.section === "people") return this.renderPeople();
    if (this.state.section === "venues") return this.renderVenues();
    if (this.state.section === "rules") return this.renderRules();
    return this.renderOverview();
  }

  render() {
    if (!this.data) { this.innerHTML = `<main class="page organization-page"><p role="${this.error ? "alert" : "status"}">${escapeHtml(this.error || "Caricamento organizzazione…")}</p></main>`; return; }
    const organization = this.data.organization;
    const tabs = [["overview", "Panoramica"], ["people", `Persone (${this.data.members.total})`], ["venues", `Sedi (${this.data.venues.total})`], ["rules", `Regole editoriali (${this.data.namespaces.total})`]].map(([key, label]) => `<button type="button" data-organization-section="${key}" aria-current="${this.state.section === key ? "page" : "false"}">${escapeHtml(label)}</button>`).join("");
    this.innerHTML = `<main class="page organization-page" aria-busy="${this.busy}"><nav class="breadcrumb" aria-label="Percorso"><button type="button" data-back>${icon("arrowLeft", { size: 16 })} Account</button><span>/</span><span>Gestione organizzazione</span><span>/</span><span>${escapeHtml(organization.name)}</span></nav><header class="organization-header"><div><span class="eyebrow">Gestione organizzazione · ${escapeHtml(roleLabel(organization.role))}</span><h1>${escapeHtml(organization.name)}</h1><p>${escapeHtml(organization.description || "Nessuna descrizione disponibile.")}</p></div><div class="button-row"><span class="role-chip">${organization.isCreator ? "Creatore" : escapeHtml(roleLabel(organization.role))}</span><button class="button-secondary" type="button" data-public-profile>Visualizza profilo pubblico</button></div></header><nav class="organization-tabs" aria-label="Sezioni gestione organizzazione">${tabs}</nav>${this.busy ? `<p role="status">Aggiornamento…</p>` : ""}${this.message ? `<p role="status">${icon("check", { size: 16 })} ${escapeHtml(this.message)}</p>` : ""}${this.error ? `<p role="alert">${icon("warning", { size: 16 })} ${escapeHtml(this.error)}</p>` : ""}${this.renderCurrentSection()}</main>`;
  }
}

customElements.define("artaround-organization-view", ArtAroundOrganizationView);
