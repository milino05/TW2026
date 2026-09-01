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
  mode = "existing";
  selectedContentSpaceId = "";
  busy = false;
  error = null;

  connectedCallback() {
    this.requestedContentSpaceId = new URLSearchParams(window.location.search).get("contentSpaceId") || null;
    this.addEventListener("change", this.onChange);
    this.addEventListener("submit", this.onSubmit);
    this.addEventListener("click", this.onClick);
    this.load();
  }
  disconnectedCallback() {
    this.removeEventListener("change", this.onChange);
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
      const requested = this.spaces.find((space) => String(space._id || space.id) === String(this.requestedContentSpaceId));
      if (requested) {
        this.mode = "existing";
        this.selectedContentSpaceId = String(requested._id || requested.id);
      } else if (this.spaces.length === 1) {
        this.mode = "existing";
        this.selectedContentSpaceId = String(this.spaces[0]._id || this.spaces[0].id);
      } else if (!this.spaces.length && this.preflight?.collection?.canCreateContentSpace) {
        this.mode = "new";
      } else if (this.spaces.length) {
        this.mode = "existing";
        this.selectedContentSpaceId = String(this.spaces[0]._id || this.spaces[0].id);
      }
    } catch (error) { this.error = error instanceof Error ? error.message : "Non è possibile preparare la nuova raccolta"; }
    finally { this.busy = false; this.render(); }
  }

  onChange = (event) => {
    const target = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement ? event.target : null;
    if (!target) return;
    if (target.name === "spaceMode") { this.mode = target.value === "new" ? "new" : "existing"; this.render(); }
    if (target.name === "contentSpaceId") this.selectedContentSpaceId = target.value;
  };

  onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-back-create]")) navigate("/create");
  };

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.matches("[data-create-collection]")) return;
    event.preventDefault();
    if (!this.preflight?.collection?.allowed) return;
    const data = new FormData(form);
    const payload = {
      ownerType: this.context.type,
      ownerId: this.context.id,
      namespaceId: String(data.get("namespaceId") || ""),
      displayName: String(data.get("displayName") || "").trim(),
      shortDescription: String(data.get("shortDescription") || "").trim() || null,
      description: String(data.get("description") || "").trim() || null,
    };
    if (this.mode === "new") {
      payload.newContentSpaceName = String(data.get("newContentSpaceName") || "").trim();
      payload.newContentSpaceDescription = String(data.get("newContentSpaceDescription") || "").trim() || null;
    } else payload.contentSpaceId = String(data.get("contentSpaceId") || "");

    this.busy = true; this.error = null; this.render();
    try {
      const created = await editorialRepository.createCollection(payload);
      const editorialContextId = created?.editorialContext?.id || created?.editorialContext?._id;
      if (!editorialContextId) throw new Error("La raccolta è stata creata ma non è stato restituito il suo identificatore");
      navigate(`/workspace/editorial-studio?editorialContextId=${encodeURIComponent(editorialContextId)}`);
    } catch (error) { this.error = error instanceof Error ? error.message : "Creazione della raccolta non completata"; this.busy = false; this.render(); }
  };

  blocker() {
    const blocker = this.preflight?.collection?.blockers?.[0];
    return `<div class="empty-state"><span>${icon("warning", { size: 28 })}</span><h1>La raccolta non può ancora essere creata</h1><p>${escapeHtml(blocker?.message || "Mancano i prerequisiti editoriali.")}</p><a class="button-link secondary" data-route href="/create">Torna a Crea</a></div>`;
  }

  renderSpaceChoice() {
    const canCreate = this.preflight?.collection?.canCreateContentSpace === true;
    const options = this.spaces.map((space) => `<option value="${escapeHtml(space._id || space.id)}" ${String(space._id || space.id) === this.selectedContentSpaceId ? "selected" : ""}>${escapeHtml(space.name)}</option>`).join("");
    if (!this.spaces.length && !canCreate) return `<div class="inline-notice">${icon("warning", { size: 16 })}<span>Non esiste uno spazio editoriale utilizzabile e il tuo ruolo non consente di crearne uno.</span></div>`;
    return `<fieldset><legend>Spazio editoriale</legend><p class="note">Lo spazio conserva gli Item indipendentemente dal Namespace. La raccolta aggiunge regole editoriali, composizione e grafo semantico.</p>${this.spaces.length ? `<label class="choice-row"><input type="radio" name="spaceMode" value="existing" ${this.mode === "existing" ? "checked" : ""}><span><strong>Usa uno spazio esistente</strong><small>Riusa gli Item già presenti.</small></span></label>${this.mode === "existing" ? `<label>Spazio<select name="contentSpaceId" required>${options}</select></label>` : ""}` : ""}${canCreate ? `<label class="choice-row"><input type="radio" name="spaceMode" value="new" ${this.mode === "new" ? "checked" : ""}><span><strong>Crea un nuovo spazio</strong><small>ArtAround creerà spazio e raccolta come un'unica operazione.</small></span></label>${this.mode === "new" ? `<label>Nome del nuovo spazio<input name="newContentSpaceName" required placeholder="Il mio spazio editoriale"></label><label>Descrizione dello spazio<textarea name="newContentSpaceDescription" rows="3" placeholder="Facoltativa"></textarea></label>` : ""}` : ""}</fieldset>`;
  }

  render() {
    if (this.busy && !this.preflight) { this.innerHTML = `<main class="page"><div class="empty-state"><p>Preparazione della raccolta…</p></div></main>`; return; }
    if (this.error && !this.preflight) { this.innerHTML = `<main class="page"><div class="empty-state"><h1>Nuova raccolta</h1><p role="alert">${escapeHtml(this.error)}</p></div></main>`; return; }
    if (!this.preflight) return;
    if (!this.preflight.collection?.allowed) { this.innerHTML = `<main class="page collection-create-page">${this.blocker()}</main>`; return; }
    const namespaces = this.preflight.collection.usableNamespaces || [];
    const namespaceOptions = namespaces.map((namespace) => `<option value="${escapeHtml(namespace.id)}">${escapeHtml(namespace.name)}${namespace.source === "licensed" ? " · acquisito" : ""}</option>`).join("");
    const noSpaceAuthority = !this.spaces.length && !this.preflight.collection.canCreateContentSpace;
    this.innerHTML = `<style>
      artaround-editorial-collection-create-view .collection-create-page{max-width:52rem;margin:auto;padding:2rem 1rem 5rem;display:grid;gap:1rem}artaround-editorial-collection-create-view .create-form{display:grid;gap:1rem}artaround-editorial-collection-create-view fieldset{display:grid;gap:.75rem;padding:1rem;border:1px solid var(--border);border-radius:var(--radius)}artaround-editorial-collection-create-view .choice-row{display:flex;gap:.65rem;align-items:flex-start;padding:.7rem;border:1px solid var(--border);border-radius:var(--radius)}artaround-editorial-collection-create-view .choice-row span{display:grid;gap:.15rem}artaround-editorial-collection-create-view .choice-row small{color:var(--muted)}artaround-editorial-collection-create-view .create-actions{display:flex;justify-content:flex-end;gap:.6rem}
    </style><main class="page collection-create-page" aria-busy="${this.busy}"><header><button type="button" class="text-button" data-back-create>${icon("arrowLeft", { size: 15 })} Crea</button><span class="eyebrow">Nuova raccolta editoriale</span><h1>Definisci il contesto, poi cura i contenuti</h1><p>Qui scegli soltanto spazio, regole e identità della raccolta. Contenuti e relazioni si gestiscono poi nello Studio.</p></header>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}<form class="panel create-form" data-create-collection><label>Nome della raccolta<input name="displayName" required maxlength="160" placeholder="Rinascimento italiano"></label><label>Descrizione breve<input name="shortDescription" maxlength="240" placeholder="Facoltativa"></label><label>Descrizione<textarea name="description" rows="4" placeholder="Obiettivo, pubblico o criterio curatoriale"></textarea></label><fieldset><legend>Regole editoriali</legend><label>Namespace<select name="namespaceId" required>${namespaceOptions}</select></label><p class="note">Il Namespace non potrà essere sostituito in seguito: per regole diverse si crea una nuova raccolta.</p></fieldset>${this.renderSpaceChoice()}<div class="create-actions"><button type="button" class="button-secondary" data-back-create>Annulla</button><button type="submit" ${this.busy || noSpaceAuthority ? "disabled" : ""}>Crea raccolta ${icon("chevron", { size: 15 })}</button></div></form></main>`;
  }
}
customElements.define("artaround-editorial-collection-create-view", ArtAroundEditorialCollectionCreateView);
