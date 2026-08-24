import { navigate } from "../application/router.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { icon } from "./icons.js";
import { editorLabel, integrityLabel, resourceLabel, resourceStateLabel } from "./presentation.js";

const DIRECT_OPERATIONS = new Set([
  "content.fork",
  "namespace.fork",
  "visit.copy_detached",
  "context.import_snapshot",
]);

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function refId(ref) { return String(ref?.resourceId || ""); }
function refType(ref) { return String(ref?.resourceType || ""); }
function isWorkflowOperation(code) { return String(code || "").startsWith("workflow."); }
function initialState() {
  const params = new URLSearchParams(window.location.search);
  return {
    principalType: params.get("principalType") || "user",
    principalId: params.get("principalId") || null,
    ownership: params.get("ownership") === "licensed" ? "licensed" : "owned",
    resourceType: params.get("resourceType") || "",
    resourceId: params.get("resourceId") || "",
  };
}
function authoringHref(ref) {
  const resourceType = refType(ref);
  const resourceId = refId(ref);
  if (!resourceType || !resourceId) return null;
  if (resourceType === "item") return `/workspace/item-authoring?itemId=${encodeURIComponent(resourceId)}`;
  if (resourceType === "visit") return `/workspace/visit-authoring?visitId=${encodeURIComponent(resourceId)}`;
  if (resourceType === "namespace") return `/namespaces/editor?namespaceId=${encodeURIComponent(resourceId)}`;
  if (resourceType === "editorial_context") return `/workspace/context-compose?editorialContextId=${encodeURIComponent(resourceId)}`;
  return null;
}

export class ArtAroundWorkspaceView extends HTMLElement {
  detail = null;
  busy = false;
  error = null;
  message = null;
  state = initialState();

  connectedCallback() {
    this.addEventListener("click", this.onClick);
    this.load();
  }

  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
  }

  principal() {
    return { principalType: this.state.principalType, principalId: this.state.principalId };
  }

  async fetchDetail() {
    if (!this.state.resourceType || !this.state.resourceId) throw new Error("Riferimento della risorsa mancante");
    const detail = await marketplaceRepository.workspaceResourceDetail(this.principal(), {
      ownership: this.state.ownership,
      resourceType: this.state.resourceType,
      resourceId: this.state.resourceId,
    });
    this.detail = detail;
    this.state.principalType = detail.principal.type;
    this.state.principalId = String(detail.principal.id);
  }

  async load() {
    this.busy = true;
    this.error = null;
    this.render();
    try { await this.fetchDetail(); }
    catch (error) { this.error = error instanceof Error ? error.message : "Risorsa non disponibile"; }
    finally { this.busy = false; this.render(); }
  }

  backToWorkspace() {
    const params = new URLSearchParams({ principalType: this.state.principalType });
    if (this.state.principalId) params.set("principalId", this.state.principalId);
    if (this.state.ownership === "licensed") params.set("ownership", "licensed");
    navigate(`/workspace?${params.toString()}`);
  }

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button[data-workspace-back]")) { this.backToWorkspace(); return; }

    const authoringButton = target?.closest("button[data-authoring-href]");
    if (authoringButton) { navigate(authoringButton.dataset.authoringHref); return; }

    const listingButton = target?.closest("button[data-create-listing]");
    if (listingButton) {
      await this.execute(
        () => marketplaceRepository.createListing({
          resourceType: listingButton.dataset.resourceType,
          resourceId: listingButton.dataset.resourceId,
          sellerType: this.state.principalType,
          sellerId: this.state.principalId,
        }),
        "La risorsa è ora disponibile nel catalogo",
      );
      return;
    }

    const commerceButton = target?.closest("button[data-commerce-listing]");
    if (commerceButton) {
      const params = new URLSearchParams({
        principalType: this.state.principalType,
        principalId: this.state.principalId,
        listingId: commerceButton.dataset.commerceListing,
      });
      navigate(`/workspace/commerce?${params.toString()}`);
      return;
    }

    const operationButton = target?.closest("button[data-operation]");
    if (operationButton) {
      const operationCode = operationButton.dataset.operation || "";
      const payload = {};
      if (operationButton.dataset.requiresMessage === "true") {
        const message = window.prompt("Motivazione delle modifiche richieste:");
        if (message === null) return;
        if (!message.trim()) { this.error = "La motivazione è obbligatoria."; this.render(); return; }
        payload.message = message.trim();
      }
      const sourceRef = { resourceType: operationButton.dataset.sourceType, resourceId: operationButton.dataset.sourceId };
      await this.execute(
        () => marketplaceRepository.executeWorkspaceOperation({
          operationCode,
          sourceRef,
          targetPrincipal: { type: this.state.principalType, id: this.state.principalId },
          payload,
        }),
        isWorkflowOperation(operationCode) ? "Operazione editoriale completata" : "Operazione completata",
      );
    }
  };

  async execute(callback, successMessage) {
    this.busy = true;
    this.error = null;
    this.message = null;
    this.render();
    try {
      await callback();
      await this.fetchDetail();
      this.message = successMessage;
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Operazione non riuscita";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  renderOperations(asset) {
    return (asset.availableOperations || []).map((operation) => {
      if (operation.code === "create_listing") {
        return `<button type="button" data-create-listing data-resource-type="${escapeHtml(asset.sourceRef?.resourceType || asset.resourceType)}" data-resource-id="${escapeHtml(refId(asset.sourceRef) || asset.resourceId)}">${icon("catalog", { size: 15 })}Pubblica nel catalogo</button>`;
      }
      if (operation.code === "open_editor" && asset.ownership === "owned") {
        const href = authoringHref(asset.authoringRef);
        if (href) return `<button type="button" data-authoring-href="${escapeHtml(href)}">${icon("edit", { size: 15 })}${escapeHtml(editorLabel(asset.resourceType, operation.label))}</button>`;
      }
      if (operation.code === "manage_distribution") {
        return `<button type="button" data-commerce-listing="${escapeHtml(asset.listing?.id || "")}">${icon("store", { size: 15 })}Gestisci vendita</button>`;
      }
      if (DIRECT_OPERATIONS.has(operation.code) || isWorkflowOperation(operation.code)) {
        const source = operation.sourceRef || asset.sourceRef || { resourceType: asset.resourceType, resourceId: asset.resourceId };
        return `<button class="button-secondary" type="button" data-operation="${escapeHtml(operation.code)}" data-source-type="${escapeHtml(refType(source))}" data-source-id="${escapeHtml(refId(source))}" data-requires-message="${operation.requiresMessage ? "true" : "false"}">${escapeHtml(operation.label)}</button>`;
      }
      return `<button class="button-secondary" type="button" disabled title="Questa azione richiede un flusso dedicato">${escapeHtml(operation.label)}</button>`;
    }).join(" ");
  }

  render() {
    if (this.busy && !this.detail) {
      this.innerHTML = `<main class="page"><div class="empty-state"><div class="skeleton skeleton-line" style="width:14rem"></div><p>Caricamento della risorsa…</p></div></main>`;
      return;
    }
    if (this.error && !this.detail) {
      this.innerHTML = `<main class="page"><button class="back-button" data-workspace-back type="button">${icon("arrowLeft")} Le mie risorse</button><div class="empty-state"><h1>Risorsa non disponibile</h1><p role="alert">${escapeHtml(this.error)}</p></div></main>`;
      return;
    }
    const asset = this.detail?.asset;
    if (!asset) return;
    const editorial = asset.editorialWorkflow
      ? `<p><strong>Stato editoriale:</strong> ${escapeHtml(resourceStateLabel(asset.editorialWorkflow.status))} · ${escapeHtml(integrityLabel(asset.editorialWorkflow.integrityStatus))}</p>`
      : "";
    const state = asset.state ? `<span class="status">${escapeHtml(resourceStateLabel(asset.state))}</span>` : "";
    const rights = asset.ownership === "licensed" && (asset.capabilities || []).length
      ? `<details class="technical-details"><summary>Dettagli dei diritti</summary><p>${asset.capabilities.map(escapeHtml).join(" · ")}</p></details>`
      : "";
    const listing = asset.listing
      ? `<p>${icon("store", { size: 15 })}<strong>Nel catalogo</strong> · ${Number(asset.listing.activeOfferCount) || 0} offerte attive</p>`
      : "";
    const principalName = this.detail?.principal?.name || "contesto selezionato";
    this.innerHTML = `<main class="page resource-page"><nav class="breadcrumb"><button data-workspace-back type="button">${icon("arrowLeft", { size: 15 })} Le mie risorse</button><span>/</span><span>${escapeHtml(asset.title)}</span></nav><div class="working-context surface"><span>Stai lavorando per</span><strong>${escapeHtml(principalName)}</strong></div>${this.message ? `<p class="status success" role="status">${escapeHtml(this.message)}</p>` : ""}${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}<section class="resource-hero"><div class="button-row"><span class="badge">${asset.ownership === "owned" ? "Di proprietà" : "Con licenza"}</span>${state}</div><h1>${escapeHtml(asset.title)}</h1><p>${escapeHtml(resourceLabel(asset.resourceType))}</p>${asset.summary ? `<p>${escapeHtml(asset.summary)}</p>` : ""}${editorial}${listing}${rights}</section><section class="panel resource-actions"><span class="eyebrow">Cosa puoi fare</span><h2>Azioni disponibili</h2><div class="operations">${this.renderOperations(asset) || "<p>Nessuna azione disponibile.</p>"}</div><p class="note">Le azioni mostrate dipendono dai tuoi permessi e dallo stato corrente della risorsa.</p></section></main>`;
  }
}

customElements.define("artaround-workspace-view", ArtAroundWorkspaceView);