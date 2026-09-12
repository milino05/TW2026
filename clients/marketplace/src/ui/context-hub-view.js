import { navigate } from "../application/router.js";
import { setOperatingContext } from "../application/operating-context.js";
import { accountRepository } from "../infrastructure/http/account-repository.js";
import { icon } from "./icons.js";
import { createTaskDialog } from "./task-dialog.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function roleLabel(roles = []) { return roles.map((role) => role.name).join(" · ") || "Membro"; }
function hasOperation(operations = [], code) { return operations.some((entry) => entry.code === code); }

export class ArtAroundContextHubView extends HTMLElement {
  workspace = null;
  busy = false;
  error = null;
  organizationDialog = null;
  organizationDirty = false;
  organizationDraft = { name: "", description: "" };
  organizationError = null;

  connectedCallback() {
    this.addEventListener("click", this.onClick);
    this.load();
  }
  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.organizationDialog?.close({ restoreFocus: false, notify: false });
    this.organizationDialog = null;
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
        roles: JSON.parse(context.dataset.contextRoles || "[]"),
        isOwner: context.dataset.contextOwner === "true",
      });
      return;
    }
    if (target?.closest("button[data-context-retry]")) { this.load(); return; }
    if (target?.closest("button[data-create-organization-start]")) this.openOrganizationDialog();
  };

  openOrganizationDialog() {
    if (this.organizationDialog) return;
    this.organizationDirty = false;
    this.organizationError = null;
    this.organizationDraft = { name: "", description: "" };
    this.organizationDialog = createTaskDialog({
      eyebrow: "Nuova organizzazione",
      title: "Crea il nuovo spazio di lavoro",
      description: "Servono solo nome e descrizione. Sedi, persone e regole editoriali potranno essere configurate dopo.",
      size: "compact",
      initialFocus: "input[name='name']",
      renderBody: () => `${this.organizationError ? `<artaround-callout tone="danger" role="alert">${escapeHtml(this.organizationError)}</artaround-callout>` : ""}<form id="create-organization-form" data-create-organization><label>Nome<input name="name" required maxlength="160" placeholder="Nome dell'organizzazione" value="${escapeHtml(this.organizationDraft.name)}"></label><label>Descrizione<textarea name="description" rows="4" placeholder="Scopo e attività principali">${escapeHtml(this.organizationDraft.description)}</textarea></label></form>`,
      renderFooter: () => `<button class="button-secondary" type="button" data-modal-dismiss ${this.busy ? "disabled" : ""}>Annulla</button><button type="submit" form="create-organization-form" ${this.busy ? "disabled" : ""}>${icon("plus", { size: 16 })} ${this.busy ? "Creazione…" : "Crea e apri"}</button>`,
      isBusy: () => this.busy,
      isDirty: () => this.organizationDirty,
      onDiscard: () => { this.organizationDirty = false; },
      onDismiss: () => { this.organizationDialog = null; },
      onInput: (event) => {
        const field = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ? event.target : null;
        if (!field?.form?.matches("[data-create-organization]")) return;
        if (!Object.prototype.hasOwnProperty.call(this.organizationDraft, field.name)) return;
        this.organizationDraft[field.name] = field.value;
        this.organizationDirty = true;
      },
      onSubmit: (event) => {
        const form = event.target instanceof HTMLFormElement ? event.target : null;
        if (!form?.matches("[data-create-organization]")) return;
        event.preventDefault();
        if (!form.reportValidity()) return;
        void this.createOrganization(form);
      },
    });
  }

  async createOrganization(form) {
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const description = String(data.get("description") || "").trim();
    if (!name || this.busy) return;
    this.organizationDraft = { name, description };
    this.busy = true;
    this.organizationError = null;
    this.organizationDialog?.render();
    try {
      const created = await accountRepository.createOrganization({ name, description });
      const organizationId = String(created?.id || created?._id || "");
      if (!organizationId) throw new Error("L'organizzazione è stata creata ma non è stato restituito il suo identificatore");
      this.workspace = await accountRepository.workspace();
      const organization = this.workspace.organizations.find((entry) => String(entry.id) === organizationId);
      this.organizationDirty = false;
      this.organizationDialog?.close({ restoreFocus: false, notify: false });
      this.organizationDialog = null;
      this.choose({
        type: "organization",
        id: organizationId,
        name: organization?.name || created.name || name,
        roles: organization?.roles || [],
        isOwner: organization?.isOwner === true,
      });
    } catch (error) {
      this.organizationError = error instanceof Error ? error.message : "Organizzazione non creata";
      this.busy = false;
      this.organizationDialog?.render();
      this.organizationDialog?.focus("input[name='name']");
    }
  }

  renderOrganizationCard(organization) {
    const counts = [
      Number.isFinite(organization.counts?.venues) ? `${organization.counts.venues} sedi` : null,
      Number.isFinite(organization.counts?.members) ? `${organization.counts.members} persone` : null,
    ].filter(Boolean).join(" · ");
    return `<button class="context-card" type="button" data-context-type="organization" data-context-id="${escapeHtml(organization.id)}" data-context-name="${escapeHtml(organization.name)}" data-context-roles="${escapeHtml(JSON.stringify(organization.roles || []))}" data-context-owner="${organization.isOwner === true}"><span class="context-card__icon">${icon("building", { size: 24 })}</span><span class="context-card__body"><span class="context-card__badges"><span class="eyebrow">${escapeHtml(roleLabel(organization.roles))}</span>${organization.isOwner ? `<span class="owner-badge">Owner</span>` : ""}</span><strong>${escapeHtml(organization.name)}</strong><small>${escapeHtml(organization.description || "Gestisci risorse, visite, sedi e pubblicazioni dell'organizzazione.")}</small>${counts ? `<span class="context-card__counts">${escapeHtml(counts)}</span>` : ""}</span><span class="context-card__action">Entra ${icon("chevron", { size: 15 })}</span></button>`;
  }

  renderCreateCard() {
    if (!hasOperation(this.workspace?.account?.availableOperations, "organization.create")) return "";
    return `<button class="context-card context-card--create" type="button" data-create-organization-start><span class="context-card__plus">${icon("plus", { size: 28 })}</span><span class="context-card__body"><strong>Crea un'organizzazione</strong><small>Crea uno spazio per un museo, una fondazione o un altro ente culturale.</small></span></button>`;
  }

  render() {
    if (!this.workspace) {
      this.innerHTML = `<main class="context-hub-page"><div class="empty-state"><div class="skeleton skeleton-line" style="width:14rem"></div><p>${escapeHtml(this.error || "Caricamento delle aree disponibili…")}</p>${this.error ? `<button type="button" data-context-retry>Riprova</button>` : ""}</div></main>`;
      return;
    }
    const account = this.workspace.account;
    const organizations = this.workspace.organizations || [];
    this.innerHTML = `<main class="context-hub-page" aria-busy="${this.busy}"><header class="context-hub-hero"><span class="eyebrow">Bentornato, ${escapeHtml(account.username)}</span><h1>Come vuoi usare ArtAround?</h1><p>Scegli l'area in cui vuoi lavorare. La scelta vale per questa sessione e potrai cambiarla in qualsiasi momento.</p></header>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}<section class="context-section"><div class="section-heading"><div><span class="eyebrow">Personale</span><h2>Il tuo account</h2></div></div><div class="context-grid context-grid--personal"><button class="context-card" type="button" data-context-type="user" data-context-id="${escapeHtml(account.id)}" data-context-name="${escapeHtml(account.username)}"><span class="context-card__icon">${icon("user", { size: 24 })}</span><span class="context-card__body"><span class="eyebrow">Area personale</span><strong>${escapeHtml(account.username)}</strong><small>Crea, acquisisci e pubblica con il tuo account personale.</small></span><span class="context-card__action">Entra ${icon("chevron", { size: 15 })}</span></button></div></section><section class="context-section"><div class="section-heading"><div><span class="eyebrow">Collaborazione</span><h2>Le tue organizzazioni</h2><p>Apri una realtà con cui collabori oppure creane una nuova.</p></div><span class="count">${organizations.length}</span></div><div class="context-grid">${organizations.map((entry) => this.renderOrganizationCard(entry)).join("")}${this.renderCreateCard()}</div></section></main>`;
  }
}

customElements.define("artaround-context-hub-view", ArtAroundContextHubView);
