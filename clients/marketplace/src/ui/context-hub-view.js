import { navigate } from "../application/router.js";
import { setOperatingContext } from "../application/operating-context.js";
import { accountRepository } from "../infrastructure/http/account-repository.js";
import { icon } from "./icons.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function roleLabel(role) { return role === "manager" ? "Manager" : role === "operator" ? "Operatore" : "Membro"; }
function hasOperation(operations = [], code) { return operations.some((entry) => entry.code === code); }

export class ArtAroundContextHubView extends HTMLElement {
  workspace = null;
  busy = false;
  error = null;
  creating = false;

  connectedCallback() {
    this.addEventListener("click", this.onClick);
    this.addEventListener("submit", this.onSubmit);
    this.load();
  }
  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("submit", this.onSubmit);
  }

  async load() {
    this.busy = true;
    this.error = null;
    this.render();
    try { this.workspace = await accountRepository.workspace(); }
    catch (error) { this.error = error instanceof Error ? error.message : "Le aree disponibili non possono essere caricate"; }
    finally { this.busy = false; this.render(); }
  }

  choose(context) {
    setOperatingContext(context);
    navigate("/home");
  }

  onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const context = target?.closest("button[data-context-type]");
    if (context) {
      this.choose({
        type: context.dataset.contextType,
        id: context.dataset.contextId,
        name: context.dataset.contextName,
        role: context.dataset.contextRole || null,
      });
      return;
    }
    if (target?.closest("button[data-context-retry]")) { this.load(); return; }
    if (target?.closest("button[data-create-organization-start]")) { this.creating = true; this.error = null; this.render(); return; }
    if (target?.closest("button[data-create-organization-cancel]")) { this.creating = false; this.error = null; this.render(); }
  };

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.matches("form[data-create-organization]")) return;
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const description = String(data.get("description") || "").trim();
    if (!name) return;
    this.busy = true;
    this.error = null;
    this.render();
    try {
      const created = await accountRepository.createOrganization({ name, description });
      const organizationId = String(created?.id || created?._id || "");
      if (!organizationId) throw new Error("L'organizzazione è stata creata ma non è stato restituito il suo identificatore");
      this.choose({ type: "organization", id: organizationId, name: created.name || name, role: "manager" });
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Organizzazione non creata";
      this.busy = false;
      this.render();
    }
  };

  renderOrganizationCard(organization) {
    return `<button class="context-card" type="button" data-context-type="organization" data-context-id="${escapeHtml(organization.id)}" data-context-name="${escapeHtml(organization.name)}" data-context-role="${escapeHtml(organization.role || "")}"><span class="context-card__icon">${icon("building", { size: 24 })}</span><span class="context-card__body"><span class="eyebrow">${escapeHtml(roleLabel(organization.role))}</span><strong>${escapeHtml(organization.name)}</strong><small>${escapeHtml(organization.description || "Gestisci risorse, visite, sedi e pubblicazioni dell'organizzazione.")}</small><span class="context-card__counts">${Number(organization.counts?.venues || 0)} sedi · ${Number(organization.counts?.members || 0)} persone</span></span><span class="context-card__action">Entra ${icon("chevron", { size: 15 })}</span></button>`;
  }

  renderCreateCard() {
    if (!hasOperation(this.workspace?.account?.availableOperations, "organization.create")) return "";
    if (!this.creating) return `<button class="context-card context-card--create" type="button" data-create-organization-start><span class="context-card__plus">${icon("plus", { size: 28 })}</span><span class="context-card__body"><strong>Crea un'organizzazione</strong><small>Crea uno spazio per un museo, una fondazione o un altro ente culturale.</small></span></button>`;
    return `<section class="context-create panel"><header><div><span class="eyebrow">Nuova organizzazione</span><h2>Crea il nuovo spazio di lavoro</h2><p>Servono solo nome e descrizione. Sedi, persone e regole editoriali potranno essere configurate dopo.</p></div></header><form data-create-organization><label>Nome<input name="name" required maxlength="160" placeholder="Nome dell'organizzazione"></label><label>Descrizione<textarea name="description" rows="4" placeholder="Scopo e attività principali"></textarea></label><div class="button-row"><button type="submit" ${this.busy ? "disabled" : ""}>${icon("plus", { size: 16 })} Crea e apri</button><button class="button-secondary" type="button" data-create-organization-cancel ${this.busy ? "disabled" : ""}>Annulla</button></div></form></section>`;
  }

  render() {
    if (!this.workspace) {
      this.innerHTML = `<main class="context-hub-page"><div class="empty-state"><div class="skeleton skeleton-line" style="width:14rem"></div><p>${escapeHtml(this.error || "Caricamento delle aree disponibili…")}</p>${this.error ? `<button type="button" data-context-retry>Riprova</button>` : ""}</div></main>`;
      return;
    }
    const account = this.workspace.account;
    const organizations = this.workspace.organizations || [];
    this.innerHTML = `<main class="context-hub-page" aria-busy="${this.busy}"><header class="context-hub-hero"><span class="eyebrow">Bentornato, ${escapeHtml(account.username)}</span><h1>Come vuoi usare ArtAround?</h1><p>Scegli l'area in cui vuoi lavorare. La scelta vale per questa sessione e potrai cambiarla in qualsiasi momento.</p></header>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}<section class="context-section"><div class="section-heading"><div><span class="eyebrow">Personale</span><h2>Il tuo account</h2></div></div><div class="context-grid context-grid--personal"><button class="context-card" type="button" data-context-type="user" data-context-id="${escapeHtml(account.id)}" data-context-name="${escapeHtml(account.username)}"><span class="context-card__icon">${icon("user", { size: 24 })}</span><span class="context-card__body"><span class="eyebrow">Area personale</span><strong>${escapeHtml(account.username)}</strong><small>Crea, acquisisci e pubblica con il tuo account personale.</small></span><span class="context-card__action">Entra ${icon("chevron", { size: 15 })}</span></button></div></section><section class="context-section"><div class="section-heading"><div><span class="eyebrow">Collaborazione</span><h2>Le tue organizzazioni</h2><p>Apri una realtà con cui collabori oppure creane una nuova.</p></div><span class="count">${organizations.length}</span></div><div class="context-grid">${organizations.map((entry) => this.renderOrganizationCard(entry)).join("")}${!this.creating ? this.renderCreateCard() : ""}</div>${this.creating ? this.renderCreateCard() : ""}</section></main>`;
  }
}

customElements.define("artaround-context-hub-view", ArtAroundContextHubView);
