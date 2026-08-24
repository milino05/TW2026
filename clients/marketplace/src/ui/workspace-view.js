import { currentRoute, navigate } from "../application/router.js";
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
function moneyMap(revenueByCurrency = {}) {
  const entries = Object.entries(revenueByCurrency);
  if (!entries.length) return "0";
  return entries.map(([currency, minor]) => {
    const amount = Number(minor || 0) / 100;
    try { return new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(amount); }
    catch { return `${amount.toFixed(2)} ${currency}`; }
  }).join(" · ");
}

function selectedPrincipalFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return {
    principalType: params.get("principalType") || "user",
    principalId: params.get("principalId") || null,
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
  workspace = null;
  distribution = null;
  busy = false;
  error = null;
  message = null;
  principal = selectedPrincipalFromUrl();

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
    try {
      const workspace = await marketplaceRepository.workspace(this.principal);
      this.workspace = workspace;
      this.principal = { principalType: workspace.principal.type, principalId: String(workspace.principal.id) };
      try { this.distribution = await marketplaceRepository.distribution(this.principal); }
      catch { this.distribution = null; }
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Le mie risorse non sono disponibili";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.matches("form[data-principal]")) return;
    event.preventDefault();
    const data = new FormData(form);
    const [principalType, principalId] = String(data.get("principal") || "").split(":");
    if (!principalType || !principalId) return;
    const path = currentRoute() === "/workspace/resource" ? "/workspace/resource" : "/workspace";
    const current = new URLSearchParams(window.location.search);
    current.set("principalType", principalType);
    current.set("principalId", principalId);
    navigate(`${path}?${current.toString()}`);
  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;

    const authoringButton = target?.closest("button[data-authoring-href]");
    if (authoringButton) {
      navigate(authoringButton.dataset.authoringHref);
      return;
    }

    const resourceLink = target?.closest("button[data-resource]");
    if (resourceLink) {
      const resourceType = resourceLink.dataset.resourceType || "";
      const resourceId = resourceLink.dataset.resourceId || "";
      const ownership = resourceLink.dataset.ownership || "";
      const params = new URLSearchParams({ principalType: this.principal.principalType, principalId: this.principal.principalId, resourceType, resourceId, ownership });
      navigate(`/workspace/resource?${params.toString()}`);
      return;
    }

    const listingButton = target?.closest("button[data-create-listing]");
    if (listingButton) {
      await this.execute(async () => marketplaceRepository.createListing({ resourceType: listingButton.dataset.resourceType, resourceId: listingButton.dataset.resourceId, sellerType: this.principal.principalType, sellerId: this.principal.principalId }), "La risorsa è ora disponibile nel catalogo");
      return;
    }

    const commerceButton = target?.closest("button[data-commerce-listing]");
    if (commerceButton) {
      const params = new URLSearchParams({
        principalType: this.principal.principalType,
        principalId: this.principal.principalId,
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
      await this.execute(() => marketplaceRepository.executeWorkspaceOperation({ operationCode, sourceRef, targetPrincipal: { type: this.principal.principalType, id: this.principal.principalId }, payload }), isWorkflowOperation(operationCode) ? "Operazione editoriale completata" : "Operazione completata");
      return;
    }

    const back = target?.closest("button[data-workspace-back]");
    if (back) navigate(`/workspace?principalType=${encodeURIComponent(this.principal.principalType)}&principalId=${encodeURIComponent(this.principal.principalId)}`);
  };

  async execute(callback, successMessage) {
    this.busy = true;
    this.error = null;
    this.message = null;
    this.render();
    try {
      await callback();
      this.message = successMessage;
      await this.load();
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Operazione non riuscita";
      this.busy = false;
      this.render();
    }
  }

  renderPrincipalSelector() {
    const options = (this.workspace?.availablePrincipals || []).map((entry) => {
      const value = `${entry.type}:${entry.id}`;
      const selected = entry.type === this.principal.principalType && String(entry.id) === String(this.principal.principalId);
      const role = entry.type === "organization" ? ` · ${entry.role}` : "";
      return `<option value="${escapeHtml(value)}" ${selected ? "selected" : ""}>${escapeHtml(entry.name)}${escapeHtml(role)}</option>`;
    }).join("");
    return `<form data-principal class="principal working-context surface"><label><span>Stai lavorando per</span><select name="principal">${options}</select></label><button class="button-secondary" type="submit">Cambia</button></form>`;
  }

  renderOperations(asset) {
    return (asset.availableOperations || []).map((operation) => {
      if (operation.code === "create_listing") return `<button type="button" data-create-listing data-resource-type="${escapeHtml(asset.sourceRef?.resourceType || asset.resourceType)}" data-resource-id="${escapeHtml(refId(asset.sourceRef) || asset.resourceId)}">${icon("catalog", { size: 15 })}Pubblica nel catalogo</button>`;
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
      return `<button class="button-secondary" type="button" data-resource data-resource-type="${escapeHtml(asset.resourceType)}" data-resource-id="${escapeHtml(asset.resourceId)}" data-ownership="${escapeHtml(asset.ownership)}">${escapeHtml(operation.label)}${icon("chevron", { size: 14 })}</button>`;
    }).join(" ");
  }

  renderAsset(asset) {
    const capabilityText = asset.ownership === "licensed" && (asset.capabilities || []).length
      ? `<details class="technical-details"><summary>Dettagli dei diritti</summary><p>${(asset.capabilities || []).map(escapeHtml).join(" · ")}</p></details>`
      : "";
    const listing = asset.listing ? `<p>${icon("store", { size: 15 })}<strong>Nel catalogo</strong> · ${Number(asset.listing.activeOfferCount) || 0} offerte attive</p>` : "";
    const editorial = asset.editorialWorkflow ? `<p><strong>Stato editoriale:</strong> ${escapeHtml(resourceStateLabel(asset.editorialWorkflow.status))} · ${escapeHtml(integrityLabel(asset.editorialWorkflow.integrityStatus))}</p>` : "";
    const state = asset.state ? `<span class="status">${escapeHtml(resourceStateLabel(asset.state))}</span>` : "";
    return `<article class="asset ${asset.ownership}"><header><span class="asset-icon">${icon(asset.resourceType === "visit" ? "route" : asset.resourceType === "namespace" ? "book" : "catalog")}</span><div><p class="badge">${escapeHtml(resourceLabel(asset.resourceType))}</p><h3>${escapeHtml(asset.title)}</h3></div>${state}</header><div class="asset-copy"><p class="muted">${asset.ownership === "owned" ? "Di proprietà" : "Con licenza"}</p>${asset.summary ? `<p>${escapeHtml(asset.summary)}</p>` : ""}${editorial}${listing}${capabilityText}</div><footer class="operations">${this.renderOperations(asset)}</footer></article>`;
  }

  renderDistribution() {
    const summary = this.distribution?.summary;
    if (!summary) return `<section class="workspace-section"><div class="section-heading"><div><span class="eyebrow">Vendite</span><h2>Attività commerciale</h2></div></div><div class="empty-state"><p>Le statistiche di vendita non sono disponibili per questo contesto di lavoro.</p></div></section>`;
    const sales = (this.distribution.recentSales || []).map((entry) => `<li>${escapeHtml(entry.pricing?.type || "")} · ${escapeHtml(new Date(entry.acquiredAt).toLocaleString("it-IT"))}</li>`).join("");
    const adoptions = (this.distribution.recentAdoptions || []).map((entry) => `<li>${escapeHtml(entry.action)} · ${escapeHtml(new Date(entry.adoptedAt).toLocaleString("it-IT"))}</li>`).join("");
    return `<section class="workspace-section"><div class="section-heading"><div><span class="eyebrow">Vendite</span><h2>Attività commerciale</h2></div></div><dl class="stats"><div><dt>Schede nel catalogo</dt><dd>${summary.listingCount}</dd></div><div><dt>Acquisizioni</dt><dd>${summary.salesCount}</dd></div><div><dt>Acquirenti unici</dt><dd>${summary.uniqueBuyers}</dd></div><div><dt>Adozioni</dt><dd>${summary.adoptionCount}</dd></div><div><dt>Ricavi simulati</dt><dd>${escapeHtml(moneyMap(summary.revenueByCurrency))}</dd></div></dl><div class="activity-grid"><div class="activity-panel"><h3>Vendite recenti</h3><ul>${sales || "<li>Nessuna acquisizione.</li>"}</ul></div><div class="activity-panel"><h3>Adozioni recenti</h3><ul>${adoptions || "<li>Nessuna adozione.</li>"}</ul></div></div></section>`;
  }

  selectedResource() {
    if (currentRoute() !== "/workspace/resource") return null;
    const params = new URLSearchParams(window.location.search);
    const type = params.get("resourceType");
    const id = params.get("resourceId");
    return [...(this.workspace?.ownedAssets || []), ...(this.workspace?.licensedAssets || [])].find((asset) => asset.resourceType === type && String(asset.resourceId) === id) || null;
  }

  renderResourceRoute(asset) {
    if (!asset) return `<main class="page"><button class="back-button" data-workspace-back type="button">${icon("arrowLeft")} Le mie risorse</button><div class="empty-state"><h1>Risorsa non disponibile</h1><p>Potrebbe non essere più accessibile nel contesto di lavoro selezionato.</p></div></main>`;
    const editorial = asset.editorialWorkflow ? `<p><strong>Stato editoriale:</strong> ${escapeHtml(resourceStateLabel(asset.editorialWorkflow.status))} · ${escapeHtml(integrityLabel(asset.editorialWorkflow.integrityStatus))}</p>` : "";
    return `<main class="page resource-page"><nav class="breadcrumb"><button data-workspace-back type="button">${icon("arrowLeft", { size: 15 })} Le mie risorse</button><span>/</span><span>${escapeHtml(asset.title)}</span></nav><section class="resource-hero"><span class="badge">${asset.ownership === "owned" ? "Di proprietà" : "Con licenza"}</span><h1>${escapeHtml(asset.title)}</h1><p>${escapeHtml(resourceLabel(asset.resourceType))}</p>${asset.summary ? `<p>${escapeHtml(asset.summary)}</p>` : ""}${editorial}</section><section class="panel resource-actions"><span class="eyebrow">Cosa puoi fare</span><h2>Azioni disponibili</h2><div class="operations">${this.renderOperations(asset) || "<p>Nessuna azione disponibile.</p>"}</div><p class="note">Le azioni mostrate dipendono dai tuoi permessi e dallo stato corrente della risorsa.</p></section></main>`;
  }

  render() {
    if (this.busy && !this.workspace) { this.innerHTML = `<main class="page"><div class="empty-state"><div class="skeleton skeleton-line" style="width:14rem"></div><p>Caricamento delle tue risorse…</p></div></main>`; return; }
    if (this.error && !this.workspace) { this.innerHTML = `<main class="page"><p role="alert">${escapeHtml(this.error)}</p></main>`; return; }
    const selected = this.selectedResource();
    const createVisitHref = `/workspace/visit-authoring?principalType=${encodeURIComponent(this.principal.principalType)}&principalId=${encodeURIComponent(this.principal.principalId || "")}`;
    const owned = (this.workspace?.ownedAssets || []).map((asset) => this.renderAsset(asset)).join("");
    const licensed = (this.workspace?.licensedAssets || []).map((asset) => this.renderAsset(asset)).join("");
    const spaces = (this.workspace?.contentSpaces || []).map((space) => `<article class="space-card"><span class="space-icon">${icon("workspace")}</span><div><strong>${escapeHtml(space.name)}</strong><p>${escapeHtml(space.description || "Spazio editoriale")}</p></div></article>`).join("");
    const commerceHref = `/workspace/commerce?principalType=${encodeURIComponent(this.principal.principalType)}&principalId=${encodeURIComponent(this.principal.principalId || "")}`;
    const body = currentRoute() === "/workspace/resource" ? this.renderResourceRoute(selected) : `<main class="page workspace-page"><header class="page-header"><div><span class="eyebrow">Area creator</span><h1>Le mie risorse</h1><p>Qui trovi ciò che possiedi e le risorse che puoi usare grazie a una licenza.</p></div><div class="button-row"><a class="button-link" data-route href="/workspace/item-authoring">${icon("plus")} Crea contenuto</a><a class="button-link secondary" data-route href="${createVisitHref}">${icon("route")} Crea visita</a><a class="button-link secondary" data-route href="${commerceHref}">${icon("store")} Licenze e vendite</a></div></header>${this.renderPrincipalSelector()}${this.message ? `<p role="status">${escapeHtml(this.message)}</p>` : ""}${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}<section class="workspace-section"><div class="section-heading"><div><span class="eyebrow">Organizzazione</span><h2>Spazi editoriali</h2><p>Raggruppano i contenuti che usi per preparare e pubblicare raccolte.</p></div><span class="count">${this.workspace?.contentSpaces?.length || 0}</span></div><div class="space-grid">${spaces || `<div class="empty-state"><h3>Nessuno spazio editoriale</h3><p>Gli spazi editoriali vengono configurati per organizzare i contenuti di lavoro.</p></div>`}</div></section><section class="workspace-section"><div class="section-heading"><div><span class="eyebrow">Di proprietà</span><h2>Risorse create da te</h2></div><span class="count">${this.workspace?.ownedAssets?.length || 0}</span></div><div class="asset-grid">${owned || `<div class="empty-state"><h3>Non hai ancora creato risorse</h3><p>Puoi iniziare da un contenuto o da una visita.</p><div class="button-row"><a class="button-link" data-route href="/workspace/item-authoring">Crea contenuto</a><a class="button-link secondary" data-route href="${createVisitHref}">Crea visita</a></div></div>`}</div></section><section class="workspace-section"><div class="section-heading"><div><span class="eyebrow">Con licenza</span><h2>Risorse che puoi utilizzare</h2><p>I diritti acquisiti permettono usi specifici senza cambiare il proprietario della risorsa.</p></div><span class="count">${this.workspace?.licensedAssets?.length || 0}</span></div><div class="asset-grid">${licensed || `<div class="empty-state"><h3>Nessuna risorsa con licenza</h3><p>Esplora il catalogo per trovare contenuti e visite che puoi utilizzare.</p><a class="button-link secondary" data-route href="/catalog">Vai al catalogo</a></div>`}</div></section>${this.renderDistribution()}</main>`;
    this.innerHTML = body;
  }
}

customElements.define("artaround-workspace-view", ArtAroundWorkspaceView);
