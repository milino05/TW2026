import { userFacingFieldLabel, userFacingIssueMessage } from "../application/user-facing-errors.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function id(value) { return String(value?._id || value?.id || value || ""); }

const SPATIAL_ISSUE_CODES = new Set([
  "ACTIVE_TARGET_NOT_PLACED",
  "TARGET_NOT_IN_RELEASE",
  "DUPLICATE_TARGET_PLACEMENT",
  "PRIMARY_PLACE_MISSING",
  "PHYSICAL_VOCABULARY_REVISION_NOT_FOUND",
  "PHYSICAL_VOCABULARY_NOT_AVAILABLE",
  "PHYSICAL_VOCABULARY_REVISION_NOT_PUBLISHABLE",
]);

function isSpatialIssue(issue) {
  const field = String(issue?.field || "");
  const code = String(issue?.code || "");
  return field.startsWith("layout.") || SPATIAL_ISSUE_CODES.has(code) || code.startsWith("PHYSICAL_VOCABULARY_");
}

export const venueSpatialDiagnosticsMixin = {
  spatialIssues() {
    const issues = this.data.release?.liveIntegrity?.issues || this.data.release?.integrity?.issues || [];
    return issues.filter(isSpatialIssue);
  },

  renderSpatialIssues() {
    const issues = this.spatialIssues();
    if (!issues.length) {
      if (!this.data.release?.liveIntegrity) return "";
      return `<aside class="venue-contextual-issues venue-contextual-issues--clear"><strong>Struttura fisica coerente</strong><p>La diagnostica corrente non segnala problemi in piani, luoghi, collegamenti o collocazioni.</p></aside>`;
    }
    return `<aside class="venue-contextual-issues" role="status"><div><span class="eyebrow">Controllo contestuale</span><strong>${issues.length} ${issues.length === 1 ? "problema da sistemare" : "problemi da sistemare"} in Spazi e mappa</strong><p>Questi controlli sono calcolati sullo stato corrente della bozza. Correggili qui prima della pubblicazione.</p></div><ul>${issues.map((issue) => `<li data-severity="${escapeHtml(issue.severity || "error")}"><strong>${escapeHtml(userFacingFieldLabel(issue.field) || "Configurazione fisica")}</strong><span>${escapeHtml(userFacingIssueMessage({ ...issue, field: "" }))}</span></li>`).join("")}</ul></aside>`;
  },

  renderActiveFloorMetadata(editable) {
    const floor = this.activeFloor?.();
    if (!editable || !floor) return "";
    return `<form class="venue-floor-metadata" data-floor-metadata="${escapeHtml(id(floor._id))}"><div><span class="eyebrow">Piano visualizzato</span><strong>Nome del piano</strong><small>Il nome è descrittivo; geometria e riferimenti interni restano invariati.</small></div><label>Nome<input name="label" value="${escapeHtml(floor.label)}" maxlength="120" required></label><button class="button-secondary" type="submit">Salva nome</button></form>`;
  },

  renderMapAndPlaces(editable) {
    if (!this.data.layout) return `<section class="venue-section" id="venue-map"><div class="empty-state"><h3>Nessun Layout disponibile</h3><p>Completa prima la configurazione iniziale della sede.</p></div></section>`;
    const vocabulary = this.data.physicalVocabulary;
    const vocabularyContext = vocabulary ? `<aside class="venue-vocabulary-context"><span class="eyebrow">PhysicalVocabulary pinzato</span><strong>${escapeHtml(vocabulary.name)}</strong><small>v${vocabulary.version} · revisione ${escapeHtml(vocabulary.status)}</small>${vocabulary.canManage ? `<button class="button-secondary small" type="button" data-edit-physical-vocabulary="${escapeHtml(vocabulary.id)}">Gestisci vocabolario fisico</button>` : ""}</aside>` : "";
    return `<section class="venue-section" id="venue-map"><div class="section-heading"><div><span class="eyebrow">Spazi e mappa</span><h2>Modello fisico della sede</h2><p>Piani, luoghi, collegamenti e collocazioni sono dati logistici: non diventano Item.</p></div></div>${vocabularyContext}${this.renderSpatialIssues()}${this.renderMapPreview(editable)}${this.renderActiveFloorMetadata(editable)}${this.renderCalibrationComposer(editable)}${this.renderGeometryComposer(editable)}${this.renderFloors(editable)}${this.renderPlaces(editable)}${this.renderConnections(editable)}${this.renderTargetPlacements(editable)}</section>`;
  },
};
