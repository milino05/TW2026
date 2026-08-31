import { notify } from "../application/ui-feedback.js";
import { ArtAroundNamespaceEditorView } from "./namespace-editor-view.js";
import { ArtAroundPhysicalVocabularyEditorView } from "./physical-vocabulary-editor-view.js";
import { ItemAuthoringView } from "./item-authoring-view.js";
import { ArtAroundVisitAuthoringView } from "./visit-authoring-view.js";
import { ArtAroundVenueEditorView } from "./venue-editor-view.js";

/*
 * Controlled migration bridge for legacy views.
 *
 * This bridge is deliberately action-aware. A property name such as `message`
 * or `notice` is not enough to decide the feedback surface: some legacy views
 * reuse the same property for post-action events and for still-actionable
 * contextual guidance. A resolver may therefore return null to keep the legacy
 * feedback inline. New code should call notify.* directly with a structured tone.
 */
const NOTIFICATION_TONES = new Set(["neutral", "info", "success", "warning", "danger"]);

function normalizedText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function removeLegacyTransientNode(editor, message) {
  const expected = normalizedText(message);
  if (!expected) return;
  const candidates = editor.querySelectorAll('p[role="status"], .feedback-success[role="status"], [data-transient-feedback]');
  for (const candidate of candidates) {
    if (normalizedText(candidate.textContent).includes(expected)) candidate.remove();
  }
}

function emitNotification(message, resolvedTone) {
  const tone = NOTIFICATION_TONES.has(resolvedTone) ? resolvedTone : "success";
  notify[tone](message);
}

function issueCount(editor) {
  const revision = editor.data?.revision || editor.revision || editor.selectedRevision?.();
  const candidates = [
    revision?.integrity?.issues,
    revision?.routeReview?.issues,
    revision?.readiness?.issues,
    revision?.readiness?.blockers,
    revision?.publicationReadiness?.issues,
    revision?.publicationReadiness?.blockers,
  ];
  return candidates.reduce((sum, entries) => sum + (Array.isArray(entries) ? entries.length : 0), 0);
}

function defaultMapping(editor, message) {
  return { tone: /controll/i.test(message) && issueCount(editor) > 0 ? "warning" : "success" };
}

function namespaceMessageMapping(editor, message) {
  return defaultMapping(editor, message);
}

function physicalMessageMapping(editor, message) {
  return defaultMapping(editor, message);
}

function visitMessageMapping(editor, message) {
  /* The occurrence-selection branch is not an event: the user still has to
   * choose a concrete physical occurrence. Keep its message beside that UI. */
  if (editor.pendingOccurrence || /scegli l['’]occorrenza fisica corretta/i.test(message)) return null;
  if (/^Il contenuto resta contestuale/i.test(message)) return { tone: "info" };
  return defaultMapping(editor, message);
}

function venueMessageMapping(editor, message) {
  if (/già presente nell[’']inventario/i.test(message)) return { tone: "info" };
  if (/^Nuova bozza fisica pronta/i.test(message)) return { tone: "info" };
  return defaultMapping(editor, message);
}

function itemNoticeMapping(editor, message) {
  if (/^Controllo completato:/i.test(message) && issueCount(editor) > 0) return { tone: "warning" };
  if (/^(Bozza ripristinata|Soggetto selezionato|Identità già presente|Testo aggiunto)/i.test(message)) return { tone: "info" };
  return { tone: "success" };
}

function consumeTransientProperty(editor, property, mappingResolver) {
  const message = normalizedText(editor[property]);
  if (!message) return;
  const mapping = mappingResolver(editor, message);
  if (!mapping) return;
  emitNotification(message, mapping.tone);
  editor[property] = null;
  removeLegacyTransientNode(editor, message);
}

function installTransientPropertyAdapter(constructor, property, mappingResolver = defaultMapping) {
  const prototype = constructor.prototype;
  const flag = `__globalTransientFeedback_${property}`;
  if (prototype[flag]) return;
  const render = prototype.render;
  prototype.render = function renderWithGlobalTransientFeedback(...args) {
    const result = render.apply(this, args);
    consumeTransientProperty(this, property, mappingResolver);
    return result;
  };
  Object.defineProperty(prototype, flag, { value: true });
}

installTransientPropertyAdapter(ArtAroundNamespaceEditorView, "message", namespaceMessageMapping);
installTransientPropertyAdapter(ArtAroundPhysicalVocabularyEditorView, "message", physicalMessageMapping);
installTransientPropertyAdapter(ArtAroundVisitAuthoringView, "message", visitMessageMapping);
installTransientPropertyAdapter(ArtAroundVenueEditorView, "message", venueMessageMapping);
installTransientPropertyAdapter(ItemAuthoringView, "notice", itemNoticeMapping);
