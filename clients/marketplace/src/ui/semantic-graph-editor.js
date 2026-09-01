import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
import { openActionDialog } from "./feedback-primitives.js";
import { icon } from "./icons.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function id(value) { return String(value?._id || value?.id || value || ""); }

export class ArtAroundSemanticGraphEditor extends HTMLElement {
  editorialContextId = null;
  relationTypes = [];
  subjectClasses = [];
  editable = false;
  locked = false;
  data = null;
  selectedSubjectId = null;
  busy = false;
  error = null;

  connectedCallback() {
    this.addEventListener("click", this.onClick);
    this.addEventListener("submit", this.onSubmit);
    this.load();
  }
  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("submit", this.onSubmit);
  }

  configure({ editorialContextId, relationTypes = [], subjectClasses = [], editable = false, locked = false } = {}) {
    this.editorialContextId = editorialContextId || null;
    this.relationTypes = relationTypes || [];
    this.subjectClasses = subjectClasses || [];
    this.editable = editable === true;
    this.locked = locked === true;
    if (this.isConnected) this.load();
  }

  async load() {
    if (!this.editorialContextId) { this.render(); return; }
    this.busy = true; this.error = null; this.render();
    try { this.data = await editorialRepository.graph(this.editorialContextId, { view: "working" }); }
    catch (error) { this.error = error instanceof Error ? error.message : "Non è possibile caricare il grafo semantico"; }
    finally { this.busy = false; this.render(); }
  }

  graphSubjects() {
    const byId = new Map();
    for (const subject of this.data?.availableSubjects || []) {
      byId.set(id(subject), { subject, subjectClassDefinitionIds: [] });
    }
    for (const entry of this.data?.subjects || []) {
      const key = id(entry.subject);
      byId.set(key, { subject: entry.subject, subjectClassDefinitionIds: entry.subjectClassDefinitionIds || [] });
    }
    return [...byId.values()].sort((a, b) => String(a.subject?.preferredLabel || "").localeCompare(String(b.subject?.preferredLabel || ""), "it"));
  }

  relationById(definitionId) {
    return (this.relationTypes || []).find((entry) => String(entry.definitionId) === String(definitionId)) || null;
  }

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const node = target?.closest("[data-graph-subject]");
    if (node) { this.selectedSubjectId = node.dataset.graphSubject; this.render(); return; }
    const remove = target?.closest("button[data-remove-edge]");
    if (remove && this.editable && !this.locked) {
      const confirmed = await openActionDialog({
        title: "Rimuovere questa relazione?",
        message: "La relazione verrà rimossa soltanto dal grafo di lavoro della raccolta.",
        confirmLabel: "Rimuovi relazione",
        tone: "danger",
      });
      if (!confirmed) return;
      await this.mutate(() => editorialRepository.removeGraphEdge(this.editorialContextId, remove.dataset.removeEdge));
    }
  };

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form || !this.editable || this.locked) return;
    if (form.matches("[data-edge-form]")) {
      event.preventDefault();
      const data = new FormData(form);
      const note = String(data.get("note") || "").trim();
      await this.mutate(() => editorialRepository.addGraphEdge(this.editorialContextId, {
        sourceSubjectId: String(data.get("sourceSubjectId") || ""),
        targetSubjectId: String(data.get("targetSubjectId") || ""),
        relationTypeDefinitionId: String(data.get("relationTypeDefinitionId") || ""),
        weight: Number(data.get("weight") || 1),
        metadata: note ? { note } : null,
      }));
      return;
    }
    if (form.matches("[data-classes-form]")) {
      event.preventDefault();
      const data = new FormData(form);
      const ids = data.getAll("subjectClassDefinitionIds").map(String);
      await this.mutate(() => editorialRepository.setSubjectClasses(this.editorialContextId, this.selectedSubjectId, ids));
    }
  };

  async mutate(operation) {
    this.busy = true; this.error = null; this.render();
    try {
      await operation();
      await this.load();
      this.dispatchEvent(new CustomEvent("editorial-graph-changed", { bubbles: true }));
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Modifica del grafo non completata";
      this.busy = false; this.render();
    }
  }

  layoutNodes(subjects) {
    const width = 760, height = 430, cx = width / 2, cy = height / 2, radius = Math.min(270, 120 + subjects.length * 12);
    return subjects.map((entry, index) => {
      const angle = subjects.length === 1 ? -Math.PI / 2 : (Math.PI * 2 * index / subjects.length) - Math.PI / 2;
      return { ...entry, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * Math.min(radius, 155) };
    });
  }

  renderGraph(subjects) {
    if (!subjects.length) return `<div class="empty-state"><h3>Nessun Subject nella raccolta</h3><p>Aggiungi prima almeno un contenuto nella sezione Contenuti.</p></div>`;
    const nodes = this.layoutNodes(subjects);
    const positionById = new Map(nodes.map((node) => [id(node.subject), node]));
    const edges = (this.data?.edges || []).map((edge) => {
      const from = positionById.get(id(edge.sourceSubjectId));
      const to = positionById.get(id(edge.targetSubjectId));
      if (!from || !to) return "";
      const relation = this.relationById(edge.relationTypeDefinitionId);
      const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
      return `<g><line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" class="graph-edge" marker-end="url(#arrow)"/><text x="${mx}" y="${my - 6}" text-anchor="middle" class="edge-label">${escapeHtml(relation?.label || edge.relationTypeDefinitionId)}</text></g>`;
    }).join("");
    const renderedNodes = nodes.map((node) => {
      const subjectId = id(node.subject);
      const selected = subjectId === this.selectedSubjectId;
      const label = String(node.subject?.preferredLabel || "Subject");
      const short = label.length > 24 ? `${label.slice(0, 22)}…` : label;
      return `<g class="graph-node ${selected ? "selected" : ""}" data-graph-subject="${escapeHtml(subjectId)}" tabindex="0" role="button"><circle cx="${node.x}" cy="${node.y}" r="44"/><text x="${node.x}" y="${node.y + 4}" text-anchor="middle">${escapeHtml(short)}</text></g>`;
    }).join("");
    return `<div class="graph-canvas"><svg viewBox="0 0 760 430" role="img" aria-label="Grafo semantico della raccolta"><defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs>${edges}${renderedNodes}</svg></div>`;
  }

  renderSelectedSubject(subjects) {
    const entry = subjects.find((candidate) => id(candidate.subject) === this.selectedSubjectId);
    if (!entry) return `<div class="empty-state compact"><p>Seleziona un nodo per classificarlo secondo le regole editoriali.</p></div>`;
    const selected = new Set(entry.subjectClassDefinitionIds || []);
    return `<section class="subject-inspector"><span class="eyebrow">Subject selezionato</span><h3>${escapeHtml(entry.subject?.preferredLabel || "Subject")}</h3><p>${escapeHtml(entry.subject?.description || "")}</p><form data-classes-form><fieldset ${this.editable && !this.locked ? "" : "disabled"}><legend>Classi nel grafo</legend>${this.subjectClasses.length ? this.subjectClasses.map((definition) => `<label class="check-row"><input type="checkbox" name="subjectClassDefinitionIds" value="${escapeHtml(definition.definitionId)}" ${selected.has(String(definition.definitionId)) ? "checked" : ""}><span><strong>${escapeHtml(definition.label)}</strong>${definition.description ? `<small>${escapeHtml(definition.description)}</small>` : ""}</span></label>`).join("") : `<p class="muted">Il Namespace non definisce classi di Subject.</p>`}</fieldset>${this.editable && !this.locked ? `<button type="submit" class="button-secondary small">Salva classificazione</button>` : ""}</form></section>`;
  }

  renderEdgeForm(subjects) {
    if (!this.editable || this.locked || subjects.length < 2) return "";
    const options = subjects.map((entry) => `<option value="${escapeHtml(id(entry.subject))}">${escapeHtml(entry.subject?.preferredLabel || "Subject")}</option>`).join("");
    const relationOptions = (this.relationTypes || []).map((entry) => `<option value="${escapeHtml(entry.definitionId)}">${escapeHtml(entry.label)}</option>`).join("");
    if (!relationOptions) return `<div class="inline-notice">${icon("warning", { size: 16 })}<span>Le regole editoriali non definiscono tipi di relazione.</span></div>`;
    return `<form data-edge-form class="edge-form"><h3>Nuova relazione</h3><label>Da<select name="sourceSubjectId" required>${options}</select></label><label>A<select name="targetSubjectId" required>${options}</select></label><label>Tipo<select name="relationTypeDefinitionId" required>${relationOptions}</select></label><label>Peso<input name="weight" type="number" min="0" max="10" step=".5" value="1"></label><label class="wide">Nota<input name="note" maxlength="500" placeholder="Facoltativa"></label><button type="submit">${icon("link", { size: 16 })} Crea relazione</button><p class="note wide">Domain e range vengono validati dal Namespace. Se una relazione non è ammessa, classifica prima i Subject nel pannello laterale.</p></form>`;
  }

  renderEdgeList(subjects) {
    const subjectById = new Map(subjects.map((entry) => [id(entry.subject), entry.subject]));
    const edges = this.data?.edges || [];
    if (!edges.length) return `<div class="empty-state compact"><p>Nessuna relazione definita.</p></div>`;
    return `<div class="edge-list">${edges.map((edge) => {
      const source = subjectById.get(id(edge.sourceSubjectId));
      const target = subjectById.get(id(edge.targetSubjectId));
      const relation = this.relationById(edge.relationTypeDefinitionId);
      return `<article><span><strong>${escapeHtml(source?.preferredLabel || "Subject")}</strong> <em>${escapeHtml(relation?.label || edge.relationTypeDefinitionId)}</em> <strong>${escapeHtml(target?.preferredLabel || "Subject")}</strong></span>${this.editable && !this.locked ? `<button type="button" class="icon-button" data-remove-edge="${escapeHtml(edge.id)}" aria-label="Rimuovi relazione">${icon("trash", { size: 15 })}</button>` : ""}</article>`;
    }).join("")}</div>`;
  }

  render() {
    const subjects = this.graphSubjects();
    if (!this.selectedSubjectId && subjects.length) this.selectedSubjectId = id(subjects[0].subject);
    this.innerHTML = `<style>
      artaround-semantic-graph-editor{display:grid;gap:1rem}
      artaround-semantic-graph-editor .graph-workspace{display:grid;grid-template-columns:minmax(0,1fr) 18rem;gap:1rem;align-items:start}
      artaround-semantic-graph-editor .graph-canvas{min-height:28rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface-subtle);overflow:auto}
      artaround-semantic-graph-editor svg{display:block;width:100%;min-width:38rem;min-height:28rem}
      artaround-semantic-graph-editor .graph-edge{stroke:var(--muted);stroke-width:1.5;opacity:.7}artaround-semantic-graph-editor marker path{fill:var(--muted)}
      artaround-semantic-graph-editor .edge-label{font-size:11px;fill:currentColor;paint-order:stroke;stroke:var(--surface-subtle);stroke-width:4px}
      artaround-semantic-graph-editor .graph-node{cursor:pointer}artaround-semantic-graph-editor .graph-node circle{fill:var(--surface);stroke:var(--border);stroke-width:2}artaround-semantic-graph-editor .graph-node.selected circle{stroke:currentColor;stroke-width:3}artaround-semantic-graph-editor .graph-node text{font-size:11px;fill:currentColor;pointer-events:none}
      artaround-semantic-graph-editor .subject-inspector{display:grid;gap:.65rem;padding:1rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface)}
      artaround-semantic-graph-editor .subject-inspector h3,artaround-semantic-graph-editor .subject-inspector p{margin:0}
      artaround-semantic-graph-editor .check-row{display:flex;gap:.55rem;align-items:flex-start;margin:.5rem 0}artaround-semantic-graph-editor .check-row span{display:grid}artaround-semantic-graph-editor .check-row small{color:var(--muted)}
      artaround-semantic-graph-editor .edge-form{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.7rem;padding:1rem;border:1px solid var(--border);border-radius:var(--radius)}artaround-semantic-graph-editor .edge-form h3,artaround-semantic-graph-editor .edge-form .wide{grid-column:1/-1}
      artaround-semantic-graph-editor .edge-list{display:grid;gap:.4rem}artaround-semantic-graph-editor .edge-list article{display:flex;justify-content:space-between;gap:.7rem;align-items:center;padding:.65rem .8rem;border-bottom:1px solid var(--border)}
      @media(max-width:58rem){artaround-semantic-graph-editor .graph-workspace{grid-template-columns:1fr}artaround-semantic-graph-editor .edge-form{grid-template-columns:1fr 1fr}}
    </style><section aria-busy="${this.busy}">${this.locked ? `<div class="inline-notice">${icon("lock", { size: 16 })}<span>Il grafo è bloccato mentre la raccolta è in revisione.</span></div>` : ""}${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}<div class="graph-workspace">${this.renderGraph(subjects)}${this.renderSelectedSubject(subjects)}</div>${this.renderEdgeForm(subjects)}<section><h3>Relazioni definite</h3>${this.renderEdgeList(subjects)}</section></section>`;
  }
}

customElements.define("artaround-semantic-graph-editor", ArtAroundSemanticGraphEditor);
