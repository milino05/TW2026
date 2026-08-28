import { icon } from "./icons.js";
import { userFacingFieldLabel, userFacingIssueMessage } from "../application/user-facing-errors.js";

const SECTIONS = [
  ["overview", "Panoramica"],
  ["targets", "Oggetti"],
  ["map", "Spazi e mappa"],
  ["visitors", "Informazioni visitatori"],
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
  syncSectionNavigation({ scroll = false } = {}) {
    if (this.onboarding?.required) return;
    const available = SECTIONS.map(([key]) => key).filter((key) => this.querySelector(`#venue-${key}`));
    if (!available.includes(this.activeSection)) this.activeSection = available[0] || "overview";
    for (const tab of this.querySelectorAll("[data-venue-section]")) {
      const selected = tab.dataset.venueSection === this.activeSection;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const panel of this.querySelectorAll(".venue-section")) {
      const selected = panel.id === `venue-${this.activeSection}`;
      panel.hidden = !selected;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", `venue-tab-${panel.id.replace("venue-", "")}`);
      panel.tabIndex = -1;
    }
    const panel = this.querySelector(`#venue-${this.activeSection}`);
    if (scroll && panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  },

  showSection(section, { scroll = false } = {}) {
    if (!SECTIONS.some(([key]) => key === section)) return;
    this.activeSection = section;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#venue-${section}`);
    this.syncSectionNavigation({ scroll });
  },

  renderVenueRemoval() {
    if (!this.canManageLifecycle) return "";
    const impact = this.lifecycleImpact || {};
    const targetCount = Number(impact.venueTargetCount || 0);
    const visitCount = Number(impact.publishedVisitCount || 0);
    const visitWarning = visitCount
      ? `${visitCount} visita${visitCount === 1 ? " pubblicata dipende" : "e pubblicate dipendono"} attualmente da questa sede. Finché la sede resta nel cestino, nuove esecuzioni che la richiedono non potranno partire.`
      : "Nessuna visita pubblicata corrente dipende da questa sede.";
    const confirmation = this.pendingVenueRemoval
      ? `<section class="confirmation-panel resource-removal-confirmation" role="alert"><div><span class="eyebrow">Conferma richiesta</span><strong>Spostare “${escapeHtml(this.data.venue.name)}” nel cestino?</strong><p>La sede sparirà dalle superfici attive. VenueRelease, LayoutRevision e ${targetCount} oggett${targetCount === 1 ? "o" : "i"} fisic${targetCount === 1 ? "o" : "i"} resteranno conservati come stato storico e potranno tornare disponibili ripristinando la sede.</p><p>${escapeHtml(visitWarning)}</p></div><div class="button-row"><button class="danger" type="button" data-confirm-venue-removal ${this.busy ? "disabled" : ""}>Sposta sede nel cestino</button><button class="button-secondary" type="button" data-cancel-venue-removal ${this.busy ? "disabled" : ""}>Annulla</button></div></section>`
      : "";
    return `<section class="panel resource-danger-zone"><span class="eyebrow">Operazione sensibile</span><h2>Rimuovi sede</h2><p>La rimozione è logica: non cancella release, layout, oggetti o storico delle visite.</p><p class="note">${escapeHtml(visitWarning)}</p>${confirmation || `<button class="danger" type="button" data-request-venue-removal>${icon("trash", { size: 15 })} Sposta nel cestino</button>`}</section>`;
  },

  renderPhysicalOnboarding() {
    const venue = this.data.venue;
    const onboarding = this.onboarding || { choices: [], canCreate: false, recommendedMode: "starter" };
    const choices = onboarding.choices || [];
    if (!choices.length && !onboarding.canCreate) {
      return `<main class="page venue-editor-page"><nav class="breadcrumb"><button type="button" data-back>${icon("arrowLeft", { size: 16 })} Organizzazione</button></nav><section class="venue-onboarding venue-onboarding--blocked"><span class="eyebrow">Configurazione fisica</span><h1>${escapeHtml(venue.name)}</h1><h2>Serve un PhysicalVocabulary utilizzabile</h2><p>Questa organizzazione non dispone di un vocabolario fisico utilizzabile e il tuo ruolo non può crearne uno. Chiedi a un responsabile di pubblicarne o assegnarne uno.</p></section>${this.renderVenueRemoval()}</main>`;
    }
    const recommended = onboarding.recommendedMode || (choices.length ? "existing" : "starter");
    const choiceOptions = choices.map((entry, index) => `<option value="${escapeHtml(entry.physicalVocabularyRevisionId)}" ${index === 0 ? "selected" : ""}>${escapeHtml(entry.name)} · v${entry.version} · ${entry.basis === "license" ? "licenza" : "organizzazione"}</option>`).join("");
    return `<main class="page venue-editor-page" aria-busy="${this.busy}"><nav class="breadcrumb"><button type="button" data-back>${icon("arrowLeft", { size: 16 })} Organizzazione</button><span>/</span><span>Prima configurazione</span></nav><header class="venue-onboarding-header"><div><span class="eyebrow">Prima configurazione fisica</span><h1>${escapeHtml(venue.name)}</h1><p>Prima di disegnare spazi e percorsi, scegli il linguaggio fisico con cui questa sede descriverà luoghi, collegamenti e caratteristiche.</p></div></header>${this.error ? `<p role="alert">${icon("warning", { size: 16 })} ${escapeHtml(this.error)}</p>` : ""}<form class="venue-onboarding" data-physical-onboarding><fieldset><legend>Scegli come iniziare</legend>${choices.length ? `<label class="venue-onboarding-choice"><input type="radio" name="mode" value="existing" ${recommended === "existing" ? "checked" : ""}><span><strong>Usa un vocabolario esistente</strong><small>Riusa una revisione già disponibile per l'organizzazione.</small></span></label><div class="venue-onboarding-choice-detail"><label>Vocabolario<select name="physicalVocabularyRevisionId">${choiceOptions}</select></label></div>` : ""}${onboarding.canCreate ? `<label class="venue-onboarding-choice"><input type="radio" name="mode" value="starter" ${recommended === "starter" ? "checked" : ""}><span><strong>Configurazione base ArtAround</strong><small>Consigliata: parte con ingresso, uscita, servizi, scale, ascensore e caratteristiche utili al routing.</small></span></label><label class="venue-onboarding-choice"><input type="radio" name="mode" value="blank" ${recommended === "blank" ? "checked" : ""}><span><strong>Vocabolario vuoto</strong><small>Per casi speciali in cui vuoi definire ogni categoria manualmente.</small></span></label><div class="venue-onboarding-choice-detail"><label>Nome del nuovo vocabolario<input name="name" value="${escapeHtml(`${venue.name} · Vocabolario fisico`)}"></label><label>Descrizione<textarea name="description" rows="3">${escapeHtml(`Vocabolario fisico della sede ${venue.name}.`)}</textarea></label></div>` : ""}</fieldset><aside class="venue-onboarding-note"><strong>Perché questa scelta viene prima della mappa?</strong><p>Il Layout pinna una revisione precisa del PhysicalVocabulary. In questo modo Place, Connection e caratteristiche fisiche mantengono significato stabile anche quando il vocabolario evolve.</p></aside><button type="submit" ${this.busy ? "disabled" : ""}>${this.busy ? "Preparazione…" : "Continua con la configurazione"} ${icon("chevron", { size: 15 })}</button></form>${this.renderVenueRemoval()}</main>`;
  },

  renderWorkflowPanel() {
    if (this.pendingWorkflow !== "venue.release.request_changes") return "";
    return `<section class="confirmation-panel venue-confirmation" role="alert"><div><strong>Quali modifiche sono necessarie?</strong><p>La motivazione verrà registrata nel workflow della VenueRelease.</p><label>Motivazione<textarea data-workflow-message rows="3">${escapeHtml(this.workflowMessage)}</textarea></label></div><div class="button-row"><button type="button" data-confirm-workflow ${this.workflowMessage.trim() ? "" : "disabled"}>Invia richiesta</button><button class="button-secondary" type="button" data-cancel-workflow>Annulla</button></div></section>`;
  },

  renderPublication() {
    const { release, availableOperations } = this.data;
    const issues = (release?.integrity?.issues || []).map((issue) => `<li><strong>${escapeHtml(userFacingFieldLabel(issue.field) || "Controllo")}</strong><span>${escapeHtml(userFacingIssueMessage({ ...issue, field: "" }))}</span></li>`).join("");
    const buttons = availableOperations.filter((entry) => entry.code.startsWith("venue.release.") && !["venue.release.update", "venue.release.ensure"].includes(entry.code)).map((entry) => `<button type="button" data-workflow="${escapeHtml(entry.code)}">${escapeHtml(WORKFLOW_LABEL[entry.code] || entry.label)}</button>`).join("");
    const ensure = availableOperations.find((entry) => entry.code === "venue.release.ensure");
    return `<section class="venue-section" id="venue-publication"><div class="section-heading"><div><span class="eyebrow">Pubblicazione</span><h2>Controllo della configurazione fisica</h2><p>La pubblicazione riguarda VenueRelease e LayoutRevision. Non pubblica contenuti editoriali nel Catalogo.</p></div></div>${ensure ? `<div class="venue-start"><div><strong>La versione pubblicata è in sola lettura</strong><p>Crea una nuova bozza per apportare modifiche.</p></div><button type="button" data-ensure-release>${escapeHtml(ensure.label)}</button></div>` : ""}${release ? `<div class="venue-publication-status"><div><span class="eyebrow">Stato</span><h3>${escapeHtml(statusLabel(release.status))}</h3></div><span class="chip" data-tone="${release.integrity.status === "valid" ? "success" : "warning"}">${icon(release.integrity.status === "valid" ? "check" : "warning", { size: 14 })} ${release.integrity.status === "valid" ? "Controllo superato" : "Da controllare"}</span></div>${issues ? `<div class="issues"><h4>Problemi da risolvere</h4><ul>${issues}</ul></div>` : `<p class="note">Nessun problema segnalato nell'ultimo controllo.</p>`}${buttons ? `<div class="button-row">${buttons}</div>` : ""}` : ""}${this.renderWorkflowPanel()}</section>`;
  },

  renderOverview() {
    const { venue, release, layout, targets, physicalVocabulary } = this.data;
    return `<section class="venue-section" id="venue-overview"><div class="section-heading"><div><span class="eyebrow">Panoramica</span><h2>Configurazione della sede</h2><p>Profilo pubblico e modello fisico restano separati ma coordinati.</p></div></div><form data-venue-metadata class="venue-overview-form"><label>Nome<input name="name" value="${escapeHtml(venue.name)}" required></label><label class="wide">Descrizione<textarea name="description" rows="3">${escapeHtml(venue.description || "")}</textarea></label><button type="submit">${icon("check", { size: 16 })} Salva profilo</button></form><dl class="venue-summary"><div><dt>Oggetti</dt><dd>${targets.length}</dd></div><div><dt>Piani</dt><dd>${layout?.floors?.length || 0}</dd></div><div><dt>Luoghi</dt><dd>${layout?.places?.length || 0}</dd></div><div><dt>Collegamenti</dt><dd>${layout?.connections?.length || 0}</dd></div></dl>${physicalVocabulary ? `<p class="note">Vocabolario fisico: <strong>${escapeHtml(physicalVocabulary.name)}</strong> · v${physicalVocabulary.version}</p>` : ""}${release ? `<p class="note">VenueRelease ${release.version} · ${escapeHtml(statusLabel(release.status))}</p>` : ""}${this.renderVenueRemoval()}</section>`;
  },

  render() {
    if (!this.data) { this.innerHTML = `<main class="page venue-editor-page"><p role="${this.error ? "alert" : "status"}">${escapeHtml(this.error || "Caricamento sede…")}</p></main>`; return; }
    if (this.onboarding?.required) { this.innerHTML = this.renderPhysicalOnboarding(); return; }
    const { venue, release, layout, availableOperations } = this.data;
    const editable = has(availableOperations, "venue.release.update");
    const nav = SECTIONS.map(([key, label]) => `<button type="button" id="venue-tab-${key}" role="tab" data-venue-section="${key}" aria-controls="venue-${key}">${escapeHtml(label)}</button>`).join("");
    this.innerHTML = `<main class="page venue-editor-page" aria-busy="${this.busy}"><nav class="breadcrumb" aria-label="Percorso"><button type="button" data-back>${icon("arrowLeft", { size: 16 })} Organizzazione</button><span>/</span><span>Sedi e spazi fisici</span></nav><header class="venue-editor-header"><div><span class="eyebrow">Sede dell'organizzazione</span><h1>${escapeHtml(venue.name)}</h1><p>${escapeHtml(venue.description || "Configura gli oggetti, gli spazi e i percorsi fisici della sede.")}</p></div><div class="venue-editor-status"><span class="chip">${escapeHtml(sourceLabel(venue.source))}</span>${release ? `<span class="chip">Versione ${release.version}</span><span class="chip">${escapeHtml(statusLabel(release.status))}</span>` : ""}</div></header>${this.busy ? `<p role="status">Aggiornamento…</p>` : ""}${this.message ? `<p class="feedback-success" role="status">${icon("check", { size: 16 })} ${escapeHtml(this.message)}</p>` : ""}${this.error ? `<p role="alert">${icon("warning", { size: 16 })} ${escapeHtml(this.error)}</p>` : ""}<div class="venue-editor-layout"><aside class="venue-editor-nav"><nav role="tablist" aria-orientation="vertical" aria-label="Sezioni sede">${nav}</nav><details class="technical-details"><summary>Dettagli tecnici</summary><dl class="definition-list"><div><dt>Venue ID</dt><dd><code>${escapeHtml(venue.id)}</code></dd></div>${release ? `<div><dt>VenueRelease ID</dt><dd><code>${escapeHtml(release.id)}</code></dd></div>` : ""}${layout ? `<div><dt>LayoutRevision ID</dt><dd><code>${escapeHtml(layout.id)}</code></dd></div>` : ""}</dl></details></aside><div class="venue-editor-content">${this.renderOverview()}${this.renderTargets(editable)}${this.renderMapAndPlaces(editable)}${this.renderVisitors(editable)}${this.renderPublication()}</div></div></main>`;
    this.syncSectionNavigation();
  },
};
