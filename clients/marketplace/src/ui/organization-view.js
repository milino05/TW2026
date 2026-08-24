import { navigate } from "../application/router.js";
import { accountRepository } from "../infrastructure/http/account-repository.js";
import { managementRepository } from "../infrastructure/http/management-repository.js";
import { icon } from "./icons.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function has(operations, code) { return (operations || []).some((entry) => entry.code === code); }
function queryState() { const params = new URLSearchParams(window.location.search); return { organizationId: params.get("organizationId"), memberPage: Number(params.get("memberPage")) || 1, venuePage: Number(params.get("venuePage")) || 1, namespacePage: Number(params.get("namespacePage")) || 1, limit: 8 }; }
function pagination(kind, data) {
  if (!data || data.total <= data.pageSize) return "";
  return `<nav class="pager" aria-label="Paginazione ${kind}"><button type="button" data-page-kind="${kind}" data-page="${data.page - 1}" ${data.page <= 1 ? "disabled" : ""}>←</button><span>${data.page} / ${Math.ceil(data.total / data.pageSize)}</span><button type="button" data-page-kind="${kind}" data-page="${data.page + 1}" ${data.page * data.pageSize >= data.total ? "disabled" : ""}>→</button></nav>`;
}

export class ArtAroundOrganizationView extends HTMLElement {
  state = queryState();
  data = null;
  busy = false;
  error = null;
  message = null;

  connectedCallback() { this.addEventListener("click", this.onClick); this.addEventListener("submit", this.onSubmit); this.load(); }
  disconnectedCallback() { this.removeEventListener("click", this.onClick); this.removeEventListener("submit", this.onSubmit); }
  async load() {
    if (!this.state.organizationId) { this.error = "Organization non specificata"; this.render(); return; }
    this.busy = true; this.error = null; this.render();
    try { this.data = await managementRepository.organization(this.state.organizationId, this.state); }
    catch (error) { this.error = error instanceof Error ? error.message : "Organization non disponibile"; }
    finally { this.busy = false; this.render(); }
  }
  async execute(callback, message) {
    this.busy = true; this.error = null; this.message = null; this.render();
    try { await callback(); this.message = message; this.data = await managementRepository.organization(this.state.organizationId, this.state); }
    catch (error) { this.error = error instanceof Error ? error.message : "Operazione non riuscita"; }
    finally { this.busy = false; this.render(); }
  }

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const back = target?.closest("button[data-back]"); if (back) { navigate("/profile"); return; }
    const venue = target?.closest("button[data-venue]"); if (venue) { navigate(`/venues/editor?venueId=${encodeURIComponent(venue.dataset.venue)}`); return; }
    const namespace = target?.closest("button[data-namespace]"); if (namespace) { navigate(`/namespaces/editor?namespaceId=${encodeURIComponent(namespace.dataset.namespace)}`); return; }
    const page = target?.closest("button[data-page-kind]");
    if (page && Number(page.dataset.page) > 0) { this.state[`${page.dataset.pageKind}Page`] = Number(page.dataset.page); await this.load(); return; }
    const role = target?.closest("button[data-member-role]");
    if (role) { await this.execute(() => accountRepository.updateOrganizationMemberRole(this.state.organizationId, role.dataset.userId, role.dataset.memberRole), "Ruolo aggiornato."); return; }
    const remove = target?.closest("button[data-member-remove]");
    if (remove && window.confirm(`Rimuovere ${remove.dataset.username} dall'Organization?`)) await this.execute(() => accountRepository.removeOrganizationMember(this.state.organizationId, remove.dataset.userId), "Membro rimosso.");
  };

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null; if (!form) return;
    const data = new FormData(form);
    if (form.matches("[data-update-organization]")) { event.preventDefault(); await this.execute(() => accountRepository.updateOrganization(this.state.organizationId, { name: String(data.get("name") || ""), description: String(data.get("description") || "") }), "Organization aggiornata."); }
    else if (form.matches("[data-add-member]")) { event.preventDefault(); await this.execute(() => accountRepository.addOrganizationMember(this.state.organizationId, { username: String(data.get("username") || ""), role: "operator" }), "Operator aggiunto."); }
    else if (form.matches("[data-create-venue]")) { event.preventDefault(); await this.execute(() => accountRepository.createVenue({ ownerOrganizationId: this.state.organizationId, name: String(data.get("name") || ""), description: String(data.get("description") || "") }), "Venue creata."); }
    else if (form.matches("[data-create-namespace]")) { event.preventDefault(); await this.execute(() => accountRepository.createNamespace({ ownerType: "organization", ownerId: this.state.organizationId, name: String(data.get("name") || ""), description: String(data.get("description") || "") }), "Namespace creato."); }
  };

  renderMembers() {
    const { organization, members } = this.data;
    const rows = members.results.map((member) => {
      const actions = [
        has(member.availableOperations, "organization.member.promote") ? `<button type="button" data-member-role="manager" data-user-id="${escapeHtml(member.id)}">Promuovi</button>` : "",
        has(member.availableOperations, "organization.member.demote") ? `<button type="button" data-member-role="operator" data-user-id="${escapeHtml(member.id)}">Retrocedi</button>` : "",
        has(member.availableOperations, "organization.member.remove") ? `<button class="danger" type="button" data-member-remove data-user-id="${escapeHtml(member.id)}" data-username="${escapeHtml(member.username)}">Rimuovi</button>` : "",
      ].join("");
      return `<li><span class="avatar">${escapeHtml(member.username[0].toUpperCase())}</span><span class="identity"><strong>${escapeHtml(member.username)}</strong><small>${member.isCreator ? "Creatore · " : ""}${escapeHtml(member.role)}</small></span><span class="actions">${actions}</span></li>`;
    }).join("");
    return `<section class="panel" id="organization-members"><header><div><span class="eyebrow">Persone</span><h2>Membri</h2></div><span class="count">${members.total}</span></header><ul>${rows || `<li class="empty-state">Nessun membro.</li>`}</ul>${pagination("member", members)}${has(organization.availableOperations, "organization.member.add") ? `<details class="inline-create"><summary>${icon("plus", { size: 16 })} Aggiungi membro</summary><form data-add-member><label>Username esatto<input name="username" required placeholder="username"></label><button>${icon("plus", { size: 16 })} Aggiungi operator</button></form></details>` : ""}</section>`;
  }

  renderVenues() {
    const { organization, venues } = this.data;
    const cards = venues.results.map((venue) => `<article class="resource"><div class="card-title-row"><span class="resource-mark">${icon("building", { size: 19 })}</span><div><span class="eyebrow">${escapeHtml(venue.physicalState)}</span><h3>${escapeHtml(venue.name)}</h3></div></div><p>${escapeHtml(venue.description || "Nessuna descrizione")}</p><button type="button" data-venue="${escapeHtml(venue.id)}">Configura sede ${icon("chevron", { size: 16 })}</button></article>`).join("");
    return `<section class="panel" id="organization-venues"><header><div><span class="eyebrow">Dominio fisico</span><h2>Venue</h2></div><span class="count">${venues.total}</span></header><div class="resources">${cards || `<div class="empty-state">${icon("building", { size: 25 })}<h3>Nessuna Venue</h3></div>`}</div>${pagination("venue", venues)}${has(organization.availableOperations, "venue.create") ? `<details><summary>${icon("plus", { size: 16 })} Nuova Venue</summary><form data-create-venue><label>Nome<input name="name" required placeholder="Nome della sede"></label><label>Descrizione<textarea name="description" placeholder="Caratteristiche e funzione della sede"></textarea></label><button>${icon("plus", { size: 16 })} Crea Venue</button></form></details>` : ""}</section>`;
  }

  renderNamespaces() {
    const { organization, namespaces } = this.data;
    const cards = namespaces.results.map((namespace) => `<article class="resource"><div class="card-title-row"><span class="resource-mark">${icon("book", { size: 19 })}</span><div><span class="eyebrow">${escapeHtml(namespace.state.mode)}${namespace.state.version ? ` · v${namespace.state.version}` : ""}</span><h3>${escapeHtml(namespace.name)}</h3></div></div><p>${escapeHtml(namespace.description || "Nessuna descrizione")}</p><button type="button" data-namespace="${escapeHtml(namespace.id)}">Apri editor ${icon("chevron", { size: 16 })}</button></article>`).join("");
    return `<section class="panel" id="organization-namespaces"><header><div><span class="eyebrow">Dominio editoriale</span><h2>Namespace</h2></div><span class="count">${namespaces.total}</span></header><div class="resources">${cards || `<div class="empty-state">${icon("book", { size: 25 })}<h3>Nessun Namespace</h3></div>`}</div>${pagination("namespace", namespaces)}${has(organization.availableOperations, "namespace.create") ? `<details><summary>${icon("plus", { size: 16 })} Nuovo Namespace</summary><form data-create-namespace><label>Nome<input name="name" required placeholder="Nome del Namespace"></label><label>Descrizione<textarea name="description" placeholder="Ambito e finalità editoriali"></textarea></label><button>${icon("plus", { size: 16 })} Crea Namespace</button></form></details>` : ""}</section>`;
  }

  render() {
    if (!this.data) { this.innerHTML = `<main><p role="${this.error ? "alert" : "status"}">${escapeHtml(this.error || "Caricamento Organization…")}</p></main>`; return; }
    const organization = this.data.organization;
    this.innerHTML = `<style>:host{display:block;background:#f3f2ed;color:#18352e;min-height:calc(100vh - 4rem)}*{box-sizing:border-box}main{max-width:78rem;margin:auto;padding:2rem 1rem 5rem}.back{background:transparent;color:#23483e;padding-left:0}.hero{display:flex;justify-content:space-between;gap:1rem;padding:1.6rem;border-radius:1.2rem;background:#254d43;color:white}.hero h1{margin:.3rem 0}.eyebrow{display:block;font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;font-weight:800;color:#638078}.hero .eyebrow{color:#b8d7ca}.feedback{padding:.8rem;background:white;border-radius:.7rem}.layout{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:1rem}.panel{padding:1.25rem;border:1px solid #d5d7d0;border-radius:1rem;background:white}.panel:first-child{grid-column:1/-1}.panel header{display:flex;justify-content:space-between;align-items:end}.panel h2{margin:.2rem 0}.settings{margin-top:1rem}ul{list-style:none;padding:0;display:grid;gap:.5rem}li{display:flex;align-items:center;gap:.65rem;padding:.65rem;border-radius:.7rem;background:#f2f5f2}.avatar{display:grid;place-items:center;width:2rem;height:2rem;border-radius:50%;background:#dce9e3;font-weight:800}.identity{display:grid;flex:1}.identity small{color:#60706a}.actions{display:flex;gap:.35rem}.resources{display:grid;gap:.7rem;margin:1rem 0}.resource{padding:1rem;border-radius:.8rem;background:#f5f6f2}.resource h3{margin:.2rem 0}.resource p{color:#5d6b67}form{display:grid;gap:.7rem;margin-top:1rem}label{display:grid;gap:.3rem;font-size:.85rem;font-weight:700}input,textarea,button{font:inherit}input,textarea{padding:.65rem;border:1px solid #adbbb5;border-radius:.55rem}button{width:max-content;padding:.55rem .75rem;border:0;border-radius:.55rem;background:#173e35;color:white;font-weight:750;cursor:pointer}button.danger{background:#f7e6e3;color:#8c2d22}.pager{display:flex;justify-content:center;gap:.7rem;align-items:center;margin:1rem 0}details{margin-top:1rem;padding: .8rem;border:1px dashed #91a39b;border-radius:.7rem}summary{cursor:pointer;font-weight:800}@media(max-width:50rem){.layout{grid-template-columns:1fr}.panel:first-child{grid-column:auto}.hero{display:grid}.actions{flex-wrap:wrap}}</style><main class="organization-page" aria-busy="${this.busy}"><nav class="breadcrumb" aria-label="Percorso"><button type="button" data-back>${icon("arrowLeft", { size: 16 })} Profilo</button><span>/</span><span>Organization</span></nav><section class="hero organization-hero"><div><span class="eyebrow">Organization · ${escapeHtml(organization.role)}</span><h1>${escapeHtml(organization.name)}</h1><p>${escapeHtml(organization.description || "Nessuna descrizione")}</p></div><span class="role-chip">${organization.isCreator ? "Creatore" : escapeHtml(organization.role)}</span></section><nav class="organization-shortcuts" aria-label="Sezioni Organization"><a href="#organization-members">Membri <span>${this.data.members.total}</span></a><a href="#organization-venues">Venue <span>${this.data.venues.total}</span></a><a href="#organization-namespaces">Namespace <span>${this.data.namespaces.total}</span></a></nav>${this.busy ? `<p class="feedback" role="status">Aggiornamento…</p>` : ""}${this.message ? `<p class="feedback" role="status">${icon("check", { size: 17 })} ${escapeHtml(this.message)}</p>` : ""}${this.error ? `<p class="feedback" role="alert">${icon("warning", { size: 17 })} ${escapeHtml(this.error)}</p>` : ""}${has(organization.availableOperations, "organization.update") ? `<details class="settings"><summary>${icon("edit", { size: 16 })} Impostazioni Organization</summary><form data-update-organization><label>Nome<input name="name" value="${escapeHtml(organization.name)}" required></label><label>Descrizione<textarea name="description">${escapeHtml(organization.description)}</textarea></label><button>${icon("check", { size: 16 })} Salva</button></form></details>` : ""}<div class="layout">${this.renderMembers()}${this.renderVenues()}${this.renderNamespaces()}</div></main>`;
  }
}

customElements.define("artaround-organization-view", ArtAroundOrganizationView);
