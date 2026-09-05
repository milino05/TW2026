import { navigate } from "../application/router.js";
import { operatingPrincipal, readOperatingContext } from "../application/operating-context.js";
import {
  resolveEditorialSpacePreference,
  setEditorialSpacePreference,
} from "../application/editorial-space-preference.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
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
  pendingOperation = null;
  pendingRemoval = false;
  removalAcknowledged = false;
  state = initialState();
  pendingFork = null;
  forkSpaces = [];
  forkSpaceId = "";
  forkLoading = false;

  connectedCallback() { this.addEventListener("click", this.onClick); void this.load(); }
  disconnectedCallback() { this.removeEventListener("click", this.onClick); }
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
    this.pendingOperation = null;
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

  async openForkPanel(sourceRef) {
    const principal = this.principal();
    if (!principal || !this.context) return;
    this.pendingFork = { sourceRef };
    this.forkLoading = true;
    this.error = null;
    this.render();
    try {
      this.forkSpaces = await editorialRepository.spaceSummaries({ ownerType: this.context.type, ownerId: this.context.id }) || [];
      const preferred = resolveEditorialSpacePreference(principal, this.forkSpaces);
      this.forkSpaceId = id(preferred);
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è possibile caricare gli spazi editoriali";
      this.forkSpaces = [];
      this.forkSpaceId = "";
    } finally {
      this.forkLoading = false;
      this.render();
    }
  }

  closeForkPanel() {
    this.pendingFork = null;
    this.forkSpaces = [];
    this.forkSpaceId = "";
    this.forkLoading = false;
    this.error = null;
    this.render();
  }

  async confirmFork() {
    if (!this.pendingFork || !this.forkSpaceId || this.busy) return;
    const principal = this.principal();
    if (!principal) return;
    this.busy = true;
    this.error = null;
    this.message = null;
    this.render();
    try {
      const result = await marketplaceRepository.executeWorkspaceOperation({
        operationCode: "content.fork",
        sourceRef: this.pendingFork.sourceRef,
        targetPrincipal: { type: principal.principalType, id: principal.principalId },
        payload: { contentSpaceId: this.forkSpaceId },
      });
      const itemId = refId(result?.resultRef);
      if (!itemId) throw new Error("La copia è stata creata ma non è stato restituito il nuovo Item");
      setEditorialSpacePreference(principal, this.forkSpaceId, { silent: true });
      const contentSpaceId = this.forkSpaceId;
      this.pendingFork = null;
      navigate(`/workspace/item-authoring?itemId=${encodeURIComponent(itemId)}&contentSpaceId=${encodeURIComponent(contentSpaceId)}`);
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è stato possibile creare la copia";
      this.busy = false;
      this.render();
    }
  }

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button[data-workspace-back]")) { this.backToWorkspace(); return; }
    if (target?.closest("button[data-close-fork-panel]")) { this.closeForkPanel(); return; }
    const forkSpace = target?.closest("button[data-fork-space-id]");
    if (forkSpace) { this.forkSpaceId = String(forkSpace.dataset.forkSpaceId || ""); this.render(); return; }
    if (target?.closest("button[data-confirm-fork]")) { await this.confirmFork(); return; }
    if (target?.closest("button[data-open-editorial-library]")) { navigate("/workspace"); return; }
    if (target?.closest("button[data-cancel-removal]")) { this.pendingRemoval = false; this.removalAcknowledged = false; this.error = null; this.render(); return; }
    if (target?.matches("input[data-removal-ack]")) { this.removalAcknowledged = target.checked; this.render(); requestAnimationFrame(() => this.querySelector("input[data-removal-ack]")?.focus()); return; }
    if (target?.closest("button[data-request-removal]")) { this.pendingRemoval = true; this.removalAcknowledged = false; this.pendingOperation = null; this.error = null; this.render(); requestAnimationFrame(() => this.querySelector("button[data-confirm-removal]")?.focus()); return; }
    if (target?.closest("button[data-confirm-removal]")) {
      const principal = this.principal();
      const asset = this.detail?.asset;
      if (!principal || !asset) return;
      this.busy = true; this.error = null; this.message = null; this.render();
      try {
        await marketplaceRepository.removeWorkspaceResource(principal, { resourceType: asset.resourceType, resourceId: asset.resourceId });
        const removed = {
          item_edition: "content",
          editorial_context: "collection",
          namespace: "namespace",
          physical_vocabulary: "physical_vocabulary",
          visit: "visit",
        }[asset.resourceType] || "resource";
        navigate(`/workspace?removed=${removed}`);
      } catch (error) {
        this.error = error instanceof Error ? error.message : "Non è stato possibile rimuovere la risorsa";
        this.busy = false;
        this.render();
      }
      return;
    }
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
    if (operationCode === "content.fork") { await this.openForkPanel(sourceRef); return; }
    if (operationButton.dataset.requiresMessage === "true") {
      this.pendingOperation = { code: operationCode, label: operationButton.textContent?.trim() || "Continua", sourceRef };
      this.error = null;
      this.message = null;
      this.render();
      requestAnimationFrame(() => this.querySelector("textarea[data-operation-message]")?.focus());
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

  renderOperationConfirmation() {
    if (!this.pendingOperation) return "";
    return `<section class="confirmation-panel resource-operation-confirmation" role="alert"><div><strong>Motivazione richiesta</strong><p>Spiega in modo sintetico quali modifiche sono necessarie. Il messaggio verrà registrato nel workflow editoriale.</p><label>Motivazione<textarea data-operation-message rows="3" placeholder="Descrivi cosa deve essere corretto"></textarea></label></div><div class="button-row"><button type="button" data-confirm-operation-message>${escapeHtml(this.pendingOperation.label)}</button><button class="button-secondary" type="button" data-cancel-operation-message>Annulla</button></div></section>`;
  }

  renderForkPanel() {
    if (!this.pendingFork) return "";
    const rows = this.forkSpaces.map((space) => {
      const selected = id(space) === this.forkSpaceId;
      const stats = space.stats || {};
      return `<button type="button" class="semantic-inventory-card" data-fork-space-id="${escapeHtml(id(space))}" aria-pressed="${selected}"><span><strong>${escapeHtml(space.name || "Spazio editoriale")}</strong><small>${escapeHtml(space.description || "Nessuna descrizione")}</small></span><span class="semantic-inventory-meta">${Number(stats.itemCount || 0)} contenuti · ${Number(stats.collectionCount || 0)} raccolte${selected ? " · destinazione" : ""}</span></button>`;
    }).join("");
    return `<div class="context-workspace-inspector-layer"><aside class="context-workspace-inspector semantic-inventory-inspector" aria-label="Scegli spazio editoriale di destinazione"><div class="section-heading"><div><span class="eyebrow">Copia del contenuto</span><h2>Dove vuoi creare la copia?</h2><p>Il fork crea un nuovo Item indipendente. Lo Space scelto diventa la sua prima appartenenza editoriale; il contenuto sorgente non viene spostato.</p></div><button type="button" class="button-secondary small" data-close-fork-panel aria-label="Chiudi">×</button></div>${this.forkLoading ? `<div class="empty-state compact"><p>Caricamento degli spazi…</p></div>` : rows ? `<div class="semantic-inventory-list">${rows}</div><div class="semantic-inventory-footer"><button type="button" data-confirm-fork ${!this.forkSpaceId || this.busy ? "disabled" : ""}>Crea copia nello spazio selezionato</button><button type="button" class="button-secondary" data-close-fork-panel>Annulla</button></div>` : `<div class="empty-state compact"><h3>Nessuno spazio editoriale disponibile</h3><p>Prima di creare una copia serve uno Space attivo nell'area di lavoro corrente.</p><button type="button" data-open-editorial-library>Apri Libreria editoriale</button></div>`}</aside></div>`;
  }

  renderRemoval(asset) {
    const allowed = asset.ownership === "owned" && (asset.availableOperations || []).some((operation) => operation.code === "remove_resource");
    if (!allowed) return "";
    const copy = {
      item_edition: { subject: "contenuto", consequence: "Il contenuto e tutte le sue versioni editoriali non compariranno più nella tua Libreria." },
      editorial_context: { subject: "raccolta editoriale", consequence: "La raccolta non comparirà più nella tua Libreria e non potrà essere usata per nuove visite o nuove pubblicazioni." },
      namespace: { subject: "regole editoriali", consequence: "Le regole editoriali non compariranno più nella tua Libreria e non saranno disponibili per nuovi contenuti." },
      physical_vocabulary: { subject: "vocabolario fisico", consequence: "Il vocabolario fisico non comparirà più nella tua Libreria e non potrà essere scelto per nuovo authoring di sedi. Le revision già pinzate da Layout pubblicati o già acquisite restano snapshot storiche utilizzabili." },
      visit: { subject: "visita", consequence: "La visita e tutte le sue versioni non compariranno più nella tua Libreria e non potranno essere pubblicate nuovamente." },
    }[asset.resourceType];
    if (!copy) return "";
    const { subject, consequence } = copy;
    const collection = asset.resourceType === "editorial_context";
    const relationCount = Number(asset.removalImpact?.semanticGraphRelationCount || 0);
    const collectionCount = Number(asset.removalImpact?.semanticGraphCollectionCount || 0);
    const remainingCollections = Math.max(0, collectionCount - 1);
    const graphPreservation = collection
      ? `<div class="resource-removal-critical resource-removal-critical--preserved"><span>${icon("link", { size: 24 })}</span><div><strong>Il grafo semantico viene conservato</strong><p>${relationCount > 0 ? `Le sue <strong>${relationCount} ${relationCount === 1 ? "relazione" : "relazioni"}</strong> non vengono eliminate.` : "Il grafo resta disponibile anche se al momento non contiene relazioni."}</p><p>${remainingCollections > 0 ? `Continuerà a essere usato da ${remainingCollections} ${remainingCollections === 1 ? "altra raccolta" : "altre raccolte"}.` : "Potrà essere riutilizzato da un'altra raccolta in futuro."}</p></div></div>`
      : "";
    const confirmation = this.pendingRemoval
      ? `<section class="confirmation-panel resource-removal-confirmation" role="alert"><div><span class="eyebrow">Conferma richiesta</span><strong>Eliminare ${subject} “${escapeHtml(asset.title)}”?</strong><p>${consequence} Le pubblicazioni verranno ritirate e le offerte rese inattive. Acquisizioni, diritti già concessi e adozioni resteranno validi.</p>${graphPreservation}</div><div class="button-row"><button class="danger" type="button" data-confirm-removal ${this.busy ? "disabled" : ""}>Elimina ${subject}</button><button class="button-secondary" type="button" data-cancel-removal ${this.busy ? "disabled" : ""}>Annulla</button></div></section>`
      : "";
    return `<section class="panel resource-danger-zone"><span class="eyebrow">Operazione sensibile</span><h2>Elimina dall’account</h2><p>${consequence}</p><p class="note">Chi ha già acquisito la risorsa continuerà a usare la snapshot autorizzata. Lo storico commerciale non verrà cancellato.</p>${confirmation || `<button class="danger" type="button" data-request-removal>${icon("trash", { size: 15 })} Elimina ${subject}</button>`}</section>`;
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
    this.innerHTML = `<main class="page resource-page"><nav class="breadcrumb" aria-label="Percorso"><button data-workspace-back type="button">${icon("arrowLeft", { size: 15 })} ${this.state.ownership === "licensed" ? "Attività" : "Libreria"}</button><span>/</span><span>${escapeHtml(asset.title)}</span></nav>${this.message ? `<p class="status success" role="status">${escapeHtml(this.message)}</p>` : ""}${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}<section class="resource-hero"><div class="button-row"><span class="badge">${asset.ownership === "owned" ? "Di proprietà" : "Con licenza"}</span>${state}</div><h1>${escapeHtml(asset.title)}</h1><p>${escapeHtml(resourceLabel(asset.resourceType))}</p>${asset.summary ? `<p>${escapeHtml(asset.summary)}</p>` : ""}${this.renderResourceFacts(asset)}${editorial}${listing}${rights}</section><section class="panel resource-actions"><span class="eyebrow">Cosa puoi fare</span><h2>Azioni disponibili</h2>${this.renderOperationConfirmation()}<div class="operations">${this.renderOperations(asset) || "<p>Nessuna azione disponibile.</p>"}</div><p class="note">Le azioni mostrate dipendono dai tuoi permessi e dallo stato corrente della risorsa.</p></section>${this.renderRemoval(asset)}</main>${this.renderForkPanel()}`;
  }
}
customElements.define("artaround-workspace-view", ArtAroundWorkspaceView);
