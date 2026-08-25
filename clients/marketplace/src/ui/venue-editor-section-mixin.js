import { icon } from "./icons.js";

const SECTIONS = [
  ["overview", "Panoramica"],
  ["targets", "Oggetti esposti"],
  ["visitors", "Informazioni visitatori"],
  ["map", "Mappa e luoghi"],
  ["routes", "Percorsi"],
  ["publication", "Pubblicazione"],
];
const WORKFLOW_LABEL = {
  "venue.release.check": "Controlla se è tutto pronto",
  "venue.release.request_review": "Invia in revisione",
  "venue.release.withdraw_review": "Ritira dalla revisione",
  "venue.release.request_changes": "Richiedi modifiche",
  "venue.release.publish": "Pubblica configurazione",
};
function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function has(operations, code) { return (operations || []).some((entry) => entry.code === code); }
function statusLabel(status) { return { draft: "Bozza", in_review: "In revisione", changes_requested: "Modifiche richieste", published: "Pubblicata", superseded: "Superata" }[status] || status || "Da configurare"; }
function sourceLabel(source) { return source === "working" ? "Bozza di lavoro" : source === "published" ? "Versione pubblicata" : "Non configurata"; }

export const venueSectionMixin = {
  renderWorkflowPanel() {
    if (!this.pendingWorkflow) return "";
    const code = this.pendingWorkflow;
    if (code === "venue.release.request_changes" && !this.dirty) {
      return `<section class="confirmation-panel venue-confirmation" role="alert"><div><strong>Quali modifiche sono necessarie?</strong><p>La motivazione verrà registrata nel workflow della VenueRelease.</p><label>Motivazione<textarea data-workflow-message rows="3">${escapeHtml(this.workflowMessage)}</textarea></label></div><div class="button-row"><button type="button" data-confirm-workflow ${this.workflowMessage.trim() ? "" : "disabled"}>Invia richiesta</button><button class="button-secondary" type="button" data-cancel-workflow>Annulla</button></div></section>`;
    }
    return `<section class="confirmation-panel venue-confirmation" role="alert"><div><strong>Prima salva le modifiche</strong><p>Il workflow deve operare sulla configurazione fisica effettivamente salvata.</p>${code === "venue.release.request_changes" ? `<label>Motivazione<textarea data-workflow-message rows="3">${escapeHtml(this.workflowMessage)}</textarea></label>` : ""}</div><div class="button-row"><button type="button" data-save-and-workflow ${code === "venue.release.request_changes" && !this.workflowMessage.trim() ? "disabled" : ""}>Salva e continua con “${escapeHtml(WORKFLOW_LABEL[code] || "l'operazione")}”</button><button class="button-secondary" type="button" data-cancel-workflow>Annulla</button></div></section>`;
  },
  renderPublication() {
    const { release, availableOperations } = this.data;
    const issues = (release?.integrity?.issues || []).map((issue) => `<li><strong>${escapeHtml(issue.field || issue.code || "Controllo")}</strong><span>${escapeHtml(issue.message)}</span></li>`).join("");
    const buttons = availableOperations.filter((entry) => entry.code.startsWith("venue.release.") && !["venue.release.update", "venue.release.ensure"].includes(entry.code)).map((entry) => `<button type="button" data-workflow="${escapeHtml(entry.code)}">${escapeHtml(WORKFLOW_LABEL[entry.code] || entry.label)}</button>`).join("");
    const ensure = availableOperations.find((entry) => entry.code === "venue.release.ensure");
    return `<section class="venue-section" id="venue-publication"><div class="section-heading"><div><span class="eyebrow">Pubblicazione</span><h2>Controllo della configurazione fisica</h2><p>La pubblicazione riguarda VenueRelease e LayoutRevision. Non pubblica contenuti editoriali nel Catalogo.</p></div></div>${ensure ? `<div class="venue-start"><div><strong>Non c'è una bozza modificabile</strong><p>Crea una nuova bozza dalla versione pubblicata o avvia la prima configurazione.</p></div><button type="button" data-ensure-release>${escapeHtml(ensure.label)}</button></div>` : ""}${release ? `<div class="venue-publication-status"><div><span class="eyebrow">Stato</span><h3>${escapeHtml(statusLabel(release.status))}</h3></div><span class="chip" data-tone="${release.integrity.status === "valid" ? "success" : "warning"}">${icon(release.integrity.status === "valid" ? "check" : "warning", { size: 14 })} ${release.integrity.status === "valid" ? "Controllo superato" : "Da controllare"}</span></div>${issues ? `<div class="issues"><h4>Problemi da risolvere</h4><ul>${issues}</ul></div>` : `<p class="note">Nessun problema di integrità segnalato nell'ultimo controllo.</p>`}${buttons ? `<div class="button-row">${buttons}</div>` : ""}` : ""}${this.renderWorkflowPanel()}</section>`;
  },
  renderTrashConfirmation() {
    if (!this.trashTarget) return "";
    return `<section class="confirmation-panel venue-confirmation" role="alert"><div><strong>Spostare “${escapeHtml(this.trashTarget.label)}” nel cestino?</strong><p>L'oggetto non sarà più disponibile come VenueTarget attivo. I contenuti editoriali associati allo stesso Subject non vengono cancellati.</p></div><div class="button-row"><button class="danger" type="button" data-confirm-trash>Conferma</button><button class="button-secondary" type="button" data-cancel-trash>Annulla</button></div></section>`;
  },
  renderOverview() {
    const { venue, release, layout, targets } = this.data;
    return `<section class="venue-section" id="venue-overview"><div class="section-heading"><div><span class="eyebrow">Panoramica</span><h2>Configurazione della sede</h2><p>Identità della sede e stato del suo modello fisico.</p></div></div><form data-venue-metadata class="venue-overview-form"><label>Nome<input name="name" value="${escapeHtml(venue.name)}" required></label><label class="wide">Descrizione<textarea name="description" rows="3">${escapeHtml(venue.description || "")}</textarea></label><button type="submit">${icon("check", { size: 16 })} Salva</button></form><dl class="venue-summary"><div><dt>Oggetti esposti</dt><dd>${targets.length}</dd></div><div><dt>Piani</dt><dd>${layout?.floors?.length || 0}</dd></div><div><dt>Luoghi</dt><dd>${layout?.places?.length || 0}</dd></div><div><dt>Percorsi</dt><dd>${layout?.connections?.length || 0}</dd></div></dl>${release ? `<p class="note">Versione fisica ${release.version} · ${escapeHtml(statusLabel(release.status))}</p>` : `<p class="note">La sede non ha ancora una VenueRelease configurata.</p>`}</section>`;
  },
  render() {
    if (!this.data) { this.innerHTML = `<main class="page venue-editor-page"><p role="${this.error ? "alert" : "status"}">${escapeHtml(this.error || "Caricamento sede…")}</p></main>`; return; }
    const { venue, release, layout, availableOperations } = this.data;
    const editable = has(availableOperations, "venue.release.update");
    const nav = SECTIONS.map(([key, label]) => `<a href="#venue-${key}">${escapeHtml(label)}</a>`).join("");
    const leavePanel = this.leaveConfirmation ? `<section class="confirmation-panel venue-confirmation" role="alert"><div><strong>Uscire senza salvare?</strong><p>Le modifiche non salvate alla configurazione fisica andranno perse.</p></div><div class="button-row"><button class="danger" type="button" data-confirm-leave>Esci senza salvare</button><button class="button-secondary" type="button" data-cancel-leave>Resta nell'editor</button></div></section>` : "";
    const savebar = this.dirty ? `<div class="venue-savebar"><div><strong>Hai modifiche non salvate</strong><small>Il salvataggio aggiorna insieme informazioni visitatori, binding degli oggetti e layout della bozza.</small></div><button type="button" data-save-venue>${icon("check", { size: 16 })} Salva modifiche</button></div>` : "";
    this.innerHTML = `<main class="page venue-editor-page" aria-busy="${this.busy}"><datalist id="place-intents">${this.data.catalogs.placeIntents.map((value) => `<option value="${escapeHtml(value)}">`).join("")}</datalist><datalist id="routing-attributes">${this.data.catalogs.canonicalRoutingAttributes.map((value) => `<option value="${escapeHtml(value.key)}">`).join("")}</datalist><nav class="breadcrumb" aria-label="Percorso"><button type="button" data-back>${icon("arrowLeft", { size: 16 })} Organizzazione</button><span>/</span><span>Sedi e spazi fisici</span></nav><header class="venue-editor-header"><div><span class="eyebrow">Sede · ${escapeHtml(venue.role === "manager" ? "Manager" : "Operatore")}</span><h1>${escapeHtml(venue.name)}</h1><p>${escapeHtml(venue.description || "Configura gli oggetti, gli spazi e i percorsi fisici della sede.")}</p></div><div class="venue-editor-status"><span class="chip">${escapeHtml(sourceLabel(venue.source))}</span>${release ? `<span class="chip">Versione ${release.version}</span><span class="chip">${escapeHtml(statusLabel(release.status))}</span>` : ""}<span class="chip" data-dirty-indicator data-tone="${this.dirty ? "warning" : "success"}">${icon(this.dirty ? "warning" : "check", { size: 14 })} ${this.dirty ? "Modifiche non salvate" : "Tutto salvato"}</span></div></header>${this.busy ? `<p role="status">Aggiornamento…</p>` : ""}${this.message ? `<p role="status">${icon("check", { size: 16 })} ${escapeHtml(this.message)}</p>` : ""}${this.error ? `<p role="alert">${icon("warning", { size: 16 })} ${escapeHtml(this.error)}</p>` : ""}${leavePanel}${this.renderTrashConfirmation()}<div class="venue-editor-layout"><aside class="venue-editor-nav"><nav aria-label="Sezioni sede">${nav}</nav><details class="technical-details"><summary>Dettagli tecnici</summary><dl class="definition-list"><div><dt>Venue ID</dt><dd><code>${escapeHtml(venue.id)}</code></dd></div>${release ? `<div><dt>VenueRelease ID</dt><dd><code>${escapeHtml(release.id)}</code></dd></div>` : ""}${layout ? `<div><dt>LayoutRevision ID</dt><dd><code>${escapeHtml(layout.id)}</code></dd></div>` : ""}</dl></details></aside><div class="venue-editor-content">${this.renderOverview()}${this.renderTargets(editable)}${this.renderVisitors(editable)}${this.renderMapAndPlaces(editable)}${this.renderRoutes(editable)}${this.renderPublication()}</div></div>${editable ? savebar : ""}</main>`;
  }
};
