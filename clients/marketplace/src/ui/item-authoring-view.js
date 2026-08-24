import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { authoringRepository } from "../infrastructure/http/authoring-repository.js";
import { icon } from "./icons.js";
import "./semantic-entity-picker.js";

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
    // Preserve unresolved references. Integrity checks, not client-side data loss,
    // decide whether the revision may be published.
    relatedSubjectIds: (revision.relatedSubjects || []).map((entry) => entry.id).filter(Boolean),
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
      semanticFocus: (variant.semanticFocus || []).map((entry) => ({ subjectId: entry.subject?.id, weight: entry.weight })).filter((entry) => entry.subjectId),
      presentationAspects: (variant.presentationAspects || []).map((entry) => ({ definitionId: entry.definitionId, weight: entry.weight })),
      knowledgeRequirements: (variant.knowledgeRequirements || []).map((entry) => ({
        subjectId: entry.subject?.id,
        minLevel: entry.minLevel,
        maxLevel: entry.maxLevel,
        weight: entry.weight,
      })).filter((entry) => entry.subjectId),
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

function workflowNotice(code) {
  const messages = {
    "workflow.check": "Controllo di consistenza completato.",
    "workflow.request_review": "Revisione inviata alla review manageriale.",
    "workflow.withdraw_review": "Revisione ritirata dalla review.",
    "workflow.request_changes": "Modifiche richieste.",
    "workflow.publish": "Contenuto pubblicato.",
  };
  return messages[code] || "Operazione editoriale completata.";
}

export class ItemAuthoringView extends HTMLElement {
  workspace = null;
  principal = null;
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
    this.addEventListener("subject-selected", this.onSubjectSelected);
    this.bootstrap();
  }

  disconnectedCallback() {
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("change", this.onChange);
    this.removeEventListener("subject-selected", this.onSubjectSelected);
  }

  availableOperation(code) {
    return (this.projection?.availableOperations || []).find((operation) => operation.code === code) || null;
  }

  workflowOperations() {
    return (this.projection?.availableOperations || []).filter((operation) => String(operation.code || "").startsWith("workflow."));
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
    const owner = this.projection.lineage?.owner;
    if (owner && (!this.principal || owner.type !== this.principal.type || id(owner.id) !== id(this.principal.id))) {
      this.principal = { type: owner.type, id: owner.id };
      await this.reloadWorkspace();
      this.namespaceControls = null;
    }
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
      if (form.matches("[data-create-item]")) {
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
        if (!this.availableOperation("item.edit")) throw new Error("La revisione non è modificabile nello stato corrente");
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

  onSubjectSelected = (event) => {
    if (this.itemId || !event.detail?.subject) return;
    this.selectedSubject = event.detail.subject;
    this.notice = event.detail.source === "reuse_existing"
      ? "Identità già nota: è stato selezionato il Subject ArtAround esistente."
      : "Subject selezionato. Puoi creare l’Item.";
    this.render();
  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const editionButton = target?.closest("button[data-edition-id]");
    if (editionButton) {
      this.busy = true;
      this.render();
      try { await this.reloadProjection(editionButton.dataset.editionId); }
      catch (error) { this.error = error instanceof Error ? error.message : "Impossibile aprire la Edition"; }
      finally { this.busy = false; this.render(); }
      return;
    }
    const workflowButton = target?.closest("button[data-workflow-operation]");
    if (workflowButton) {
      const operationCode = workflowButton.dataset.workflowOperation || "";
      const operation = this.availableOperation(operationCode);
      const editionId = workflowButton.dataset.editionId || id(this.projection?.selected?.edition?.id);
      if (!operation || !editionId) return;
      const payload = {};
      if (operation.requiresMessage) {
        const message = window.prompt("Motivazione delle modifiche richieste:");
        if (message === null) return;
        if (!message.trim()) {
          this.error = "La motivazione è obbligatoria.";
          this.render();
          return;
        }
        payload.message = message.trim();
      }
      this.busy = true;
      this.error = null;
      this.notice = null;
      this.render();
      try {
        const result = await marketplaceRepository.executeWorkspaceOperation({
          operationCode,
          sourceRef: { resourceType: "item_edition", resourceId: editionId },
          targetPrincipal: { type: this.principal.type, id: this.principal.id },
          payload,
        });
        await this.reloadProjection(editionId);
        if (operationCode === "workflow.check") {
          const issues = result?.result?.issues || [];
          this.notice = issues.length ? `Controllo completato: ${issues.length} problema/i.` : "Controllo completato: nessun problema.";
        } else {
          this.notice = workflowNotice(operationCode);
        }
      } catch (error) {
        this.error = error instanceof Error ? error.message : "Operazione editoriale non riuscita";
      } finally {
        this.busy = false;
        this.render();
      }
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
    if (this.itemId) return;
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
    const identities = (this.selectedSubject?.externalIdentities || []).map((identity) => `<span class="subject-identity">${escapeHtml(identity.scheme)} · ${escapeHtml(identity.id)}${identity.role === "historical" ? " · storico" : ""}</span>`).join("");
    return `
      <section>
        <header class="step-heading"><span class="step-number">1</span><div><span class="eyebrow">Identità universale</span><h2>Subject</h2></div></header>
        ${venueContext}
        ${this.selectedSubject ? `<article class="selected-subject"><span class="eyebrow">Subject selezionato</span><h3>${escapeHtml(this.selectedSubject.preferredLabel)}</h3><p>${escapeHtml(this.selectedSubject.description || "Senza descrizione")}</p><div>${identities || `<span class="subject-identity">Solo locale</span>`}</div></article>` : ""}
        ${!this.itemId ? `<artaround-semantic-entity-picker mode="subject" entity-kind="item"></artaround-semantic-entity-picker>` : ""}
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
        <header class="step-heading"><span class="step-number">2</span><div><span class="eyebrow">Vocabolario editoriale</span><h2>Edition e Namespace</h2></div></header>
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
    const canEdit = Boolean(this.availableOperation("item.edit"));
    const workflowButtons = this.workflowOperations().map((operation) => `
      <button type="button" data-workflow-operation="${escapeHtml(operation.code)}" data-edition-id="${escapeHtml(id(selected.edition.id))}" ${this.busy ? "disabled" : ""}>${escapeHtml(operation.label)}</button>`).join("");
    const editor = canEdit ? `<form data-edit-revision>
          <label>Etichetta <input name="label" value="${escapeHtml(revision.label)}" required></label>
          <div class="two-columns"><label>Autore <input name="author" value="${escapeHtml(revision.authorCredits?.[0] || "")}" required></label><label>Licenza <input name="license" value="${escapeHtml(revision.license || "")}" required></label></div>
          ${first ? `<div class="two-columns"><label>Durata <select name="durationTypeDefinitionId">${durationOptions}</select></label><label>Complessità <select name="languageLevelDefinitionId">${languageOptions}</select></label></div>
          <label>Locale <input name="locale" value="${escapeHtml(first.locale)}"></label>
          <label>Testo <textarea name="text" rows="10">${escapeHtml(first.text)}</textarea></label>` : "<p>Nessuna Representation presente.</p>"}
          <button ${this.busy ? "disabled" : ""}>Salva revisione</button>
        </form>` : `<p>La revisione non è modificabile nello stato <strong>${escapeHtml(revision.status)}</strong>. Usa le operazioni editoriali disponibili.</p>`;
    return `
      <section>
        <header class="step-heading"><span class="step-number">3</span><div><span class="eyebrow">Contenuto versionato</span><h2>Revision e Representation</h2></div></header>
        <p>Namespace: <strong>${escapeHtml(selected.namespace.name)}</strong> · stato ${escapeHtml(revision.status)} · integrità ${escapeHtml(revision.integrity?.status || "needs_review")}</p>
        ${editor}
        <div class="actions">${workflowButtons}</div>
        ${issues ? `<ul class="issues">${issues}</ul>` : ""}
      </section>`;
  }

  renderMemberships() {
    if (!this.itemId || !this.projection) return "";
    const rows = (this.projection.workspaceMemberships || []).map((entry) => `<label class="membership"><input type="checkbox" data-content-space-id="${escapeHtml(id(entry.contentSpaceId))}" ${entry.member ? "checked" : ""}> ${escapeHtml(entry.name)}</label>`).join("");
    return `<section><header class="step-heading"><span class="step-number">4</span><div><span class="eyebrow">Organizzazione</span><h2>ContentSpace</h2></div></header><p>La membership organizza il workspace e non trasferisce ownership dell'Item.</p><div class="membership-grid">${rows || "<p>Nessun ContentSpace disponibile per questo principal.</p>"}</div></section>`;
  }

  renderEditions() {
    if (!this.projection?.editions?.length) return "";
    const buttons = this.projection.editions.map((edition) => `<button type="button" data-edition-id="${escapeHtml(id(edition.id))}">${escapeHtml(edition.namespace?.name || "Edition")}</button>`).join(" ");
    return `<nav class="edition-tabs" aria-label="Edition dell'Item">${buttons}</nav>`;
  }

  renderProgress() {
    const stages = [
      ["Subject", Boolean(this.selectedSubject || this.itemId)],
      ["Item", Boolean(this.itemId)],
      ["Edition", Boolean(this.projection?.selected?.edition)],
      ["Revision", Boolean(this.projection?.selected?.revision)],
    ];
    return `<ol class="editor-progress" aria-label="Avanzamento editor">${stages.map(([label, complete], index) => `<li data-complete="${complete}"><span>${complete ? icon("check", { size: 14 }) : index + 1}</span>${escapeHtml(label)}</li>`).join("")}</ol>`;
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
        .selected-subject { margin-block:1rem; padding:1rem; border:1px solid #bfd0c8; border-radius:.8rem; background:#f3f8f5; }
        .selected-subject h3 { margin:.2rem 0; }
        .subject-identity { display:inline-block; margin:.25rem .35rem 0 0; padding:.25rem .45rem; border-radius:999px; background:#dfece6; font:700 .72rem/1.2 ui-monospace,monospace; }
        .actions, .edition-tabs { display:flex; gap:.7rem; flex-wrap:wrap; margin-block:1rem; }
        .membership { grid-template-columns:auto 1fr; justify-content:start; align-items:center; }
        .issues { border-left:3px solid currentColor; padding-left:1.5rem; }
        @media (max-width: 42rem) { .two-columns { grid-template-columns:1fr; } }
      </style>
      <main class="page editor-page">
        <nav class="breadcrumb"><a data-route href="/workspace">${icon("arrowLeft", { size: 15 })} Workspace</a><span>/</span><span>Contenuto</span></nav>
        <header class="page-header"><div><span class="eyebrow">Item authoring</span><h1>Editor contenuto</h1><p>Costruisci una risorsa riusabile mantenendo separati Subject, Item, Namespace e versione editoriale.</p></div></header>
        ${this.renderProgress()}
        ${principalOptions ? `<label class="principal-control">Principal proprietario<select data-principal ${this.itemId ? "disabled" : ""}>${principalOptions}</select></label>` : ""}
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
    if (principalSelect && !this.itemId) {
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
