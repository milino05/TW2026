import { userFacingFieldLabel, userFacingIssueMessage } from "../application/user-facing-errors.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }

const SPATIAL_ISSUE_CODES = new Set([
  "DUPLICATE_EXHIBIT_SLOT",
  "EXHIBIT_SLOT_NOT_FOUND",
  "EXHIBIT_SLOT_PLACE_NOT_FOUND",
  "EXHIBIT_SLOT_ASSIGNED_MULTIPLE_TIMES",
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
      return `<aside class="venue-contextual-issues venue-contextual-issues--clear"><strong>Struttura fisica coerente</strong><p>La diagnostica corrente non segnala problemi in piani, luoghi, collegamenti o slot espositivi.</p></aside>`;
    }
    return `<aside class="venue-contextual-issues" role="status"><div><span class="eyebrow">Controllo contestuale</span><strong>${issues.length} ${issues.length === 1 ? "problema da sistemare" : "problemi da sistemare"} in Spazi e mappa</strong><p>Questi controlli sono calcolati sullo stato corrente della bozza. Correggili qui prima della pubblicazione.</p></div><ul>${issues.map((issue) => `<li data-severity="${escapeHtml(issue.severity || "error")}"><strong>${escapeHtml(userFacingFieldLabel(issue.field) || "Configurazione fisica")}</strong><span>${escapeHtml(userFacingIssueMessage({ ...issue, field: "" }))}</span></li>`).join("")}</ul></aside>`;
  },
};
