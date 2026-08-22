import { navigate } from "../application/router.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";

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
      this.error = error instanceof Error ? error.message : "Workspace non disponibile";
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
    const path = window.location.pathname === "/workspace/resource" ? "/workspace/resource" : "/workspace";
    const current = new URLSearchParams(window.location.search);
    current.set("principalType", principalType);
    current.set("principalId", principalId);
    navigate(`${path}?${current.toString()}`);
  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const resourceLink = target?.closest("button[data-resource]");
    if (resourceLink) {
      const resourceType = resourceLink.dataset.resourceType || "";
      const resourceId = resourceLink.dataset.resourceId || "";
      const ownership = resourceLink.dataset.ownership || "";
      if (resourceType === "editorial_context" && ownership === "owned") {
        navigate(`/workspace/context-compose?editorialContextId=${encodeURIComponent(resourceId)}`);
        return;
      }
      const params = new URLSearchParams({
        principalType: this.principal.principalType,
        principalId: this.principal.principalId,
        resourceType,
        resourceId,
        ownership,
      });
      navigate(`/workspace/resource?${params.toString()}`);
      return;
    }

    const listingButton = target?.closest("button[data-create-listing]");
    if (listingButton) {
      await this.execute(async () => marketplaceRepository.createListing({
        resourceType: listingButton.dataset.resourceType,
        resourceId: listingButton.dataset.resourceId,
        sellerType: this.principal.principalType,
        sellerId: this.principal.principalId,
      }), "Listing pubblicata nel Marketplace");
      return;
    }

    const operationButton = target?.closest("button[data-operation]");
    if (operationButton) {
      const sourceRef = { resourceType: operationButton.dataset.sourceType, resourceId: operationButton.dataset.sourceId };
      await this.execute(() => marketplaceRepository.executeWorkspaceOperation({
        operationCode: operationButton.dataset.operation,
        sourceRef,
        targetPrincipal: { type: this.principal.principalType, id: this.principal.principalId },
      }), "Operazione completata");
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
    return `<form data-principal class="principal"><label>Workspace di <select name="principal">${options}</select></label><button type="submit">Cambia</button></form>`;
  }

  renderOperations(asset) {
    return (asset.availableOperations || []).map((operation) => {
      if (operation.code === "create_listing") {
        return `<button type="button" data-create-listing data-resource-type="${escapeHtml(asset.sourceRef?.resourceType || asset.resourceType)}" data-resource-id="${escapeHtml(refId(asset.sourceRef) || asset.resourceId)}">${escapeHtml(operation.label)}</button>`;
      }
      if (DIRECT_OPERATIONS.has(operation.code)) {
        const source = operation.sourceRef || asset.sourceRef || { resourceType: asset.resourceType, resourceId: asset.resourceId };
        return `<button type="button" data-operation="${escapeHtml(operation.code)}" data-source-type="${escapeHtml(refType(source))}" data-source-id="${escapeHtml(refId(source))}">${escapeHtml(operation.label)}</button>`;
      }
      const label = operation.code === "open_editor" && asset.resourceType === "editorial_context" ? "Componi release" : operation.label;
      return `<button type="button" data-resource data-resource-type="${escapeHtml(asset.resourceType)}" data-resource-id="${escapeHtml(asset.resourceId)}" data-ownership="${escapeHtml(asset.ownership)}">${escapeHtml(label)}</button>`;
    }).join(" ");
  }

  renderAsset(asset) {
    const capabilityText = asset.ownership === "licensed" ? `<p>Capability: ${(asset.capabilities || []).map(escapeHtml).join(" · ")}</p>` : "";
    const listing = asset.listing ? `<p>Listing ${escapeHtml(asset.listing.status)} · ${Number(asset.listing.activeOfferCount) || 0} offerte attive</p>` : "";
    return `<article class="asset ${asset.ownership}"><p class="badge">${asset.ownership === "owned" ? "Di proprietà" : "Con licenza"}</p><h3>${escapeHtml(asset.title)}</h3><p>${escapeHtml(asset.resourceType)}${asset.state ? ` · ${escapeHtml(asset.state)}` : ""}</p>${asset.summary ? `<p>${escapeHtml(asset.summary)}</p>` : ""}${capabilityText}${listing}<div class="operations">${this.renderOperations(asset)}</div></article>`;
  }

  renderDistribution() {
    const summary = this.distribution?.summary;
    if (!summary) return `<section><h2>Distribuzione</h2><p>Dashboard non disponibile per questo principal.</p></section>`;
    const sales = (this.distribution.recentSales || []).map((entry) => `<li>${escapeHtml(entry.pricing?.type || "")} · ${escapeHtml(new Date(entry.acquiredAt).toLocaleString("it-IT"))}</li>`).join("");
    const adoptions = (this.distribution.recentAdoptions || []).map((entry) => `<li>${escapeHtml(entry.action)} · ${escapeHtml(new Date(entry.adoptedAt).toLocaleString("it-IT"))}</li>`).join("");
    return `<section><h2>Distribuzione</h2><dl class="stats"><div><dt>Listing</dt><dd>${summary.listingCount}</dd></div><div><dt>Acquisizioni</dt><dd>${summary.salesCount}</dd></div><div><dt>Buyer unici</dt><dd>${summary.uniqueBuyers}</dd></div><div><dt>Adozioni</dt><dd>${summary.adoptionCount}</dd></div><div><dt>Ricavi simulati</dt><dd>${escapeHtml(moneyMap(summary.revenueByCurrency))}</dd></div></dl><h3>Vendite/acquisizioni recenti</h3><ul>${sales || "<li>Nessuna acquisizione.</li>"}</ul><h3>Adozioni recenti</h3><ul>${adoptions || "<li>Nessuna adozione.</li>"}</ul></section>`;
  }

  selectedResource() {
    if (window.location.pathname !== "/workspace/resource") return null;
    const params = new URLSearchParams(window.location.search);
    const type = params.get("resourceType");
    const id = params.get("resourceId");
    return [...(this.workspace?.ownedAssets || []), ...(this.workspace?.licensedAssets || [])].find((asset) => asset.resourceType === type && String(asset.resourceId) === id) || null;
  }

  renderResourceRoute(asset) {
    if (!asset) return `<main><button data-workspace-back type="button">← Workspace</button><h1>Risorsa non disponibile</h1></main>`;
    return `<main><button data-workspace-back type="button">← Workspace</button><p class="badge">${asset.ownership === "owned" ? "Di proprietà" : "Con licenza"}</p><h1>${escapeHtml(asset.title)}</h1><p>${escapeHtml(asset.resourceType)}</p>${asset.summary ? `<p>${escapeHtml(asset.summary)}</p>` : ""}<h2>Operazioni disponibili</h2><div class="operations">${this.renderOperations(asset) || "<p>Nessuna operazione disponibile.</p>"}</div><p class="note">Le operazioni che richiedono un target editoriale specifico vengono completate nel relativo editor; questa pagina non costruisce ID o autorizzazioni lato client.</p></main>`;
  }

  render() {
    if (this.busy && !this.workspace) { this.innerHTML = `<main><p>Caricamento Workspace…</p></main>`; return; }
    if (this.error && !this.workspace) { this.innerHTML = `<main><p role="alert">${escapeHtml(this.error)}</p></main>`; return; }
    const selected = this.selectedResource();
    const body = window.location.pathname === "/workspace/resource" ? this.renderResourceRoute(selected) : `<main><h1>Creator Workspace</h1>${this.renderPrincipalSelector()}${this.message ? `<p role="status">${escapeHtml(this.message)}</p>` : ""}${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}<p><a data-route href="/workspace/item-authoring">Crea nuovo contenuto</a></p><section><h2>ContentSpace</h2>${(this.workspace?.contentSpaces || []).map((space) => `<article><strong>${escapeHtml(space.name)}</strong><p>${escapeHtml(space.description)}</p></article>`).join("") || "<p>Nessun ContentSpace.</p>"}</section><section><h2>Asset di proprietà</h2>${(this.workspace?.ownedAssets || []).map((asset) => this.renderAsset(asset)).join("") || "<p>Nessun asset di proprietà.</p>"}</section><section><h2>Asset con licenza</h2><p>Questi diritti non trasferiscono ownership.</p>${(this.workspace?.licensedAssets || []).map((asset) => this.renderAsset(asset)).join("") || "<p>Nessun asset con licenza.</p>"}</section>${this.renderDistribution()}</main>`;
    this.innerHTML = `<style>main{max-width:64rem;margin:0 auto;padding:2rem 1rem}section{margin-block:2rem}.principal{display:flex;gap:.75rem;align-items:end;flex-wrap:wrap}.principal label{display:grid;gap:.3rem}.asset{padding:1rem;margin-block:.75rem;border:1px solid currentColor}.licensed{border-style:dashed}.badge{font-size:.8rem;text-transform:uppercase;letter-spacing:.04em}.operations{display:flex;gap:.5rem;flex-wrap:wrap}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:.75rem}.stats div{border:1px solid currentColor;padding:.75rem}.stats dt{font-size:.85rem}.stats dd{margin:.25rem 0 0;font-size:1.25rem}button,select{font:inherit;padding:.55rem .75rem}.note{margin-top:2rem}</style>${body}`;
  }
}

customElements.define("artaround-workspace-view", ArtAroundWorkspaceView);
