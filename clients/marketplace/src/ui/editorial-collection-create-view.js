import { navigate } from "../application/router.js";
import { operatingPrincipal, readOperatingContext } from "../application/operating-context.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
import { icon } from "./icons.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }

export class ArtAroundEditorialCollectionCreateView extends HTMLElement {
  context = readOperatingContext();
  preflight = null;
  spaces = [];
  requestedContentSpaceId = null;
  selectedSpace = null;
  busy = false;
  error = null;

  connectedCallback() {
    this.requestedContentSpaceId = new URLSearchParams(window.location.search).get("contentSpaceId") || null;
    this.addEventListener("submit", this.onSubmit);
    this.addEventListener("click", this.onClick);
    void this.load();
  }
  disconnectedCallback() {
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("click", this.onClick);
  }

  async load() {
    const principal = operatingPrincipal(this.context);
    if (!principal) { this.error = "Area di lavoro non selezionata"; this.render(); return; }
    this.busy = true; this.error = null; this.render();
    try {
      const [preflight, spaces] = await Promise.all([
        marketplaceRepository.authoringPreflight(principal),
        editorialRepository.listSpaces({ ownerType: this.context.type, ownerId: this.context.id }),
      ]);
      this.preflight = preflight;
      this.spaces = spaces || [];
      this.selectedSpace = this.requestedContentSpaceId
        ? this.spaces.find((space) => String(space._id || space.id) === String(this.requestedContentSpaceId)) || null
        : null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è possibile preparare la nuova raccolta";
    } finally {
      this.busy = false; this.render();
    }
  }

  backHref() {
    const id = this.selectedSpace?._id || this.selectedSpace?.id || this.requestedContentSpaceId;
    return id ? `/workspace/editorial-space?contentSpaceId=${encodeURIComponent(id)}` : "/workspace/editorial-spaces";
  }

  onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-back-space]")) navigate(this.backHref());
  };

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.matches("[data-create-collection]")) return;
    event.preventDefault();
    if (!this.preflight?.collection?.allowed || !this.selectedSpace) return;
    const data = new FormData(form);
    const payload = {
      ownerType: this.context.type,
      ownerId: this.context.id,
      contentSpaceId: String(this.selectedSpace._id || this.selectedSpace.id),
      namespaceId: String(data.get("namespaceId") || ""),
      displayName: String(data.get("displayName") || "").trim(),
      shortDescription: String(data.get("shortDescription") || "").trim() || null,
      description: String(data.get("description") || "").trim() || null,
    };
    this.busy = true; this.error = null; this.render();
    try {
      const created = await editorialRepository.createCollection(payload);
      const editorialContextId = created?.editorialContext?.id || created?.editorialContext?._id;
      if (!editorialContextId) throw new Error("La raccolta è stata creata ma non è stato restituito il suo identificatore");
      navigate(`/workspace/editorial-studio?editorialContextId=${encodeURIComponent(editorialContextId)}`);
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Creazione della raccolta non completata";
      this.busy = false; this.render();
    }
  };

  blocker() {
    if (!this.requestedContentSpaceId) {
      return `<div class="empty-state"><span>${icon("workspace", { size: 28 })}</span><h1>Scegli prima uno spazio editoriale</h1><p>Le raccolte organizzano una selezione dei contenuti di uno spazio. Apri lo spazio in cui vuoi lavorare e crea la raccolta da lì.</p><a class="button-link" data-route href="/workspace/editorial-spaces">Apri gli spazi editoriali</a></div>`;
    }
    if (!this.selectedSpace) {
      return `<div class="empty-state"><span>${icon("warning", { size: 28 })}</span><h1>Spazio non disponibile</h1><p>Lo spazio richiesto non appartiene all'area di lavoro corrente o non è più disponibile.</p><a class="button-link" data-route href="/workspace/editorial-spaces">Torna agli spazi editoriali</a></div>`;
    }
    const blocker = this.preflight?.collection?.blockers?.[0];
    return `<div class="empty-state"><span>${icon("warning", { size: 28 })}</span><h1>La raccolta non può ancora essere creata</h1><p>${escapeHtml(blocker?.message || "Mancano i prerequisiti editoriali.")}</p><button type="button" class="button-secondary" data-back-space>Torna allo spazio</button></div>`;
  }

  render() {
    if (this.busy && !this.preflight) { this.innerHTML = `<main class="page"><div class="empty-state"><p>Preparazione della raccolta…</p></div></main>`; return; }
    if (this.error && !this.preflight) { this.innerHTML = `<main class="page"><div class="empty-state"><h1>Nuova raccolta</h1><p role="alert">${escapeHtml(this.error)}</p></div></main>`; return; }
    if (!this.preflight || !this.selectedSpace || !this.preflight.collection?.allowed) { this.innerHTML = `<main class="page workspace-page">${this.blocker()}</main>`; return; }
    const spaceId = this.selectedSpace._id || this.selectedSpace.id;
    const namespaces = this.preflight.collection.usableNamespaces || [];
    const namespaceOptions = namespaces.map((namespace) => `<option value="${escapeHtml(namespace.id)}">${escapeHtml(namespace.name)}${namespace.source === "licensed" ? " · acquisito" : ""}</option>`).join("");
    this.innerHTML = `<main class="page workspace-page" aria-busy="${this.busy}"><nav class="breadcrumb" aria-label="Percorso"><a data-route href="/workspace">Libreria</a><span aria-hidden="true">/</span><a data-route href="/workspace/editorial-spaces">Spazi editoriali</a><span aria-hidden="true">/</span><a data-route href="/workspace/editorial-space?contentSpaceId=${encodeURIComponent(spaceId)}">${escapeHtml(this.selectedSpace.name)}</a><span aria-hidden="true">/</span><span>Nuova raccolta</span></nav><header class="page-header"><div><span class="eyebrow">Nuova raccolta editoriale</span><h1>Crea una raccolta in ${escapeHtml(this.selectedSpace.name)}</h1><p>La raccolta seleziona contenuti dello spazio, applica regole editoriali e collega un grafo semantico. I contenuti verranno scelti nello Studio dopo la creazione.</p></div></header>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}<form class="panel form-grid" data-create-collection><label>Nome della raccolta<input name="displayName" required maxlength="160" placeholder="Rinascimento italiano"></label><label>Descrizione breve<input name="shortDescription" maxlength="240" placeholder="Facoltativa"></label><label class="full">Descrizione<textarea name="description" rows="4" placeholder="Obiettivo, pubblico o criterio curatoriale"></textarea></label><label class="full">Regole editoriali<select name="namespaceId" required>${namespaceOptions}</select><span class="note">Le regole definiscono classificazioni, relazioni e modalità di presentazione disponibili nella raccolta.</span></label><div class="operations full"><button type="button" class="button-secondary" data-back-space>Annulla</button><button type="submit" ${this.busy ? "disabled" : ""}>Crea raccolta ${icon("chevron", { size: 15 })}</button></div></form></main>`;
  }
}
customElements.define("artaround-editorial-collection-create-view", ArtAroundEditorialCollectionCreateView);
