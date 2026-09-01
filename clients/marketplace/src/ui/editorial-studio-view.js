import { navigate } from "../application/router.js";
import { operatingPrincipal, readOperatingContext } from "../application/operating-context.js";
import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { openActionDialog } from "./feedback-primitives.js";
import { icon } from "./icons.js";
import "./editorial-collection-content-manager.js";
import "./semantic-graph-editor.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function formatDate(value) { if (!value) return "—"; try { return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); } catch { return String(value); } }
function statusLabel(value) { return ({ in_review: "In revisione", approved: "Approvata", changes_requested: "Modifiche richieste", published: "Pubblicata", withdrawn: "Ritirata" })[value] || value || "In lavorazione"; }

export class ArtAroundEditorialStudioView extends HTMLElement {
  context = readOperatingContext();
  editorialContextId = null;
  section = "overview";
  data = null;
  revisions = [];
  releases = [];
  busy = false;
  error = null;
  requestingChanges = false;

  connectedCallback() {
    const params = new URLSearchParams(window.location.search);
    this.editorialContextId = params.get("editorialContextId");
    this.section = ["overview", "content", "relations", "publication", "settings"].includes(params.get("section")) ? params.get("section") : "overview";
    this.addEventListener("click", this.onClick);
    this.addEventListener("submit", this.onSubmit);
    this.addEventListener("editorial-content-changed", this.onChildChanged);
    this.addEventListener("editorial-graph-changed", this.onChildChanged);
    this.load();
  }
  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("editorial-content-changed", this.onChildChanged);
    this.removeEventListener("editorial-graph-changed", this.onChildChanged);
  }

  hasOperation(code) { return (this.data?.availableOperations || []).some((entry) => entry.code === code); }

  async load() {
    if (!this.editorialContextId) { this.error = "Raccolta editoriale non specificata"; this.render(); return; }
    this.busy = true; this.error = null; this.render();
    try {
      this.data = await editorialRepository.studio(this.editorialContextId);
      if (this.section === "publication") {
        [this.revisions, this.releases] = await Promise.all([
          editorialRepository.revisions(this.editorialContextId),
          editorialRepository.releases(this.editorialContextId),
        ]);
      }
    } catch (error) { this.error = error instanceof Error ? error.message : "Non è possibile aprire lo Studio editoriale"; }
    finally { this.busy = false; this.render(); }
  }

  onChildChanged = () => { this.load(); };

  setSection(section) {
    this.section = section;
    const params = new URLSearchParams(window.location.search);
    params.set("editorialContextId", this.editorialContextId);
    params.set("section", section);
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
    if (section === "publication" && !this.revisions.length && !this.releases.length) { this.load(); return; }
    this.render();
  }

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const tab = target?.closest("button[data-studio-section]");
    if (tab) { this.setSection(tab.dataset.studioSection); return; }
    if (target?.closest("button[data-back-space]")) {
      navigate(`/workspace/editorial-space?contentSpaceId=${encodeURIComponent(this.data?.contentSpace?.id || "")}`);
      return;
    }
    if (target?.closest("button[data-request-changes-cancel]")) {
      this.requestingChanges = false;
      this.error = null;
      this.render();
      return;
    }
    const action = target?.closest("button[data-studio-action]");
    if (!action) return;
    const code = action.dataset.studioAction;
    if (code === "collection.review.request") await this.run(() => editorialRepository.requestReview(this.editorialContextId));
    else if (code === "collection.review.withdraw") {
      const confirmed = await openActionDialog({
        title: "Ritirare la raccolta dalla revisione?",
        message: "La snapshot in revisione verrà ritirata e il working state tornerà modificabile.",
        confirmLabel: "Ritira revisione",
      });
      if (confirmed) await this.run(() => editorialRepository.withdrawReview(this.editorialContextId));
    } else if (code === "collection.review.approve") {
      const confirmed = await openActionDialog({
        title: "Approvare questa snapshot?",
        message: "L'approvazione riguarda esattamente la snapshot attualmente in revisione.",
        confirmLabel: "Approva snapshot",
      });
      if (confirmed) await this.run(() => editorialRepository.approveReview(this.editorialContextId, this.data.review.id));
    } else if (code === "collection.review.request_changes") {
      this.requestingChanges = true;
      this.error = null;
      this.render();
      requestAnimationFrame(() => this.querySelector("[data-request-changes-message]")?.focus());
    } else if (code === "collection.publish") {
      const confirmed = await openActionDialog({
        title: "Pubblicare una nuova versione della raccolta?",
        message: "Verrà pubblicata la revisione approvata come nuova EditorialRelease immutabile.",
        confirmLabel: "Pubblica versione",
      });
      if (confirmed) await this.run(() => editorialRepository.publish(this.editorialContextId, this.data.review.id));
    } else if (code === "collection.check") await this.run(() => editorialRepository.check(this.editorialContextId));
    else if (code === "collection.remove") await this.removeCollection();
  };

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    if (form.matches("[data-request-changes-form]")) {
      event.preventDefault();
      const data = new FormData(form);
      const message = String(data.get("message") || "").trim();
      if (!message) { this.error = "Inserisci il motivo delle modifiche richieste."; this.render(); return; }
      this.requestingChanges = false;
      await this.run(() => editorialRepository.requestChanges(this.editorialContextId, this.data.review.id, message));
      return;
    }
    if (!form.matches("[data-collection-settings]")) return;
    event.preventDefault();
    const data = new FormData(form);
    await this.run(() => editorialRepository.updateCollection(this.editorialContextId, {
      displayName: String(data.get("displayName") || "").trim(),
      shortDescription: String(data.get("shortDescription") || "").trim() || null,
      description: String(data.get("description") || "").trim() || null,
    }));
  };

  async run(operation) {
    this.busy = true; this.error = null; this.render();
    try { await operation(); await this.load(); }
    catch (error) { this.error = error instanceof Error ? error.message : "Operazione non completata"; this.busy = false; this.render(); }
  }

  async removeCollection() {
    if (!this.data?.permissions?.canRemove) return;
    const confirmed = await openActionDialog({
      title: `Eliminare la raccolta “${this.data.context.name}”?`,
      message: "Le versioni già acquisite resteranno valide e gli Item non verranno eliminati.",
      confirmLabel: "Elimina raccolta",
      tone: "danger",
    });
    if (!confirmed) return;
    const principal = operatingPrincipal(this.context);
    if (!principal) return;
    try {
      this.busy = true; this.render();
      await marketplaceRepository.removeWorkspaceResource(principal, { resourceType: "editorial_context", resourceId: this.editorialContextId });
      navigate(`/workspace/editorial-space?contentSpaceId=${encodeURIComponent(this.data.contentSpace.id)}`);
    } catch (error) { this.error = error instanceof Error ? error.message : "Eliminazione non completata"; this.busy = false; this.render(); }
  }

  renderTabs() {
    const tabs = [
      ["overview", "Panoramica"], ["content", "Contenuti"], ["relations", "Relazioni"], ["publication", "Pubblicazione"], ["settings", "Impostazioni"],
    ];
    return `<nav class="studio-tabs" aria-label="Sezioni della raccolta">${tabs.map(([key, label]) => `<button type="button" data-studio-section="${key}" aria-current="${this.section === key ? "page" : "false"}">${escapeHtml(label)}</button>`).join("")}</nav>`;
  }

  renderOverview() {
    const stats = this.data.stats || {};
    const readiness = this.data.readiness || { ready: false, issues: [] };
    const review = this.data.review;
    const published = this.data.published;
    return `<section class="studio-section"><div class="metric-grid"><article class="panel metric"><strong>${stats.entryCount || 0}</strong><span>Contenuti</span></article><article class="panel metric"><strong>${stats.subjectCount || 0}</strong><span>Subject nel grafo</span></article><article class="panel metric"><strong>${stats.edgeCount || 0}</strong><span>Relazioni</span></article><article class="panel metric"><strong>${stats.changesSincePublished ?? "—"}</strong><span>Modifiche dopo l'ultima release</span></article></div><div class="overview-grid"><article class="panel"><span class="eyebrow">Stato editoriale</span><h2>${review ? statusLabel(review.status) : "In lavorazione"}</h2>${review ? `<p>Snapshot v${escapeHtml(review.version)} · richiesta ${escapeHtml(formatDate(review.requestedAt))}</p>${review.message ? `<p class="inline-notice">${escapeHtml(review.message)}</p>` : ""}` : `<p>La raccolta è modificabile. Quando controllo e composizione sono pronti puoi inviarla in revisione.</p>`}${published ? `<p class="note">Ultima versione pubblicata: v${escapeHtml(published.version)} · ${escapeHtml(formatDate(published.releasedAt))}</p>` : `<p class="note">Nessuna versione ancora pubblicata.</p>`}</article><article class="panel"><span class="eyebrow">Controllo</span><h2>${readiness.ready ? "Pronta per la revisione" : `${readiness.issues?.length || 0} problemi da risolvere`}</h2>${readiness.ready ? `<p>Tutti i riferimenti della composizione, del grafo e del Namespace sono coerenti.</p>` : `<ul class="issue-list">${(readiness.issues || []).slice(0, 6).map((issue) => `<li>${escapeHtml(issue.message || issue.code)}</li>`).join("")}</ul>`}<div class="button-row"><button type="button" class="button-secondary" data-studio-action="collection.check">${icon("check", { size: 16 })} Ricontrolla</button>${this.hasOperation("collection.review.request") ? `<button type="button" data-studio-action="collection.review.request">Invia in revisione</button>` : ""}</div></article></div></section>`;
  }

  renderContent() {
    return `<section class="studio-section"><artaround-editorial-collection-content-manager></artaround-editorial-collection-content-manager></section>`;
  }

  renderRelations() {
    return `<section class="studio-section"><header class="section-heading"><div><span class="eyebrow">Semantica della raccolta</span><h2>Relazioni fra Subject</h2><p>Il grafo appartiene a questa raccolta e usa esclusivamente relation type e classi definite dalle sue regole editoriali.</p></div></header><artaround-semantic-graph-editor></artaround-semantic-graph-editor></section>`;
  }

  renderPublicationActions() {
    const buttons = [];
    if (this.hasOperation("collection.review.request")) buttons.push(`<button type="button" data-studio-action="collection.review.request">Invia in revisione</button>`);
    if (this.hasOperation("collection.review.withdraw")) buttons.push(`<button type="button" class="button-secondary" data-studio-action="collection.review.withdraw">Ritira revisione</button>`);
    if (this.hasOperation("collection.review.approve")) buttons.push(`<button type="button" data-studio-action="collection.review.approve">Approva</button>`);
    if (this.hasOperation("collection.review.request_changes")) buttons.push(`<button type="button" class="button-secondary" data-studio-action="collection.review.request_changes">Richiedi modifiche</button>`);
    if (this.hasOperation("collection.publish")) buttons.push(`<button type="button" data-studio-action="collection.publish">Pubblica nuova versione</button>`);
    return buttons.join("");
  }

  renderRequestChangesForm() {
    if (!this.requestingChanges || !this.hasOperation("collection.review.request_changes")) return "";
    return `<form class="panel request-changes-form" data-request-changes-form><span class="eyebrow">Richiedi modifiche</span><h3>Che cosa deve essere rivisto?</h3><p>Il messaggio verrà associato alla revisione corrente e guiderà il curatore nelle correzioni.</p><label>Messaggio<textarea name="message" rows="4" required data-request-changes-message></textarea></label><div class="button-row"><button type="submit">Invia richiesta</button><button type="button" class="button-secondary" data-request-changes-cancel>Annulla</button></div></form>`;
  }

  renderPublication() {
    const review = this.data.review;
    const readiness = this.data.readiness || {};
    return `<section class="studio-section publication-flow"><article class="flow-step ${readiness.ready ? "complete" : "blocked"}"><span class="step-number">1</span><div><span class="eyebrow">Controllo</span><h2>${readiness.ready ? "Raccolta coerente" : "Controllo da completare"}</h2><p>${readiness.ready ? "Composizione, grafo e regole editoriali possono essere congelati in una snapshot." : "Risolvi i problemi mostrati in Panoramica prima di inviare la raccolta in revisione."}</p></div></article><article class="flow-step ${review ? "active" : ""}"><span class="step-number">2</span><div><span class="eyebrow">Revisione</span><h2>${review ? statusLabel(review.status) : "Non ancora richiesta"}</h2>${review ? `<p>Snapshot v${escapeHtml(review.version)}, ${escapeHtml(review.itemCount)} contenuti. Il working state è bloccato finché questa revisione resta attiva.</p>` : `<p>La revisione congela esattamente contenuti, grafo e Namespace che verranno pubblicati.</p>`}<div class="button-row">${this.renderPublicationActions()}</div>${this.renderRequestChangesForm()}</div></article><article class="flow-step ${this.data.published ? "complete" : ""}"><span class="step-number">3</span><div><span class="eyebrow">Versione</span><h2>${this.data.published ? `Release v${escapeHtml(this.data.published.version)}` : "Nessuna release"}</h2><p>${this.data.published ? `Pubblicata ${escapeHtml(formatDate(this.data.published.releasedAt))}.` : "Dopo l'approvazione, un publisher può creare l'EditorialRelease immutabile."}</p></div></article><article class="panel history-panel"><h2>Storico</h2><div class="history-grid"><div><h3>Revisioni</h3>${this.revisions.length ? `<ol>${this.revisions.slice(0, 8).map((revision) => `<li><strong>v${escapeHtml(revision.version)}</strong> · ${escapeHtml(statusLabel(revision.status))} <small>${escapeHtml(formatDate(revision.createdAt))}</small></li>`).join("")}</ol>` : `<p class="muted">Nessuna revisione.</p>`}</div><div><h3>Release</h3>${this.releases.length ? `<ol>${this.releases.slice(0, 8).map((release) => `<li><strong>v${escapeHtml(release.version)}</strong> · ${escapeHtml(formatDate(release.releasedAt))}</li>`).join("")}</ol>` : `<p class="muted">Nessuna release.</p>`}</div></div></article></section>`;
  }

  renderSettings() {
    const data = this.data;
    return `<section class="studio-section settings-grid"><form class="panel" data-collection-settings><span class="eyebrow">Identità della raccolta</span><h2>Dettagli</h2><label>Nome<input name="displayName" required value="${escapeHtml(data.context.name)}" ${data.context.locked || !data.permissions.canEdit ? "disabled" : ""}></label><label>Descrizione breve<input name="shortDescription" maxlength="240" value="${escapeHtml(data.context.shortDescription || "")}" ${data.context.locked || !data.permissions.canEdit ? "disabled" : ""}></label><label>Descrizione<textarea name="description" rows="6" ${data.context.locked || !data.permissions.canEdit ? "disabled" : ""}>${escapeHtml(data.context.description || "")}</textarea></label><label>Spazio editoriale<input value="${escapeHtml(data.contentSpace.name)}" disabled></label><label>Regole editoriali<input value="${escapeHtml(data.namespace.name)}" disabled></label>${data.permissions.canEdit && !data.context.locked ? `<button type="submit">Salva modifiche</button>` : `<p class="note">La raccolta non è modificabile nello stato corrente.</p>`}</form><article class="panel danger-zone"><span class="eyebrow">Zona pericolosa</span><h2>Elimina raccolta</h2><p>Gli Item e lo Spazio editoriale non verranno eliminati. Le offerte future saranno ritirate; le snapshot già acquisite restano valide secondo i relativi diritti.</p>${data.permissions.canRemove ? `<button type="button" class="button-secondary danger" data-studio-action="collection.remove">${icon("trash", { size: 16 })} Elimina raccolta</button>` : `<p class="note">Non disponi del permesso di lifecycle.</p>`}</article></section>`;
  }

  configureChildren() {
    const content = this.querySelector("artaround-editorial-collection-content-manager");
    if (content) content.configure({
      editorialContextId: this.editorialContextId,
      contentSpaceId: this.data.contentSpace.id,
      namespaceId: this.data.namespace.id,
      editable: this.data.permissions.canEdit,
      locked: this.data.context.locked,
    });
    const graph = this.querySelector("artaround-semantic-graph-editor");
    if (graph) graph.configure({
      editorialContextId: this.editorialContextId,
      relationTypes: this.data.namespace.revision?.relationTypes || [],
      subjectClasses: this.data.namespace.revision?.subjectClasses || [],
      editable: this.data.permissions.canEditGraph,
      locked: this.data.context.locked,
    });
  }

  render() {
    if (this.busy && !this.data) { this.innerHTML = `<main class="page"><div class="empty-state"><p>Apertura dello Studio editoriale…</p></div></main>`; return; }
    if (this.error && !this.data) { this.innerHTML = `<main class="page"><div class="empty-state"><h1>Studio editoriale</h1><p role="alert">${escapeHtml(this.error)}</p><a data-route href="/workspace">Torna alla Libreria</a></div></main>`; return; }
    if (!this.data) return;
    const section = ({ overview: () => this.renderOverview(), content: () => this.renderContent(), relations: () => this.renderRelations(), publication: () => this.renderPublication(), settings: () => this.renderSettings() })[this.section]();
    this.innerHTML = `<style>
      artaround-editorial-studio-view .studio-page{max-width:var(--content);margin:auto;padding:1.5rem 1rem 5rem;display:grid;gap:1rem}
      artaround-editorial-studio-view .studio-header{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start}artaround-editorial-studio-view .studio-header h1{margin:.2rem 0}artaround-editorial-studio-view .studio-header p{margin:.3rem 0;color:var(--muted)}
      artaround-editorial-studio-view .studio-tabs{display:flex;gap:.25rem;overflow:auto;border-bottom:1px solid var(--border)}artaround-editorial-studio-view .studio-tabs button{background:none;color:inherit;border:0;border-radius:0;padding:.8rem 1rem;border-bottom:2px solid transparent;white-space:nowrap}artaround-editorial-studio-view .studio-tabs button[aria-current="page"]{border-bottom-color:currentColor;font-weight:700}
      artaround-editorial-studio-view .studio-section{display:grid;gap:1rem}artaround-editorial-studio-view .metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem}artaround-editorial-studio-view .metric{display:grid;gap:.2rem}artaround-editorial-studio-view .metric strong{font-size:1.8rem}artaround-editorial-studio-view .metric span{color:var(--muted)}
      artaround-editorial-studio-view .overview-grid,artaround-editorial-studio-view .settings-grid,artaround-editorial-studio-view .history-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}artaround-editorial-studio-view .issue-list{padding-left:1.25rem}
      artaround-editorial-studio-view .publication-flow{max-width:60rem}artaround-editorial-studio-view .flow-step{display:grid;grid-template-columns:2.4rem minmax(0,1fr);gap:.9rem;padding:1rem;border-left:3px solid var(--border);background:var(--surface)}artaround-editorial-studio-view .flow-step.complete{border-left-color:#4c8a63}artaround-editorial-studio-view .flow-step.active{border-left-color:currentColor}artaround-editorial-studio-view .flow-step.blocked{opacity:.75}artaround-editorial-studio-view .step-number{width:2rem;height:2rem;border-radius:50%;display:grid;place-items:center;border:1px solid var(--border);font-weight:700}
      artaround-editorial-studio-view .request-changes-form{margin-top:1rem;display:grid;gap:.75rem}artaround-editorial-studio-view .request-changes-form h3,artaround-editorial-studio-view .request-changes-form p{margin:0}artaround-editorial-studio-view .request-changes-form textarea{width:100%;box-sizing:border-box}
      artaround-editorial-studio-view .history-panel ol{padding-left:1.25rem}artaround-editorial-studio-view .history-panel li{margin:.45rem 0}artaround-editorial-studio-view .danger-zone{align-self:start}
      @media(max-width:54rem){artaround-editorial-studio-view .metric-grid{grid-template-columns:1fr 1fr}artaround-editorial-studio-view .overview-grid,artaround-editorial-studio-view .settings-grid{grid-template-columns:1fr}}
    </style><main class="page studio-page" aria-busy="${this.busy}"><header class="studio-header"><div><button type="button" class="text-button" data-back-space>${icon("arrowLeft", { size: 15 })} ${escapeHtml(this.data.contentSpace.name)}</button><span class="eyebrow">Studio della raccolta</span><h1>${escapeHtml(this.data.context.name)}</h1><p>${escapeHtml(this.data.context.shortDescription || this.data.context.description || "Componi contenuti, relazioni e pubblicazioni in un unico contesto editoriale.")}</p><p class="note">Regole: ${escapeHtml(this.data.namespace.name)}${this.data.namespace.revision ? ` · v${escapeHtml(this.data.namespace.revision.version)}` : ""}</p></div>${this.data.context.locked ? `<span class="status-pill">${icon("lock", { size: 14 })} ${escapeHtml(statusLabel(this.data.review?.status))}</span>` : `<span class="status-pill success">Working</span>`}</header>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${this.renderTabs()}${section}</main>`;
    queueMicrotask(() => this.configureChildren());
  }
}

customElements.define("artaround-editorial-studio-view", ArtAroundEditorialStudioView);
