import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { authoringRepository } from "../infrastructure/http/authoring-repository.js";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function params() { return new URLSearchParams(window.location.search); }
function id(value) { return String(value?.id || value?._id || value || ""); }

function namespaceChoices(workspace) {
  const choices = [];
  for (const asset of workspace?.ownedAssets || []) {
    if (asset.resourceType !== "namespace") continue;
    choices.push({ id: asset.resourceId, name: asset.title, ownership: "owned" });
  }
  for (const asset of workspace?.licensedAssets || []) {
    const canAuthor = (asset.availableOperations || []).some((operation) => operation.code === "namespace.author");
    if (!canAuthor || asset.sourceRef?.resourceType !== "namespace") continue;
    choices.push({ id: asset.sourceRef.resourceId, name: asset.title, ownership: "licensed" });
  }
  const seen = new Set();
  return choices.filter((choice) => {
    const key = id(choice.id);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function projectedRevisionToWrite(revision) {
  return {
    label: revision.label,
    relatedSubjectIds: (revision.relatedSubjects || []).filter((entry) => !entry.missing).map((entry) => entry.id),
    tags: revision.tags || [],
    authorCredits: revision.authorCredits || [],
    metadata: { license: revision.license || null },
    illustrativeMedia: (revision.illustrativeMedia || []).map((entry) => ({ _id: entry.id, url: entry.url, altText: entry.altText || null })),
    selectionSignals: (revision.selectionSignals || []).map((entry) => ({ definitionId: entry.definitionId, weight: entry.weight })),
    presentationVariants: (revision.presentationVariants || []).map((variant) => ({
      _id: variant.id,
      key: variant.key,
      label: variant.label,
      description: variant.description || null,
      semanticFocus: (variant.semanticFocus || []).filter((entry) => !entry.subject?.missing).map((entry) => ({ subjectId: entry.subject.id, weight: entry.weight })),
      presentationAspects: (variant.presentationAspects || []).map((entry) => ({ definitionId: entry.definitionId, weight: entry.weight })),
      knowledgeRequirements: (variant.knowledgeRequirements || []).filter((entry) => !entry.subject?.missing).map((entry) => ({
        subjectId: entry.subject.id,
        minLevel: entry.minLevel,
        maxLevel: entry.maxLevel,
        weight: entry.weight,
      })),
      representations: (variant.representations || []).map((entry) => ({
        _id: entry.id,
        durationTypeDefinitionId: entry.duration.definitionId,
        languageLevelDefinitionId: entry.languageComplexity.definitionId,
        locale: entry.locale,
        text: entry.text,
      })),
    })),
    defaultPresentation: revision.defaultPresentation || null,
  };
}

export class ItemAuthoringView extends HTMLElement {
  workspace = null;
  principal = null;
  subjects = [];
  selectedSubject = null;
  itemId = params().get("itemId") || null;
  venueTargetId = params().get("venueTargetId") || null;
  venueTargetContext = null;
  projection = null;
  namespaceControls = null;
  busy = false;
  error = null;
  notice = null;

  connectedCallback() {
    this.addEventListener("submit", this.onSubmit);
    this.addEventListener("click", this.onClick);
    this.addEventListener("change", this.onChange);
    this.bootstrap();
  }

  disconnectedCallback() {
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("change", this.onChange);
  }

  async bootstrap() {
    this.busy = true;
    this.render();
    try {
      this.workspace = await marketplaceRepository.workspace();
      this.principal = this.workspace.principal;
      if (this.venueTargetId) {
        this.venueTargetContext = await authoringRepository.venueTargetContext(this.venueTargetId);
        this.selectedSubject = this.venueTargetContext.subject;
      }
      if (this.itemId) await this.reloadProjection();
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Impossibile inizializzare l'editor";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  async reloadWorkspace() {
    this.workspace = await marketplaceRepository.workspace({ principalType: this.principal.type, principalId: this.principal.id });
    this.principal = this.workspace.principal;
  }

  async reloadProjection(editionId = null) {
    if (!this.itemId) return;
    this.projection = await authoringRepository.projection(this.itemId, { editionId });
    this.selectedSubject = this.projection.subject;
  }

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    this.busy = true;
    this.error = null;
    this.notice = null;
    this.render();
    try {
      if (form.matches("[data-subject-search]")) {
        const externalScheme = String(data.get("externalScheme") || "").trim();
        const externalId = String(data.get("externalId") || "").trim();
        this.subjects = await authoringRepository.searchSubjects({
          search: String(data.get("search") || "").trim(),
          externalScheme: externalScheme || null,
          externalId: externalId || null,
        });
      } else if (form.matches("[data-subject-create]")) {
        const scheme = String(data.get("scheme") || "").trim();
        const externalId = String(data.get("externalId") || "").trim();
        const externalRefs = scheme && externalId ? [{ scheme, id: externalId, matchType: "exact" }] : [];
        this.selectedSubject = await authoringRepository.createSubject({
          preferredLabel: String(data.get("preferredLabel") || "").trim(),
          description: String(data.get("description") || "").trim(),
          externalRefs,
        });
        this.subjects = [this.selectedSubject];
      } else if (form.matches("[data-create-item]")) {
        if (!this.selectedSubject) throw new Error("Seleziona prima un Subject");
        const item = await authoringRepository.createItem({
          primarySubjectId: this.selectedSubject.id || this.selectedSubject._id,
          ownerType: this.principal.type,
          ownerId: this.principal.id,
        });
        this.itemId = item._id || item.id;
        const url = new URL(window.location.href);
        url.searchParams.set("itemId", this.itemId);
        window.history.replaceState({}, "", url);
        await this.reloadProjection();
        this.notice = "Lineage Item creata. Ora scegli un Namespace.";
      } else if (form.matches("[data-load-namespace]")) {
        this.namespaceControls = await authoringRepository.namespaceControls(String(data.get("namespaceId") || ""), this.principal);
      } else if (form.matches("[data-create-edition]")) {
        const namespaceId = String(data.get("namespaceId") || "");
        const controls = this.namespaceControls;
        if (!controls || id(controls.namespace.id) !== namespaceId) throw new Error("Carica prima i controlli del Namespace selezionato");
        const created = await authoringRepository.createEdition(this.itemId, {
          namespaceId,
          authoredAgainstNamespaceRevisionId: controls.revision.id,
          revision: {
            label: String(data.get("label") || "").trim(),
            authorCredits: [String(data.get("author") || "").trim()].filter(Boolean),
            metadata: { license: String(data.get("license") || "").trim() },
            relatedSubjectIds: [],
            tags: [],
            illustrativeMedia: [],
            selectionSignals: [],
            presentationVariants: [{
              key: "standard",
              label: "Standard",
              semanticFocus: [],
              presentationAspects: [],
              knowledgeRequirements: [],
              representations: [{
                durationTypeDefinitionId: String(data.get("durationTypeDefinitionId") || ""),
                languageLevelDefinitionId: String(data.get("languageLevelDefinitionId") || ""),
                locale: String(data.get("locale") || "it-IT").trim(),
                text: String(data.get("text") || "").trim(),
              }],
            }],
            defaultPresentation: null,
          },
        });
        const variant = created.revision?.presentationVariants?.[0];
        const representation = variant?.representations?.[0];
        if (variant?._id && representation?._id) {
          await authoringRepository.updateEdition(created.edition._id, {
            defaultPresentation: { variantId: variant._id, representationId: representation._id },
          });
        }
        await this.reloadProjection(created.edition._id);
        await this.reloadWorkspace();
        this.notice = "Edition e prima Representation create.";
      } else if (form.matches("[data-edit-revision]")) {
        const revision = this.projection?.selected?.revision;
        const editionId = this.projection?.selected?.edition?.id;
        if (!revision || !editionId) throw new Error("Nessuna revisione modificabile");
        const payload = projectedRevisionToWrite(revision);
        payload.label = String(data.get("label") || "").trim();
        payload.authorCredits = [String(data.get("author") || "").trim()].filter(Boolean);
        payload.metadata = { license: String(data.get("license") || "").trim() };
        const first = payload.presentationVariants?.[0]?.representations?.[0];
        if (first) {
          first.durationTypeDefinitionId = String(data.get("durationTypeDefinitionId") || first.durationTypeDefinitionId);
          first.languageLevelDefinitionId = String(data.get("languageLevelDefinitionId") || first.languageLevelDefinitionId);
          first.locale = String(data.get("locale") || first.locale).trim();
          first.text = String(data.get("text") || first.text).trim();
        }
        await authoringRepository.updateEdition(editionId, payload);
        await this.reloadProjection(editionId);
        this.notice = "Revisione aggiornata.";
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Operazione non riuscita";
    } finally {
      this.busy = false;
      this.render();
    }
  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const subjectButton = target?.closest("button[data-subject-id]");
    if (subjectButton) {
      this.selectedSubject = this.subjects.find((subject) => id(subject.id || subject._id) === subjectButton.dataset.subjectId) || null;
      this.render();
      return;
    }
    const editionButton = target?.closest("button[data-edition-id]");
    if (editionButton) {
      this.busy = true;
      this.render();
      try { await this.reloadProjection(editionButton.dataset.editionId); }
      catch (error) { this.error = error instanceof Error ? error.message : "Impossibile aprire la Edition"; }
      finally { this.busy = false; this.render(); }
      return;
    }
    const consistency = target?.closest("button[data-check-edition]");
    if (consistency) {
      this.busy = true; this.error = null; this.render();
      try {
        const result = await authoringRepository.checkEdition(consistency.dataset.checkEdition);
        await this.reloadProjection(consistency.dataset.checkEdition);
        this.notice = result.issues?.length ? `Controllo completato: ${result.issues.length} problema/i.` : "Controllo completato: nessun problema.";
      } catch (error) { this.error = error instanceof Error ? error.message : "Controllo non riuscito"; }
      finally { this.busy = false; this.render(); }
      return;
    }
    const publish = target?.closest("button[data-publish-edition]");
    if (publish) {
      this.busy = true; this.error = null; this.render();
      try {
        await authoringRepository.publishEdition(publish.dataset.publishEdition);
        await this.reloadProjection(publish.dataset.publishEdition);
        this.notice = "Contenuto pubblicato.";
      } catch (error) { this.error = error instanceof Error ? error.message : "Pubblicazione non riuscita"; }
      finally { this.busy = false; this.render(); }
    }
  };

  onChange = async (event) => {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    if (!input?.matches("input[data-content-space-id]")) return;
    this.busy = true; this.error = null;
    try {
      await authoringRepository.setContentSpaceMembership({
        contentSpaceId: input.dataset.contentSpaceId,
        itemId: this.itemId,
        member: input.checked,
      });
      await this.reloadProjection(this.projection?.selected?.edition?.id || null);
    } catch (error) {
      input.checked = !input.checked;
      this.error = error instanceof Error ? error.message : "Membership non aggiornata";
    } finally {
      this.busy = false;
      this.render();
    }
  };

  async changePrincipal(type, principalId) {
    this.principal = { type, id: principalId };
    await this.reloadWorkspace();
    this.namespaceControls = null;
    this.render();
  }

  renderSubjectStep() {
    const venueContext = this.venueTargetContext ? `
      <aside class="context-box">
        <strong>Oggetto fisico selezionato: ${escapeHtml(this.venueTargetContext.venueTarget.label)}</strong>
        <p>${escapeHtml(this.venueTargetContext.venue.name)}. Il wizard precompila il Subject ma non collega l'Item al VenueTarget.</p>
        ${(this.venueTargetContext.recognitionMedia || []).length ? `<p>${this.venueTargetContext.recognitionMedia.length} immagine/i di riconoscimento restano nel VenueRelease fisico.</p>` : ""}
      </aside>` : "";
    const results = this.subjects.map((subject) => `
      <li><button type="button" data-subject-id="${escapeHtml(id(subject.id || subject._id))}">${escapeHtml(subject.preferredLabel)}</button>
      <span>${escapeHtml(subject.description || "")}</span></li>`).join("");
    return `
      <section>
        <h2>1. Subject</h2>
        ${venueContext}
        ${this.selectedSubject ? `<p><strong>Selezionato:</strong> ${escapeHtml(this.selectedSubject.preferredLabel)}</p>` : ""}
        <form data-subject-search>
          <label>Cerca Subject <input name="search" placeholder="Nome, movimento, persona, opera…"></label>
          <div class="two-columns"><label>Schema external ID <input name="externalScheme" placeholder="wikidata"></label><label>ID esatto <input name="externalId" placeholder="Q…"></label></div>
          <button ${this.busy ? "disabled" : ""}>Cerca</button>
        </form>
        ${results ? `<ul class="subject-results">${results}</ul>` : ""}
        <details><summary>Crea nuovo Subject</summary>
          <form data-subject-create>
            <label>Nome <input name="preferredLabel" required></label>
            <label>Descrizione <textarea name="description"></textarea></label>
            <div class="two-columns"><label>Schema external ID <input name="scheme" placeholder="wikidata"></label><label>ID esatto <input name="externalId" placeholder="Q…"></label></div>
            <button ${this.busy ? "disabled" : ""}>Crea Subject</button>
          </form>
        </details>
        ${!this.itemId && this.selectedSubject ? `<form data-create-item><button ${this.busy ? "disabled" : ""}>Crea Item per ${escapeHtml(this.selectedSubject.preferredLabel)}</button></form>` : ""}
      </section>`;
  }

  renderNamespaceStep() {
    if (!this.itemId || !this.projection) return "";
    const choices = namespaceChoices(this.workspace);
    const options = choices.map((choice) => `<option value="${escapeHtml(id(choice.id))}">${escapeHtml(choice.name)}${choice.ownership === "licensed" ? " · licenza" : ""}</option>`).join("");
    const controls = this.namespaceControls?.controls;
    const durationOptions = (controls?.durationTypes || []).map((entry) => `<option value="${escapeHtml(entry.definitionId)}">${escapeHtml(entry.label)} · ${entry.targetSeconds}s</option>`).join("");
    const languageOptions = (controls?.languageLevels || []).map((entry) => `<option value="${escapeHtml(entry.definitionId)}">${escapeHtml(entry.label)}</option>`).join("");
    return `
      <section>
        <h2>2. Edition / Namespace</h2>
        <p>Più Edition possono rappresentare lo stesso Item in Namespace differenti.</p>
        <form data-load-namespace>
          <label>Namespace autorizzato <select name="namespaceId" required>${options || "<option value=''>Nessun Namespace disponibile</option>"}</select></label>
          <button ${!options || this.busy ? "disabled" : ""}>Carica controlli editoriali</button>
        </form>
        ${controls ? `<form data-create-edition>
          <input type="hidden" name="namespaceId" value="${escapeHtml(id(this.namespaceControls.namespace.id))}">
          <label>Etichetta contenuto <input name="label" required></label>
          <div class="two-columns"><label>Autore <input name="author" required></label><label>Licenza <input name="license" required placeholder="CC BY 4.0"></label></div>
          <div class="two-columns"><label>Durata <select name="durationTypeDefinitionId" required>${durationOptions}</select></label><label>Complessità linguistica <select name="languageLevelDefinitionId" required>${languageOptions}</select></label></div>
          <label>Locale <input name="locale" value="it-IT" required></label>
          <label>Testo <textarea name="text" rows="8" required></textarea></label>
          <button ${this.busy ? "disabled" : ""}>Crea Edition e Representation</button>
        </form>` : ""}
      </section>`;
  }

  renderRevisionEditor() {
    const selected = this.projection?.selected;
    const revision = selected?.revision;
    if (!revision) return "";
    const first = revision.presentationVariants?.[0]?.representations?.[0] || null;
    const controls = selected.namespace?.revision;
    const durationOptions = (controls?.durationTypes || []).map((entry) => `<option value="${escapeHtml(entry.definitionId)}" ${first?.duration?.definitionId === entry.definitionId ? "selected" : ""}>${escapeHtml(entry.label)} · ${entry.targetSeconds}s</option>`).join("");
    const languageOptions = (controls?.languageLevels || []).map((entry) => `<option value="${escapeHtml(entry.definitionId)}" ${first?.languageComplexity?.definitionId === entry.definitionId ? "selected" : ""}>${escapeHtml(entry.label)}</option>`).join("");
    const issues = (revision.integrity?.issues || []).map((issue) => `<li>${escapeHtml(issue.message || issue.code)}</li>`).join("");
    return `
      <section>
        <h2>3. Revision / Representation</h2>
        <p>Namespace: <strong>${escapeHtml(selected.namespace.name)}</strong> · stato ${escapeHtml(revision.status)}</p>
        <form data-edit-revision>
          <label>Etichetta <input name="label" value="${escapeHtml(revision.label)}" required></label>
          <div class="two-columns"><label>Autore <input name="author" value="${escapeHtml(revision.authorCredits?.[0] || "")}" required></label><label>Licenza <input name="license" value="${escapeHtml(revision.license || "")}" required></label></div>
          ${first ? `<div class="two-columns"><label>Durata <select name="durationTypeDefinitionId">${durationOptions}</select></label><label>Complessità <select name="languageLevelDefinitionId">${languageOptions}</select></label></div>
          <label>Locale <input name="locale" value="${escapeHtml(first.locale)}"></label>
          <label>Testo <textarea name="text" rows="10">${escapeHtml(first.text)}</textarea></label>` : "<p>Nessuna Representation presente.</p>"}
          <button ${this.busy ? "disabled" : ""}>Salva revisione</button>
        </form>
        <div class="actions">
          <button type="button" data-check-edition="${escapeHtml(id(selected.edition.id))}" ${this.busy ? "disabled" : ""}>Controlla consistenza</button>
          ${this.projection.availableOperations?.includes("item.publish") ? `<button type="button" data-publish-edition="${escapeHtml(id(selected.edition.id))}" ${revision.integrity?.status !== "valid" || this.busy ? "disabled" : ""}>Pubblica</button>` : ""}
        </div>
        ${issues ? `<ul class="issues">${issues}</ul>` : ""}
      </section>`;
  }

  renderMemberships() {
    if (!this.itemId || !this.projection) return "";
    const rows = (this.projection.workspaceMemberships || []).map((entry) => `<label class="membership"><input type="checkbox" data-content-space-id="${escapeHtml(id(entry.contentSpaceId))}" ${entry.member ? "checked" : ""}> ${escapeHtml(entry.name)}</label>`).join("");
    return `<section><h2>4. ContentSpace</h2><p>La membership organizza il workspace e non trasferisce ownership dell'Item.</p>${rows || "<p>Nessun ContentSpace disponibile per questo principal.</p>"}</section>`;
  }

  renderEditions() {
    if (!this.projection?.editions?.length) return "";
    const buttons = this.projection.editions.map((edition) => `<button type="button" data-edition-id="${escapeHtml(id(edition.id))}">${escapeHtml(edition.namespace?.name || "Edition")}</button>`).join(" ");
    return `<nav class="edition-tabs" aria-label="Edition dell'Item">${buttons}</nav>`;
  }

  render() {
    const principalOptions = (this.workspace?.availablePrincipals || []).map((entry) => `<option value="${escapeHtml(`${entry.type}:${id(entry.id)}`)}" ${this.principal && entry.type === this.principal.type && id(entry.id) === id(this.principal.id) ? "selected" : ""}>${escapeHtml(entry.name)} · ${escapeHtml(entry.type)}</option>`).join("");
    this.innerHTML = `
      <style>
        :host { display:block; }
        main { max-width: 64rem; margin: 0 auto; padding: 2rem 1rem 4rem; }
        section { border-top: 1px solid currentColor; padding: 1.5rem 0; }
        form { display:grid; gap:.8rem; max-width:48rem; margin-block:1rem; }
        label { display:grid; gap:.3rem; }
        input, select, textarea, button { font:inherit; padding:.6rem .7rem; }
        textarea { resize:vertical; }
        .two-columns { display:grid; grid-template-columns:1fr 1fr; gap:1rem; }
        .subject-results { list-style:none; padding:0; display:grid; gap:.5rem; }
        .subject-results li { display:flex; gap:1rem; align-items:center; }
        .context-box { padding:1rem; border:1px solid currentColor; }
        .actions, .edition-tabs { display:flex; gap:.7rem; flex-wrap:wrap; margin-block:1rem; }
        .membership { grid-template-columns:auto 1fr; justify-content:start; align-items:center; }
        .issues { border-left:3px solid currentColor; padding-left:1.5rem; }
        @media (max-width: 42rem) { .two-columns { grid-template-columns:1fr; } }
      </style>
      <main>
        <p><a data-route href="/workspace">← Workspace</a></p>
        <h1>Editor contenuto</h1>
        <p>Flusso: Subject → Item → Edition → Revision. La Venue è solo un possibile contesto di partenza.</p>
        ${principalOptions ? `<label>Principal proprietario<select data-principal>${principalOptions}</select></label>` : ""}
        ${this.busy ? "<p>Elaborazione…</p>" : ""}
        ${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}
        ${this.notice ? `<p role="status">${escapeHtml(this.notice)}</p>` : ""}
        ${this.renderSubjectStep()}
        ${this.renderEditions()}
        ${this.renderNamespaceStep()}
        ${this.renderRevisionEditor()}
        ${this.renderMemberships()}
      </main>`;

    const principalSelect = this.querySelector("select[data-principal]");
    if (principalSelect) {
      principalSelect.addEventListener("change", async (event) => {
        const [type, principalId] = String(event.target.value || "").split(":");
        if (!type || !principalId) return;
        this.busy = true; this.render();
        try { await this.changePrincipal(type, principalId); }
        catch (error) { this.error = error instanceof Error ? error.message : "Principal non disponibile"; }
        finally { this.busy = false; this.render(); }
      }, { once: true });
    }
  }
}

customElements.define("artaround-item-authoring-view", ItemAuthoringView);
