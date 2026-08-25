import { navigate } from "../application/router.js";
import { operatingPrincipal, readOperatingContext } from "../application/operating-context.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { icon } from "./icons.js";
import { editorLabel, integrityLabel, resourceLabel, resourceStateLabel } from "./presentation.js";

const DIRECT_OPERATIONS = new Set(["content.fork", "namespace.fork", "visit.copy_detached", "context.import_snapshot"]);
function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function refId(ref) { return String(ref?.resourceId || ""); }
function refType(ref) { return String(ref?.resourceType || ""); }
function isWorkflowOperation(code) { return String(code || "").startsWith("workflow."); }
function initialState() { const params = new URLSearchParams(window.location.search); return { ownership: params.get("ownership") === "licensed" ? "licensed" : "owned", resourceType: params.get("resourceType") || "", resourceId: params.get("resourceId") || "" }; }
function authoringHref(ref) { const resourceType = refType(ref); const resourceId = refId(ref); if (!resourceType || !resourceId) return null; if (resourceType === "item") return `/workspace/item-authoring?itemId=${encodeURIComponent(resourceId)}`; if (resourceType === "visit") return `/workspace/visit-authoring?visitId=${encodeURIComponent(resourceId)}`; if (resourceType === "namespace") return `/namespaces/editor?namespaceId=${encodeURIComponent(resourceId)}`; if (resourceType === "editorial_context") return `/workspace/context-compose?editorialContextId=${encodeURIComponent(resourceId)}`; return null; }

export class ArtAroundWorkspaceView extends HTMLElement {
  context = readOperatingContext();
  detail = null; busy = false; error = null; message = null; pendingOperation = null; state = initialState();
  connectedCallback() { this.addEventListener("click", this.onClick); this.load(); }
  disconnectedCallback() { this.removeEventListener("click", this.onClick); }
  principal() { return operatingPrincipal(this.context); }

  async fetchDetail() {
    if (!this.state.resourceType || !this.state.resourceId) throw new Error("Riferimento della risorsa mancante");
    const principal = this.principal();
    if (!principal) throw new Error("Area di lavoro non selezionata");
    this.detail = await marketplaceRepository.workspaceResourceDetail(principal, { ownership: this.state.ownership, resourceType: this.state.resourceType, resourceId: this.state.resourceId });
  }
  async load() { this.busy = true; this.error = null; this.render(); try { await this.fetchDetail(); } catch (error) { this.error = error instanceof Error ? error.message : "Risorsa non disponibile"; } finally { this.busy = false; this.render(); } }
  backToWorkspace() { navigate(this.state.ownership === "licensed" ? "/workspace?ownership=licensed" : "/workspace"); }

  async executeOperation({ operationCode, sourceRef, payload = {} }) {
    const principal = this.principal();
    if (!principal) throw new Error("Area di lavoro non selezionata");
    this.pendingOperation = null;
    await this.execute(() => marketplaceRepository.executeWorkspaceOperation({ operationCode, sourceRef, targetPrincipal: { type: principal.principalType, id: principal.principalId }, payload }), isWorkflowOperation(operationCode) ? "Operazione editoriale completata" : "Operazione completata");
  }

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button[data-workspace-back]")) { this.backToWorkspace(); return; }
    if (target?.closest("button[data-cancel-operation-message]")) { this.pendingOperation = null; this.error = null; this.render(); return; }
    if (target?.closest("button[data-confirm-operation-message]") && this.pendingOperation) {
      const textarea = this.querySelector("textarea[data-operation-message]");
      const message = String(textarea?.value || "").trim();
      if (!message) { this.error = "Inserisci una motivazione prima di continuare."; this.render(); requestAnimationFrame(() => this.querySelector("textarea[data-operation-message]")?.focus()); return; }
      const operation = this.pendingOperation;
      await this.executeOperation({ operationCode: operation.code, sourceRef: operation.sourceRef, payload: { message } });
      return;
    }
    const authoringButton = target?.closest("button[data-authoring-href]");
    if (authoringButton) { navigate(authoringButton.dataset.authoringHref); return; }
    const listingButton = target?.closest("button[data-create-listing]");
    if (listingButton) {
      const principal = this.principal();
      if (!principal) return;
      await this.execute(() => marketplaceRepository.createListing({ resourceType: listingButton.dataset.resourceType, resourceId: listingButton.dataset.resourceId, sellerType: principal.principalType, sellerId: principal.principalId }), "La risorsa è ora disponibile nel catalogo");
      return;
    }
    const commerceButton = target?.closest("button[data-commerce-listing]");
    if (commerceButton) { navigate(`/workspace/commerce?listingId=${encodeURIComponent(commerceButton.dataset.commerceListing)}`); return; }
    const operationButton = target?.closest("button[data-operation]");
    if (!operationButton) return;
    const operationCode = operationButton.dataset.operation || "";
    const sourceRef = { resourceType: operationButton.dataset.sourceType, resourceId: operationButton.dataset.sourceId };
    if (operationButton.dataset.requiresMessage === "true") { this.pendingOperation = { code: operationCode, label: operationButton.textContent?.trim() || "Continua", sourceRef }; this.error = null; this.message = null; this.render(); requestAnimationFrame(() => this.querySelector("textarea[data-operation-message]")?.focus()); return; }
    await this.executeOperation({ operationCode, sourceRef });
  };

  async execute(callback, successMessage) { this.busy = true; this.error = null; this.message = null; this.render(); try { await callback(); await this.fetchDetail(); this.message = successMessage; } catch (error) { this.error = error instanceof Error ? error.message : "Operazione non riuscita"; } finally { this.busy = false; this.render(); } }

  renderOperations(asset) {
    return (asset.availableOperations || []).map((operation) => {
      if (operation.code === "create_listing") return `<button type="button" data-create-listing data-resource-type="${escapeHtml(asset.sourceRef?.resourceType || asset.resourceType)}" data-resource-id="${escapeHtml(refId(asset.sourceRef) || asset.resourceId)}">${icon("catalog", { size: 15 })}Pubblica nel catalogo</button>`;
      if (operation.code === "open_editor" && asset.ownership === "owned") { const href = authoringHref(asset.authoringRef); if (href) return `<button type="button" data-authoring-href="${escapeHtml(href)}">${icon("edit", { size: 15 })}${escapeHtml(editorLabel(asset.resourceType, operation.label))}</button>`; }
      if (operation.code === "manage_distribution") return `<button type="button" data-commerce-listing="${escapeHtml(asset.listing?.id || "")}">${icon("store", { size: 15 })}Gestisci vendita</button>`;
      if (DIRECT_OPERATIONS.has(operation.code) || isWorkflowOperation(operation.code)) { const source = operation.sourceRef || asset.sourceRef || { resourceType: asset.resourceType, resourceId: asset.resourceId }; return `<button class="button-secondary" type="button" data-operation="${escapeHtml(operation.code)}" data-source-type="${escapeHtml(refType(source))}" data-source-id="${escapeHtml(refId(source))}" data-requires-message="${operation.requiresMessage ? "true" : "false"}">${escapeHtml(operation.label)}</button>`; }
      return `<button class="button-secondary" type="button" disabled title="Questa azione richiede un flusso dedicato">${escapeHtml(operation.label)}</button>`;
    }).join(" ");
  }

  renderOperationConfirmation() { if (!this.pendingOperation) return ""; return `<section class="confirmation-panel resource-operation-confirmation" role="alert"><div><strong>Motivazione richiesta</strong><p>Spiega in modo sintetico quali modifiche sono necessarie. Il messaggio verrà registrato nel workflow editoriale.</p><label>Motivazione<textarea data-operation-message rows="3" placeholder="Descrivi cosa deve essere corretto"></textarea></label></div><div class="button-row"><button type="button" data-confirm-operation-message>${escapeHtml(this.pendingOperation.label)}</button><button class="button-secondary" type="button" data-cancel-operation-message>Annulla</button></div></section>`; }

  render() {
    if (this.busy && !this.detail) { this.innerHTML = `<main class="page"><div class="empty-state"><div class="skeleton skeleton-line" style="width:14rem"></div><p>Caricamento della risorsa…</p></div></main>`; return; }
    if (this.error && !this.detail) { this.innerHTML = `<main class="page"><button class="back-button" data-workspace-back type="button">${icon("arrowLeft")} Libreria</button><div class="empty-state"><h1>Risorsa non disponibile</h1><p role="alert">${escapeHtml(this.error)}</p></div></main>`; return; }
    const asset = this.detail?.asset; if (!asset) return;
    const editorial = asset.editorialWorkflow ? `<p><strong>Stato editoriale:</strong> ${escapeHtml(resourceStateLabel(asset.editorialWorkflow.status))} · ${escapeHtml(integrityLabel(asset.editorialWorkflow.integrityStatus))}</p>` : "";
    const state = asset.state ? `<span class="status">${escapeHtml(resourceStateLabel(asset.state))}</span>` : "";
    const rights = asset.ownership === "licensed" && (asset.capabilities || []).length ? `<details class="technical-details"><summary>Dettagli dei diritti</summary><p>${asset.capabilities.map(escapeHtml).join(" · ")}</p></details>` : "";
    const listing = asset.listing ? `<p>${icon("store", { size: 15 })}<strong>Nel catalogo</strong> · ${Number(asset.listing.activeOfferCount) || 0} offerte attive</p>` : "";
    this.innerHTML = `<main class="page resource-page"><nav class="breadcrumb" aria-label="Percorso"><button data-workspace-back type="button">${icon("arrowLeft", { size: 15 })} Libreria</button><span>/</span><span>${escapeHtml(asset.title)}</span></nav>${this.message ? `<p class="status success" role="status">${escapeHtml(this.message)}</p>` : ""}${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}<section class="resource-hero"><div class="button-row"><span class="badge">${asset.ownership === "owned" ? "Di proprietà" : "Con licenza"}</span>${state}</div><h1>${escapeHtml(asset.title)}</h1><p>${escapeHtml(resourceLabel(asset.resourceType))}</p>${asset.summary ? `<p>${escapeHtml(asset.summary)}</p>` : ""}${editorial}${listing}${rights}</section><section class="panel resource-actions"><span class="eyebrow">Cosa puoi fare</span><h2>Azioni disponibili</h2>${this.renderOperationConfirmation()}<div class="operations">${this.renderOperations(asset) || "<p>Nessuna azione disponibile.</p>"}</div><p class="note">Le azioni mostrate dipendono dai tuoi permessi e dallo stato corrente della risorsa.</p></section></main>`;
  }
}
customElements.define("artaround-workspace-view", ArtAroundWorkspaceView);
