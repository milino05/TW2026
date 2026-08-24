import { navigate } from "../application/router.js";
import { accountRepository } from "../infrastructure/http/account-repository.js";
import { managementRepository } from "../infrastructure/http/management-repository.js";
import { icon } from "./icons.js";
import "./semantic-entity-picker.js";

const COLLECTIONS = [
  ["subjectClasses", "Classi di soggetto", "Categorie editoriali applicabili ai Subject"],
  ["relationTypes", "Tipi di relazione", "Relazioni ammesse nel grafo semantico"],
  ["durationTypes", "Durate", "Scale ordinate per durata della rappresentazione"],
  ["languageLevels", "Livelli linguistici", "Scale ordinate di complessità"],
  ["presentationAspects", "Aspetti di presentazione", "Dimensioni editoriali selezionabili"],
  ["selectionSignals", "Segnali di selezione", "Segnali usati per la scelta dei contenuti"],
];
function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function has(operations, code) { return (operations || []).some((entry) => entry.code === code); }
function namespaceId() { return new URLSearchParams(window.location.search).get("namespaceId"); }
function uuid() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function refsText(values = []) { return values.map((entry) => `${entry.scheme}|${entry.id}|${entry.matchType || "exact"}`).join("\n"); }
function parseRefs(value) { return String(value || "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => { const [scheme, id, matchType = "exact"] = line.split("|").map((part) => part.trim()); return { scheme, id, matchType }; }); }
function comma(value) { return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean); }
function semanticRefChips(values = [], editable = true) { return values.length ? values.map((entry, index) => `<span class="semantic-ref-chip"><span>${escapeHtml(entry.scheme)} · ${escapeHtml(entry.id)} · ${escapeHtml(entry.matchType || "exact")}</span>${editable ? `<button type="button" data-remove-semantic-ref="${index}" aria-label="Rimuovi mapping ${escapeHtml(entry.id)}">×</button>` : ""}</span>`).join("") : `<span class="muted">Nessun mapping esterno</span>`; }

export class ArtAroundNamespaceEditorView extends HTMLElement {
  data = null; busy = false; error = null; message = null; dirty = false; id = namespaceId();
  connectedCallback() { this.addEventListener("click", this.onClick); this.addEventListener("submit", this.onSubmit); this.addEventListener("input", this.onInput); this.addEventListener("semantic-ref-selected", this.onSemanticRefSelected); window.addEventListener("beforeunload", this.onBeforeUnload); this.load(); }
  disconnectedCallback() { this.removeEventListener("click", this.onClick); this.removeEventListener("submit", this.onSubmit); this.removeEventListener("input", this.onInput); this.removeEventListener("semantic-ref-selected", this.onSemanticRefSelected); window.removeEventListener("beforeunload", this.onBeforeUnload); }
  async load() { if (!this.id) { this.error = "Namespace non specificato"; this.render(); return; } this.busy = true; this.error = null; this.render(); try { this.data = await managementRepository.namespace(this.id); } catch (error) { this.error = error instanceof Error ? error.message : "Namespace non disponibile"; } finally { this.busy = false; this.render(); } }
  async execute(callback, message) { this.busy = true; this.error = null; this.message = null; this.render(); try { await callback(); this.dirty = false; this.message = message; this.data = await managementRepository.namespace(this.id); } catch (error) { this.error = error instanceof Error ? error.message : "Operazione non riuscita"; } finally { this.busy = false; this.render(); } }

  onInput = (event) => { if (event.target?.closest?.("artaround-semantic-entity-picker")) return; this.markDirty(); };
  markDirty() { this.dirty = true; const indicator = this.querySelector("[data-dirty-indicator]"); if (indicator) { indicator.dataset.tone = "warning"; indicator.innerHTML = `${icon("warning", { size: 14 })} Modifiche non salvate`; } }
  onBeforeUnload = (event) => { if (!this.dirty) return; event.preventDefault(); event.returnValue = ""; };

  collectDefinitions() {
    const output = {};
    for (const [field] of COLLECTIONS) {
      output[field] = [...this.querySelectorAll(`[data-collection="${field}"] [data-definition-row]`)].map((row) => {
        const value = (name) => row.querySelector(`[name="${name}"]`)?.value || "";
        const base = { definitionId: value("definitionId"), key: value("key"), label: value("label"), description: value("description"), semanticRefs: parseRefs(value("semanticRefs")) };
        if (field === "durationTypes") base.targetSeconds = Number(value("targetSeconds"));
        if (field === "relationTypes") Object.assign(base, {
          domainDefinitionIds: [...row.querySelectorAll('[name="domainDefinitionIds"] option:checked')].map((entry) => entry.value),
          rangeDefinitionIds: [...row.querySelectorAll('[name="rangeDefinitionIds"] option:checked')].map((entry) => entry.value),
          category: value("category") || "semantic", strength: value("strength") || "medium", directionality: value("directionality") || "directed",
          userIntents: comma(value("userIntents")), reverse: { label: value("reverseLabel"), description: value("reverseDescription"), userIntents: comma(value("reverseUserIntents")) },
          validationRules: { allowMultiple: Boolean(row.querySelector('[name="allowMultiple"]')?.checked), targetRequired: Boolean(row.querySelector('[name="targetRequired"]')?.checked) },
        });
        return base;
      });
    }
    return output;
  }

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const removeSemanticRef = target?.closest("button[data-remove-semantic-ref]");
    if (removeSemanticRef) {
      const row = removeSemanticRef.closest("[data-definition-row]");
      const input = row?.querySelector('[name="semanticRefs"]');
      if (input) {
        const refs = parseRefs(input.value);
        refs.splice(Number(removeSemanticRef.dataset.removeSemanticRef), 1);
        input.value = refsText(refs);
        row.querySelector("[data-semantic-ref-list]").innerHTML = semanticRefChips(refs, true);
        this.markDirty();
      }
      return;
    }
    if (target?.closest("button[data-back]")) { if (this.dirty && !window.confirm("Ci sono modifiche non salvate. Uscire comunque?")) return; const owner = this.data?.namespace.owner; navigate(owner?.type === "organization" ? `/organizations/detail?organizationId=${encodeURIComponent(owner.id)}` : "/profile"); return; }
    const add = target?.closest("button[data-add-definition]");
    if (add) { const definitions = this.collectDefinitions(); definitions[add.dataset.addDefinition].push({ definitionId: uuid(), key: "", label: "", description: "", semanticRefs: [] }); this.data.revision.definitions = definitions; this.dirty = true; this.render(); return; }
    const remove = target?.closest("button[data-remove-definition]");
    if (remove) { const definitions = this.collectDefinitions(); definitions[remove.dataset.collection].splice(Number(remove.dataset.removeDefinition), 1); this.data.revision.definitions = definitions; this.dirty = true; this.render(); return; }
    const operation = target?.closest("button[data-operation]");
    if (!operation) return;
    const code = operation.dataset.operation;
    if (this.dirty && !window.confirm("Le modifiche non salvate verranno perse. Continuare con il workflow?")) return;
    if (code === "namespace.working.ensure") { await this.execute(() => managementRepository.ensureNamespaceWorking(this.id), "Bozza di lavoro pronta."); return; }
    const action = { "namespace.revision.check": "check-consistency", "namespace.revision.request_review": "request-review", "namespace.revision.withdraw_review": "withdraw-review", "namespace.revision.request_changes": "request-changes", "namespace.revision.publish": "publish" }[code];
    if (!action) return;
    const payload = {};
    if (code === "namespace.revision.request_changes") { const message = window.prompt("Motivazione delle modifiche richieste:"); if (message === null) return; payload.message = message; }
    await this.execute(() => managementRepository.namespaceWorkflow(this.id, action, payload), "Workflow Namespace aggiornato.");
  };

  onSemanticRefSelected = (event) => {
    const picker = event.target instanceof Element ? event.target : null;
    const row = picker?.closest("[data-definition-row]");
    const input = row?.querySelector('[name="semanticRefs"]');
    const semanticRef = event.detail?.semanticRef;
    if (!row || !input || !semanticRef) return;
    const refs = parseRefs(input.value);
    const key = `${semanticRef.scheme}::${semanticRef.id}::${semanticRef.matchType}`;
    if (!refs.some((entry) => `${entry.scheme}::${entry.id}::${entry.matchType}` === key)) refs.push(semanticRef);
    input.value = refsText(refs);
    row.querySelector("[data-semantic-ref-list]").innerHTML = semanticRefChips(refs, true);
    this.markDirty();
  };

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null; if (!form) return;
    if (form.matches("[data-namespace-metadata]")) { event.preventDefault(); const data = new FormData(form); await this.execute(() => accountRepository.updateNamespace(this.id, { name: String(data.get("name") || ""), description: String(data.get("description") || "") }), "Dettagli Namespace aggiornati."); }
    if (form.matches("[data-definitions]")) { event.preventDefault(); const definitions = this.collectDefinitions(); await this.execute(() => managementRepository.updateNamespaceRevision(this.id, definitions), "Definizioni salvate."); }
  };

  renderSemanticRefs(entry, field, editable) { return `<div class="wide semantic-mappings"><strong>Mapping di vocabolario</strong><p class="muted">Exact, close, broader e narrower descrivono questa definizione; non creano un’identità globale del Subject.</p><div data-semantic-ref-list>${semanticRefChips(entry.semanticRefs || [], editable)}</div>${editable ? `<artaround-semantic-entity-picker mode="mapping" entity-kind="${field === "relationTypes" ? "property" : "item"}"></artaround-semantic-entity-picker><details><summary>Inserimento avanzato provider-neutral</summary><label>Una riga schema|ID|relazione<textarea name="semanticRefs" rows="3" placeholder="schema|identificativo|exact">${escapeHtml(refsText(entry.semanticRefs))}</textarea></label></details>` : `<textarea name="semanticRefs" hidden>${escapeHtml(refsText(entry.semanticRefs))}</textarea>`}</div>`; }
  renderRelationFields(entry, subjectClasses) {
    const options = (selected = []) => subjectClasses.map((subject) => `<option value="${escapeHtml(subject.definitionId)}" ${selected.includes(subject.definitionId) ? "selected" : ""}>${escapeHtml(subject.label || subject.key)}</option>`).join("");
    return `<label>Dominio<select name="domainDefinitionIds" multiple>${options(entry.domainDefinitionIds)}</select></label><label>Range<select name="rangeDefinitionIds" multiple>${options(entry.rangeDefinitionIds)}</select></label><label>Categoria<select name="category"><option ${entry.category === "semantic" ? "selected" : ""}>semantic</option><option ${entry.category === "contextual" ? "selected" : ""}>contextual</option><option ${entry.category === "editorial" ? "selected" : ""}>editorial</option></select></label><label>Forza<select name="strength"><option ${entry.strength === "strong" ? "selected" : ""}>strong</option><option ${(!entry.strength || entry.strength === "medium") ? "selected" : ""}>medium</option><option ${entry.strength === "weak" ? "selected" : ""}>weak</option></select></label><label>Direzione<select name="directionality"><option ${(!entry.directionality || entry.directionality === "directed") ? "selected" : ""}>directed</option><option ${entry.directionality === "symmetric" ? "selected" : ""}>symmetric</option></select></label><label>Intenti utente<input name="userIntents" value="${escapeHtml((entry.userIntents || []).join(", "))}"></label><label>Etichetta inversa<input name="reverseLabel" value="${escapeHtml(entry.reverse?.label || "")}"></label><label>Descrizione inversa<input name="reverseDescription" value="${escapeHtml(entry.reverse?.description || "")}"></label><label>Intenti inversi<input name="reverseUserIntents" value="${escapeHtml((entry.reverse?.userIntents || []).join(", "))}"></label><label class="check"><input type="checkbox" name="allowMultiple" ${entry.validationRules?.allowMultiple !== false ? "checked" : ""}> Multipla</label><label class="check"><input type="checkbox" name="targetRequired" ${entry.validationRules?.targetRequired !== false ? "checked" : ""}> Target obbligatorio</label>`;
  }
  renderCollection(field, title, description, definitions, editable) {
    const subjectClasses = definitions.subjectClasses || [];
    const rows = (definitions[field] || []).map((entry, index) => `<article class="definition" data-definition-row><input type="hidden" name="definitionId" value="${escapeHtml(entry.definitionId || uuid())}"><div class="definition-heading"><strong>${escapeHtml(entry.label || `Nuova definizione ${index + 1}`)}</strong>${editable ? `<button class="danger small" type="button" data-collection="${field}" data-remove-definition="${index}">Rimuovi</button>` : ""}</div><div class="fields"><label>Chiave<input name="key" value="${escapeHtml(entry.key || "")}" required></label><label>Etichetta<input name="label" value="${escapeHtml(entry.label || "")}" required></label><label class="wide">Descrizione<input name="description" value="${escapeHtml(entry.description || "")}"></label>${field === "durationTypes" ? `<label>Secondi target<input name="targetSeconds" type="number" min="1" value="${Number(entry.targetSeconds) || 60}" required></label>` : ""}${field === "relationTypes" ? this.renderRelationFields(entry, subjectClasses) : ""}${this.renderSemanticRefs(entry, field, editable)}</div></article>`).join("");
    return `<section class="collection" id="namespace-${field}" data-collection="${field}"><header><div><span class="eyebrow">${escapeHtml(description)}</span><h2>${escapeHtml(title)}</h2></div><span class="count">${(definitions[field] || []).length}</span></header>${rows || `<div class="empty-state compact">${icon("book", { size: 22 })}<div><h3>Nessuna definizione</h3><p>Aggiungi la prima voce di questo vocabolario.</p></div></div>`}${editable ? `<button class="add" type="button" data-add-definition="${field}">${icon("plus", { size: 16 })} Aggiungi definizione</button>` : ""}</section>`;
  }

  render() {
    if (!this.data) { this.innerHTML = `<main><p role="${this.error ? "alert" : "status"}">${escapeHtml(this.error || "Caricamento Namespace…")}</p></main>`; return; }
    const { namespace, revision, availableOperations } = this.data;
    const editable = has(availableOperations, "namespace.revision.update");
    const issues = (revision?.integrity.issues || []).map((issue) => `<li><strong>${escapeHtml(issue.field || issue.code)}</strong> — ${escapeHtml(issue.message)}</li>`).join("");
    const workflowButtons = availableOperations.filter((entry) => entry.code.startsWith("namespace.revision.") && entry.code !== "namespace.revision.update").map((entry) => `<button type="button" data-operation="${entry.code}">${escapeHtml(entry.label)}</button>`).join("");
    const collections = revision ? COLLECTIONS.map(([field, title, description]) => this.renderCollection(field, title, description, revision.definitions, editable)).join("") : "";
    const sectionNavigation = revision ? COLLECTIONS.map(([field, title]) => `<a href="#namespace-${field}">${escapeHtml(title)}<span>${(revision.definitions[field] || []).length}</span></a>`).join("") : "";
    this.innerHTML = `<style>:host{display:block;background:#f4f2ec;color:#173b32;min-height:calc(100vh - 4rem)}*{box-sizing:border-box}main{max-width:78rem;margin:auto;padding:2rem 1rem 5rem}.back{background:transparent;color:#23483e;padding-left:0}.hero{padding:1.6rem;border-radius:1.2rem;background:#1e463b;color:white}.hero h1{margin:.25rem 0}.eyebrow{display:block;font-size:.7rem;text-transform:uppercase;letter-spacing:.09em;font-weight:800;color:#658077}.hero .eyebrow{color:#b9d7cc}.status{display:flex;gap:.5rem;flex-wrap:wrap;margin:1rem 0}.chip{padding:.4rem .65rem;border-radius:999px;background:#e0e9e4;font-weight:750}.feedback,.issues{padding:.9rem;border-radius:.7rem;background:white;border:1px solid #d2d7d3}.toolbar{display:flex;gap:.5rem;flex-wrap:wrap;margin:1rem 0}.metadata,.collection{margin-top:1rem;padding:1.2rem;border:1px solid #d5d8d1;border-radius:1rem;background:white}.collection header{display:flex;justify-content:space-between;align-items:end}.collection h2{margin:.2rem 0}.definition{padding:1rem;margin-top:.8rem;border-radius:.8rem;background:#f4f6f2}.definition-heading{display:flex;justify-content:space-between;gap:1rem}.fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.7rem;margin-top:.7rem}.wide{grid-column:1/-1}form,label{display:grid;gap:.35rem}.definitions-fieldset{border:0;padding:0;margin:0;min-width:0}.definitions-fieldset:disabled{opacity:.75}label{font-size:.82rem;font-weight:700}.check{display:flex;align-items:center}input,textarea,select,button{font:inherit}input,textarea,select{width:100%;padding:.6rem;border:1px solid #afbbb6;border-radius:.5rem;background:white}select[multiple]{min-height:6rem}button{width:max-content;padding:.58rem .75rem;border:0;border-radius:.55rem;background:#173e35;color:white;font-weight:780;cursor:pointer}.small{padding:.35rem .5rem}.danger{background:#f5e3df;color:#8b3024}.add{margin-top:.8rem;background:#e2ece7;color:#1c4c3f}.save{position:sticky;bottom:1rem;margin-top:1rem;box-shadow:0 .7rem 2rem #173e3540}.empty{padding:1rem;background:#f6f6f2;border-radius:.7rem}@media(max-width:48rem){.fields{grid-template-columns:1fr}.wide{grid-column:auto}}</style><main class="namespace-editor-page" aria-busy="${this.busy}"><nav class="breadcrumb" aria-label="Percorso"><button type="button" data-back>${icon("arrowLeft", { size: 16 })} Indietro</button><span>/</span><span>Namespace editor</span></nav><section class="hero editor-hero"><div><span class="eyebrow">Namespace ${escapeHtml(namespace.owner.type)}</span><h1>${escapeHtml(namespace.name)}</h1><p>${escapeHtml(namespace.description || "Nessuna descrizione")}</p></div><div class="editor-hero__mark">${icon("book", { size: 28 })}</div></section>${this.busy ? `<p class="feedback" role="status">Aggiornamento…</p>` : ""}${this.message ? `<p class="feedback" role="status">${icon("check", { size: 17 })} ${escapeHtml(this.message)}</p>` : ""}${this.error ? `<p class="feedback" role="alert">${icon("warning", { size: 17 })} ${escapeHtml(this.error)}</p>` : ""}<section class="status editor-status"><span class="chip">${escapeHtml(namespace.source)}</span>${revision ? `<span class="chip">Versione ${revision.version}</span><span class="chip">${escapeHtml(revision.status)}</span><span class="chip" data-tone="${revision.integrity.status === "valid" ? "success" : "warning"}">${icon(revision.integrity.status === "valid" ? "check" : "warning", { size: 14 })} Integrità: ${escapeHtml(revision.integrity.status)}</span>` : ""}<span class="chip" data-dirty-indicator data-tone="${this.dirty ? "warning" : "success"}">${icon(this.dirty ? "warning" : "check", { size: 14 })} ${this.dirty ? "Modifiche non salvate" : "Tutto salvato"}</span></section><div class="editor-layout"><aside class="editor-sidebar"><nav aria-label="Sezioni Namespace"><a href="#namespace-details">Dettagli</a>${sectionNavigation}</nav></aside><div class="editor-content"><details class="metadata" id="namespace-details"><summary>Dettagli Namespace</summary><form data-namespace-metadata><label>Nome<input name="name" value="${escapeHtml(namespace.name)}" required></label><label>Descrizione<textarea name="description">${escapeHtml(namespace.description)}</textarea></label><button>${icon("check", { size: 16 })} Salva dettagli</button></form></details>${has(availableOperations, "namespace.working.ensure") ? `<div class="toolbar"><button type="button" data-operation="namespace.working.ensure">${escapeHtml(availableOperations.find((entry) => entry.code === "namespace.working.ensure").label)}</button></div>` : ""}${revision ? `${workflowButtons ? `<div class="toolbar workflow-toolbar">${workflowButtons}</div>` : ""}${issues ? `<section class="issues"><h2>${icon("warning", { size: 20 })} Problemi di integrità</h2><ul>${issues}</ul></section>` : ""}<form data-definitions><fieldset class="definitions-fieldset" ${editable ? "" : "disabled"}>${collections}</fieldset>${editable ? `<button class="save">${icon("check", { size: 17 })} Salva tutte le definizioni</button>` : ""}</form>` : `<div class="empty-state">${icon("book", { size: 26 })}<h3>Nessuna revisione disponibile</h3></div>`}</div></div></main>`;
  }
}

customElements.define("artaround-namespace-editor-view", ArtAroundNamespaceEditorView);
