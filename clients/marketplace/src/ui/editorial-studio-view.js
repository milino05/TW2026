import { navigate } from "../application/router.js";
import { operatingPrincipal, readOperatingContext } from "../application/operating-context.js";
import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { openActionDialog } from "./feedback-primitives.js";
import { icon } from "./icons.js";
import "./revision-workflow-controls.js";
import "./editorial-collection-content-manager.js";
import "./semantic-graph-editor.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function formatDate(value) { if (!value) return "—"; try { return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); } catch { return String(value); } }
function statusLabel(value) { return ({ in_review: "In revisione", approved: "Approvata", changes_requested: "Modifiche richieste", published: "Pubblicata", withdrawn: "Ritirata" })[value] || value || "Bozza di lavoro"; }
function statusTone(value) { return ({ in_review: "info", approved: "success", changes_requested: "warning", published: "success", withdrawn: "neutral" })[value] || "neutral"; }

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
    this.addEventListener("artaround:revision-workflow-operation", this.onWorkflowOperation);
    this.addEventListener("editorial-content-changed", this.onChildChanged);
    this.addEventListener("editorial-graph-changed", this.onChildChanged);
    this.load();
  }
  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("artaround:revision-workflow-operation", this.onWorkflowOperation);
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

  onWorkflowOperation = (event) => {
    const code = event.detail?.operation?.code;
    if (!code) return;
    event.stopPropagation();
    void this.executeStudioAction(code);
  };

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
    if (action) await this.executeStudioAction(action.dataset.studioAction);
  };

  async executeStudioAction(code) {
    if (code === "collection.review.request") await this.run(() => editorialRepository.requestReview(this.editorialContextId));
    else if (code === "collection.review.withdraw") {
      const confirmed = await openActionDialog({
        title: "Ritirare la raccolta dalla revisione?",
        message: "La versione in revisione verrà ritirata e la bozza della raccolta tornerà modificabile.",
        confirmLabel: "Ritira revisione",
      });
      if (confirmed) await this.run(() => editorialRepository.withdrawReview(this.editorialContextId));
    } else if (code === "collection.review.approve") {
      const confirmed = await openActionDialog({
        title: "Approvare questa versione in revisione?",
        message: "L'approvazione riguarda esattamente contenuti, regole e revisione del grafo congelati per questa revisione.",
        confirmLabel: "Approva versione",
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
        message: "Verrà pubblicata la versione approvata come nuova versione immutabile della raccolta.",
        confirmLabel: "Pubblica versione",
      });
      if (confirmed) await this.run(() => editorialRepository.publish(this.editorialContextId, this.data.review.id));
    } else if (code === "collection.check") await this.run(() => editorialRepository.check(this.editorialContextId));
    else if (code === "collection.remove") await this.removeCollection();
  }

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
    return `<nav class="context-workspace-tabs" aria-label="Sezioni della raccolta">${tabs.map(([key, label]) => `<button type="button" data-studio-section="${key}" aria-current="${this.section === key ? "page" : "false"}">${escapeHtml(label)}</button>`).join("")}</nav>`;
  }

  renderOverview() {
    const stats = this.data.stats || {};
    const readiness = this.data.readiness || { ready: false, issues: [] };
    const review = this.data.review;
    const published = this.data.published;
    return `<section class="studio-section"><dl class="stats studio-overview-stats"><div><dt>Contenuti</dt><dd>${stats.entryCount || 0}</dd></div><div><dt>Soggetti nel grafo</dt><dd>${stats.subjectCount || 0}</dd></div><div><dt>Relazioni</dt><dd>${stats.edgeCount || 0}</dd></div><div><dt>Modifiche dopo l'ultima pubblicazione</dt><dd>${stats.changesSincePublished ?? "—"}</dd></div></dl><div class="studio-overview-grid"><article class="panel"><span class="eyebrow">Stato editoriale</span><h2>${review ? statusLabel(review.status) : "Bozza di lavoro"}</h2>${review ? `<p>Versione in revisione v${escapeHtml(review.version)} · richiesta ${escapeHtml(formatDate(review.requestedAt))}</p>${review.message ? `<artaround-callout tone="warning">${escapeHtml(review.message)}</artaround-callout>` : ""}` : `<p>La raccolta è modificabile. Quando contenuti e configurazione sono pronti puoi inviarne una versione in revisione.</p>`}${published ? `<p class="note">Ultima versione pubblicata: v${escapeHtml(published.version)} · ${escapeHtml(formatDate(published.releasedAt))}</p>` : `<p class="note">Nessuna versione ancora pubblicata.</p>`}</article><article class="panel"><span class="eyebrow">Controllo</span><h2>${readiness.ready ? "Pronta per la revisione" : `${readiness.issues?.length || 0} problemi da risolvere`}</h2>${readiness.ready ? `<artaround-callout tone="success">Contenuti, revisione del grafo e regole editoriali sono coerenti per creare una versione in revisione.</artaround-callout>` : `<artaround-issue-panel tone="warning"><ul class="studio-issue-list">${(readiness.issues || []).slice(0, 6).map((issue) => `<li>${escapeHtml(issue.message || issue.code)}</li>`).join("")}</ul></artaround-issue-panel>`}<div class="button-row"><button type="button" class="button-secondary" data-studio-action="collection.check">${icon("check", { size: 16 })} Ricontrolla</button>${this.hasOperation("collection.review.request") ? `<button type="button" data-studio-action="collection.review.request">Invia in revisione</button>` : ""}</div></article></div></section>`;
  }

  renderContent() {
    return `<section class="studio-section"><artaround-editorial-collection-content-manager></artaround-editorial-collection-content-manager></section>`;
  }

  renderRelations() {
    const graph = this.data.semanticGraph || {};
    const sharedCount = Number(graph.sharedByCollections || 1);
    return `<section class="studio-section"><header class="section-heading"><div><span class="eyebrow">Semantica</span><h2>Relazioni fra soggetti</h2><p>Lavora sul grafo semantico collegato alla raccolta. I nodi e le relazioni sono indipendenti dall'esistenza di contenuti di presentazione.</p></div></header><div class="studio-graph-context"><div><strong>${escapeHtml(graph.name || "Grafo semantico")}</strong><p>${sharedCount > 1 ? `Questo grafo è condiviso da ${sharedCount} raccolte. Le modifiche aggiornano la sua bozza comune; le versioni delle raccolte già in revisione o pubblicate restano pinzate alla revisione precedente.` : "Questo grafo può essere riusato da altre raccolte. Le versioni in revisione e pubblicate congelano sempre una revisione precisa."}</p></div><span class="status">${sharedCount} ${sharedCount === 1 ? "raccolta" : "raccolte"}</span></div><artaround-semantic-graph-editor></artaround-semantic-graph-editor></section>`;
  }

  renderRequestChangesForm() {
    if (!this.requestingChanges || !this.hasOperation("collection.review.request_changes")) return "";
    return `<form class="panel studio-request-changes-form" data-request-changes-form><span class="eyebrow">Richiedi modifiche</span><h3>Che cosa deve essere rivisto?</h3><p>Il messaggio verrà associato alla versione in revisione e guiderà il curatore nelle correzioni.</p><label>Messaggio<textarea name="message" rows="4" required data-request-changes-message></textarea></label><div class="button-row"><button type="submit">Invia richiesta</button><button type="button" class="button-secondary" data-request-changes-cancel>Annulla</button></div></form>`;
  }

  renderPublication() {
    const review = this.data.review;
    const readiness = this.data.readiness || { ready: false, issues: [] };
    const published = this.data.published;
    const reviewState = review?.status || "draft";
    return `<section class="studio-section studio-publication-flow"><header class="section-heading"><div><span class="eyebrow">Versioni</span><h2>Revisione e pubblicazione</h2><p>La Raccolta congela insieme composizione, Regole editoriali e una revisione precisa del grafo. Il grafo condiviso può continuare a evolvere senza modificare le versioni già congelate.</p></div></header><div class="studio-publication-grid"><article class="panel"><div class="section-heading"><div><span class="eyebrow">Stato corrente</span><h3>${review ? statusLabel(review.status) : "Bozza di lavoro"}</h3></div><artaround-status-indicator tone="${statusTone(reviewState)}">${escapeHtml(review ? statusLabel(review.status) : "Bozza di lavoro")}</artaround-status-indicator></div>${review ? `<p>Versione in revisione <strong>v${escapeHtml(review.version)}</strong> · ${escapeHtml(review.itemCount)} contenuti.</p><p class="note">La revisione usa il grafo congelato ${escapeHtml(review.graphRevisionId || "")}. Le modifiche successive al grafo condiviso non cambiano questa versione.</p>` : `<p>Nessuna versione è attualmente in revisione. ${readiness.ready ? "La bozza è pronta per essere congelata." : "Completa il controllo di consistenza prima della revisione."}</p>`}<artaround-revision-workflow-controls actions-only></artaround-revision-workflow-controls>${this.renderRequestChangesForm()}</article><article class="panel"><span class="eyebrow">Ultima pubblicazione</span><h3>${published ? `Versione v${escapeHtml(published.version)}` : "Nessuna versione pubblicata"}</h3>${published ? `<p>Pubblicata ${escapeHtml(formatDate(published.releasedAt))}.</p><p class="note">Grafo congelato: ${escapeHtml(published.graphRevisionId || "—")}</p>` : `<p>Quando una versione approvata viene pubblicata, resta immutabile e riproducibile anche se contenuti e grafo continuano a evolvere.</p>`}<button type="button" class="button-secondary" data-studio-action="collection.check">${icon("check", { size: 15 })} Ricontrolla consistenza</button></article></div><article class="panel studio-history-panel"><h2>Storico</h2><div class="studio-history-grid"><div><h3>Versioni in revisione</h3>${this.revisions.length ? `<ol>${this.revisions.slice(0, 8).map((revision) => `<li><strong>v${escapeHtml(revision.version)}</strong> · ${escapeHtml(statusLabel(revision.status))} <small>${escapeHtml(formatDate(revision.createdAt))}</small></li>`).join("")}</ol>` : `<p class="muted">Nessuna versione.</p>`}</div><div><h3>Versioni pubblicate</h3>${this.releases.length ? `<ol>${this.releases.slice(0, 8).map((release) => `<li><strong>v${escapeHtml(release.version)}</strong> · ${escapeHtml(formatDate(release.releasedAt))}</li>`).join("")}</ol>` : `<p class="muted">Nessuna versione.</p>`}</div></div></article></section>`;
  }

  renderSettings() {
    const data = this.data;
    return `<section class="studio-section studio-settings-grid"><form class="panel" data-collection-settings><span class="eyebrow">Identità della raccolta</span><h2>Dettagli</h2><label>Nome<input name="displayName" required value="${escapeHtml(data.context.name)}" ${data.context.locked || !data.permissions.canEdit ? "disabled" : ""}></label><label>Descrizione breve<input name="shortDescription" maxlength="240" value="${escapeHtml(data.context.shortDescription || "")}" ${data.context.locked || !data.permissions.canEdit ? "disabled" : ""}></label><label>Descrizione<textarea name="description" rows="6" ${data.context.locked || !data.permissions.canEdit ? "disabled" : ""}>${escapeHtml(data.context.description || "")}</textarea></label><label>Spazio editoriale<input value="${escapeHtml(data.contentSpace.name)}" disabled></label><label>Regole editoriali<input value="${escapeHtml(data.namespace.name)}" disabled></label>${data.permissions.canEdit && !data.context.locked ? `<button type="submit">Salva modifiche</button>` : `<p class="note">La raccolta non è modificabile nello stato corrente.</p>`}</form><article class="panel studio-danger-zone"><span class="eyebrow">Zona pericolosa</span><h2>Elimina raccolta</h2><p>Gli Item e lo Spazio editoriale non verranno eliminati. Le offerte future saranno ritirate; le versioni già acquisite restano valide secondo i relativi diritti.</p>${data.permissions.canRemove ? `<button type="button" class="button-secondary danger" data-studio-action="collection.remove">${icon("trash", { size: 16 })} Elimina raccolta</button>` : `<p class="note">Non disponi del permesso di gestione del ciclo di vita.</p>`}</article></section>`;
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
      locked: false,
    });
    const workflow = this.querySelector("artaround-revision-workflow-controls");
    if (workflow) {
      workflow.availableOperations = this.data.availableOperations || [];
      if (this.busy) workflow.setAttribute("busy", "");
      else workflow.removeAttribute("busy");
    }
  }

  render() {
    if (this.busy && !this.data) { this.innerHTML = `<main class="page"><div class="empty-state"><p>Apertura dello Studio editoriale…</p></div></main>`; return; }
    if (this.error && !this.data) { this.innerHTML = `<main class="page"><div class="empty-state"><h1>Studio editoriale</h1><p role="alert">${escapeHtml(this.error)}</p><a data-route href="/workspace">Torna alla Libreria</a></div></main>`; return; }
    if (!this.data) return;
    const section = ({ overview: () => this.renderOverview(), content: () => this.renderContent(), relations: () => this.renderRelations(), publication: () => this.renderPublication(), settings: () => this.renderSettings() })[this.section]();
    const graphSharedCount = Number(this.data.semanticGraph?.sharedByCollections || 1);
    this.innerHTML = `<main class="page context-workspace-page" aria-busy="${this.busy}"><nav class="breadcrumb" aria-label="Percorso"><a data-route href="/workspace">Libreria</a><span aria-hidden="true">/</span><a data-route href="/workspace/editorial-spaces">Spazi editoriali</a><span aria-hidden="true">/</span><a data-route href="/workspace/editorial-space?contentSpaceId=${encodeURIComponent(this.data.contentSpace.id)}">${escapeHtml(this.data.contentSpace.name)}</a><span aria-hidden="true">/</span><span>${escapeHtml(this.data.context.name)}</span></nav><header class="context-workspace-bar"><div><span class="eyebrow">Raccolta editoriale</span><h1>${escapeHtml(this.data.context.name)}</h1><p>${escapeHtml(this.data.context.shortDescription || this.data.context.description || "Componi contenuti, relazioni e pubblicazioni in un unico contesto editoriale.")}</p><p class="note">Regole editoriali: <strong>${escapeHtml(this.data.namespace.name)}</strong>${this.data.namespace.revision ? ` · v${escapeHtml(this.data.namespace.revision.version)}` : ""}</p></div><div class="context-workspace-status">${this.data.context.locked ? `<span class="status">${icon("lock", { size: 14 })} ${escapeHtml(statusLabel(this.data.review?.status))}</span>` : `<span class="status success">Bozza di lavoro</span>`}${graphSharedCount > 1 ? `<span class="status">Grafo condiviso · ${graphSharedCount} raccolte</span>` : ""}</div></header>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${this.renderTabs()}<div class="context-workspace-content">${section}</div></main>`;
    queueMicrotask(() => this.configureChildren());
  }
}

customElements.define("artaround-editorial-studio-view", ArtAroundEditorialStudioView);
