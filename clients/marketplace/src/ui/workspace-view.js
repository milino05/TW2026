import { navigate } from "../application/router.js";
import { operatingPrincipal, readOperatingContext } from "../application/operating-context.js";
import {
  resolveEditorialSpacePreference,
  setEditorialSpacePreference,
} from "../application/editorial-space-preference.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
import { openMessageActionDialog } from "./message-action-dialog.js";
import { renderOwnedResourceRemoval, requestOwnedResourceRemoval } from "./owned-resource-removal.js";
import { openSpaceSelectionDialog } from "./workspace-space-dialogs.js";
import { icon } from "./icons.js";
import { editorLabel, integrityLabel, resourceLabel, resourceStateLabel } from "./presentation.js";

const DIRECT_OPERATIONS = new Set(["content.fork", "namespace.fork", "physical_vocabulary.fork", "visit.copy_detached", "context.import_snapshot"]);
function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function refId(ref) { return String(ref?.resourceId || ""); }
function refType(ref) { return String(ref?.resourceType || ""); }
function id(value) { return String(value?._id || value?.id || value || ""); }
function isWorkflowOperation(code) { return String(code || "").startsWith("workflow."); }
function initialState() {
  const params = new URLSearchParams(window.location.search);
  return {
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
  if (resourceType === "semantic_graph") return `/workspace/semantic-graph?semanticGraphId=${encodeURIComponent(resourceId)}`;
  if (resourceType === "physical_vocabulary") return `/physical-vocabularies/editor?physicalVocabularyId=${encodeURIComponent(resourceId)}`;
  if (resourceType === "editorial_context") return `/workspace/editorial-studio?editorialContextId=${encodeURIComponent(resourceId)}`;
  return null;
}

export class ArtAroundWorkspaceView extends HTMLElement {
  context = readOperatingContext();
  detail = null;
  busy = false;
  error = null;
  message = null;
  state = initialState();
  taskDialog = null;

  connectedCallback() { this.addEventListener("click", this.onClick); void this.load(); }
  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.taskDialog?.close({ restoreFocus: false, notify: false });
    this.taskDialog = null;
  }
  principal() { return operatingPrincipal(this.context); }

  async fetchDetail() {
    if (!this.state.resourceType || !this.state.resourceId) throw new Error("Riferimento della risorsa mancante");
    const principal = this.principal();
    if (!principal) throw new Error("Area di lavoro non selezionata");
    this.detail = await marketplaceRepository.workspaceResourceDetail(principal, {
      ownership: this.state.ownership,
      resourceType: this.state.resourceType,
      resourceId: this.state.resourceId,
    });
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
    if (this.state.ownership === "licensed") { navigate("/acquisitions"); return; }
    const type = this.detail?.asset?.resourceType || this.state.resourceType;
    if (["visit", "namespace", "semantic_graph", "physical_vocabulary"].includes(type)) navigate("/workspace?section=resources");
    else navigate("/workspace");
  }

  async executeOperation({ operationCode, sourceRef, payload = {} }) {
    const principal = this.principal();
    if (!principal) throw new Error("Area di lavoro non selezionata");
    await this.execute(
      () => marketplaceRepository.executeWorkspaceOperation({
        operationCode,
        sourceRef,
        targetPrincipal: { type: principal.principalType, id: principal.principalId },
        payload,
      }),
      isWorkflowOperation(operationCode) ? "Operazione editoriale completata" : "Operazione completata",
    );
  }

  async openForkDialog(sourceRef) {
    const principal = this.principal();
    if (!principal || !this.context || this.taskDialog) return;
    this.busy = true;
    this.error = null;
    this.render();
    try {
      const spaces = await editorialRepository.spaceSummaries({ ownerType: this.context.type, ownerId: this.context.id }) || [];
      const preferred = resolveEditorialSpacePreference(principal, spaces);
      this.busy = false;
      this.render();
      if (!spaces.length) {
        this.error = "Prima di creare una copia serve uno spazio editoriale attivo nell'area di lavoro corrente.";
        this.render();
        return;
      }
      this.taskDialog = openSpaceSelectionDialog({
        spaces,
        currentSpace: preferred,
        eyebrow: "Copia del contenuto",
        title: "Dove vuoi creare la copia?",
        description: "Il fork crea un nuovo Item indipendente. Lo spazio scelto diventa la sua prima appartenenza editoriale; il contenuto sorgente non viene spostato.",
        onDismiss: () => { this.taskDialog = null; },
        onChoose: (space) => {
          this.taskDialog = null;
          void this.confirmFork(sourceRef, id(space));
        },
      });
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è possibile caricare gli spazi editoriali";
      this.busy = false;
      this.render();
    }
  }

  async confirmFork(sourceRef, contentSpaceId) {
    const principal = this.principal();
    if (!principal || !contentSpaceId || this.busy) return;
    this.busy = true;
    this.error = null;
    this.message = null;
    this.render();
    try {
      const result = await marketplaceRepository.executeWorkspaceOperation({
        operationCode: "content.fork",
        sourceRef,
        targetPrincipal: { type: principal.principalType, id: principal.principalId },
        payload: { contentSpaceId },
      });
      const itemId = refId(result?.resultRef);
      if (!itemId) throw new Error("La copia è stata creata ma non è stato restituito il nuovo Item");
      setEditorialSpacePreference(principal, contentSpaceId, { silent: true });
      navigate(`/workspace/item-authoring?itemId=${encodeURIComponent(itemId)}&contentSpaceId=${encodeURIComponent(contentSpaceId)}`);
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è stato possibile creare la copia";
      this.busy = false;
      this.render();
    }
  }

  async requestOperationMessage(operationCode, label, sourceRef) {
    const message = await openMessageActionDialog({
      title: label || "Motivazione richiesta",
      description: "Il messaggio verrà registrato nel workflow editoriale.",
      label: "Motivazione",
      placeholder: "Descrivi cosa deve essere corretto",
      confirmLabel: label || "Continua",
    });
    if (message === null) return;
    await this.executeOperation({ operationCode, sourceRef, payload: { message } });
  }

  async requestRemoval() {
    const principal = this.principal();
    const asset = this.detail?.asset;
    if (!principal || !asset) return;
    try {
      const removal = await requestOwnedResourceRemoval({
        principal,
        resourceType: asset.resourceType,
        resourceId: asset.resourceId,
        title: asset.title,
        removalImpact: asset.removalImpact,
        onConfirmed: () => {
          this.busy = true;
          this.error = null;
          this.message = null;
          this.render();
        },
      });
      if (removal) navigate(`/workspace?removed=${encodeURIComponent(removal.removedKey)}`);
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è stato possibile rimuovere la risorsa";
      this.busy = false;
      this.render();
    }
  }

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button[data-workspace-back]")) { this.backToWorkspace(); return; }
    const authoringButton = target?.closest("button[data-authoring-href]");
    if (authoringButton) { navigate(authoringButton.dataset.authoringHref); return; }
    if (target?.closest("button[data-owned-resource-removal]")) { await this.requestRemoval(); return; }
    const listingButton = target?.closest("button[data-create-listing]");
    if (listingButton) {
      const principal = this.principal();
      if (!principal) return;
      const listing = await this.execute(
        () => marketplaceRepository.createListing({
          resourceType: listingButton.dataset.resourceType,
          resourceId: listingButton.dataset.resourceId,
          sellerType: principal.principalType,
          sellerId: principal.principalId,
        }),
        "Preparazione creata. Formula l'offerta per pubblicare la risorsa.",
      );
      const listingId = String(listing?.id || listing?._id || "");
      if (listingId) navigate(`/workspace/commerce?listingId=${encodeURIComponent(listingId)}`);
      return;
    }
    const commerceButton = target?.closest("button[data-commerce-listing]");
    if (commerceButton) { navigate(`/workspace/commerce?listingId=${encodeURIComponent(commerceButton.dataset.commerceListing)}`); return; }
    const operationButton = target?.closest("button[data-operation]");
    if (!operationButton) return;
    const operationCode = operationButton.dataset.operation || "";
    const sourceRef = { resourceType: operationButton.dataset.sourceType, resourceId: operationButton.dataset.sourceId };
    if (operationCode === "content.fork") { await this.openForkDialog(sourceRef); return; }
    if (operationButton.dataset.requiresMessage === "true") {
      await this.requestOperationMessage(operationCode, operationButton.textContent?.trim() || "Continua", sourceRef);
      return;
    }
    await this.executeOperation({ operationCode, sourceRef });
  };

  async execute(callback, successMessage) {
    this.busy = true;
    this.error = null;
    this.message = null;
    this.render();
    let result = null;
    try { result = await callback(); await this.fetchDetail(); this.message = successMessage; }
    catch (error) { this.error = error instanceof Error ? error.message : "Operazione non riuscita"; }
    finally { this.busy = false; this.render(); }
    return result;
  }

  renderOperations(asset) {
    return (asset.availableOperations || []).map((operation) => {
      if (operation.code === "remove_resource") return "";
      if (operation.code === "create_listing") return `<button type="button" data-create-listing data-resource-type="${escapeHtml(asset.sourceRef?.resourceType || asset.resourceType)}" data-resource-id="${escapeHtml(refId(asset.sourceRef) || asset.resourceId)}">${icon("catalog", { size: 15 })}Configura offerta e pubblica</button>`;
      if (operation.code === "open_editor" && asset.ownership === "owned") {
        const href = authoringHref(asset.authoringRef);
        if (href) return `<button type="button" data-authoring-href="${escapeHtml(href)}">${icon("edit", { size: 15 })}${escapeHtml(editorLabel(asset.resourceType, operation.label))}</button>`;
      }
      if (operation.code === "manage_distribution") return `<button type="button" data-commerce-listing="${escapeHtml(asset.listing?.id || "")}">${icon("store", { size: 15 })}Gestisci vendita</button>`;
      if (DIRECT_OPERATIONS.has(operation.code) || isWorkflowOperation(operation.code)) {
        const source = operation.sourceRef || asset.sourceRef || { resourceType: asset.resourceType, resourceId: asset.resourceId };
        return `<button class="button-secondary" type="button" data-operation="${escapeHtml(operation.code)}" data-source-type="${escapeHtml(refType(source))}" data-source-id="${escapeHtml(refId(source))}" data-requires-message="${operation.requiresMessage ? "true" : "false"}">${escapeHtml(operation.label)}</button>`;
      }
      return `<button class="button-secondary" type="button" disabled title="Questa azione richiede un flusso dedicato">${escapeHtml(operation.label)}</button>`;
    }).join(" ");
  }

  renderRemoval(asset) {
    return renderOwnedResourceRemoval({
      resourceType: asset.resourceType,
      availableOperations: asset.availableOperations,
      ownership: asset.ownership,
    });
  }

  renderResourceFacts(asset) {
    if (asset.resourceType !== "semantic_graph" || !asset.semanticGraphStats) return "";
    const stats = asset.semanticGraphStats;
    return `<div class="stats"><span><strong>${Number(stats.subjectCount || 0)}</strong> soggetti</span><span><strong>${Number(stats.relationCount || 0)}</strong> relazioni</span><span><strong>${Number(stats.collectionUsageCount || 0)}</strong> raccolte</span><span><strong>${Number(stats.contentSpaceUsageCount || 0)}</strong> spazi</span></div>`;
  }

  render() {
    if (this.busy && !this.detail) { this.innerHTML = `<main class="page"><div class="empty-state"><div class="skeleton skeleton-line" style="width:14rem"></div><p>Caricamento della risorsa…</p></div></main>`; return; }
    if (this.error && !this.detail) { this.innerHTML = `<main class="page"><button class="back-button" data-workspace-back type="button">${icon("arrowLeft")} Libreria</button><div class="empty-state"><h1>Risorsa non disponibile</h1><p role="alert">${escapeHtml(this.error)}</p></div></main>`; return; }
    const asset = this.detail?.asset;
    if (!asset) return;
    const editorial = asset.editorialWorkflow ? `<p><strong>Stato editoriale:</strong> ${escapeHtml(resourceStateLabel(asset.editorialWorkflow.status))} · ${escapeHtml(integrityLabel(asset.editorialWorkflow.integrityStatus))}</p>` : "";
    const state = asset.state ? `<span class="status">${escapeHtml(resourceStateLabel(asset.state))}</span>` : "";
    const rights = asset.ownership === "licensed" && (asset.capabilities || []).length ? `<details class="technical-details"><summary>Dettagli dei diritti</summary><p>${asset.capabilities.map(escapeHtml).join(" · ")}</p></details>` : "";
    const listing = asset.listing ? `<p>${icon("store", { size: 15 })}<strong>${asset.listing.status === "published" && Number(asset.listing.activeOfferCount) > 0 ? "Nel catalogo" : "Pubblicazione da completare"}</strong> · ${Number(asset.listing.activeOfferCount) || 0} offerte attive</p>` : "";
    this.innerHTML = `<main class="page resource-page"><nav class="breadcrumb" aria-label="Percorso"><button data-workspace-back type="button">${icon("arrowLeft", { size: 15 })} ${this.state.ownership === "licensed" ? "Attività" : "Libreria"}</button><span>/</span><span>${escapeHtml(asset.title)}</span></nav>${this.message ? `<p class="status success" role="status">${escapeHtml(this.message)}</p>` : ""}${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}<section class="resource-hero"><div class="button-row"><span class="badge">${asset.ownership === "owned" ? "Di proprietà" : "Con licenza"}</span>${state}</div><h1>${escapeHtml(asset.title)}</h1><p>${escapeHtml(resourceLabel(asset.resourceType))}</p>${asset.summary ? `<p>${escapeHtml(asset.summary)}</p>` : ""}${this.renderResourceFacts(asset)}${editorial}${listing}${rights}</section><section class="panel resource-actions"><span class="eyebrow">Cosa puoi fare</span><h2>Azioni disponibili</h2><div class="operations">${this.renderOperations(asset) || "<p>Nessuna azione disponibile.</p>"}</div><p class="note">Le azioni mostrate dipendono dai tuoi permessi e dallo stato corrente della risorsa.</p></section>${this.renderRemoval(asset)}</main>`;
  }
}
customElements.define("artaround-workspace-view", ArtAroundWorkspaceView);
