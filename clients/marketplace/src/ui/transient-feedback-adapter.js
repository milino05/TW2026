import { notify } from "../application/ui-feedback.js";
import { ArtAroundNamespaceEditorView } from "./namespace-editor-view.js";
import { ArtAroundPhysicalVocabularyEditorView } from "./physical-vocabulary-editor-view.js";
import { ItemAuthoringView } from "./item-authoring-view.js";
import { ArtAroundVisitAuthoringView } from "./visit-authoring-view.js";
import { ArtAroundVenueEditorView } from "./venue-editor-view.js";

/*
 * Controlled migration bridge for legacy views.
 *
 * Only properties that are already used as explicit post-action success/info
 * channels are registered here. Persistent errors, busy states, search-result
 * notices, field validation, integrity panels and dialogs are intentionally not
 * inferred from DOM roles or class names. New code should call notify.* directly
 * with a structured tone; the resolvers below only preserve legacy semantics.
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

function integrityIssueCount(editor) {
  const revision = editor.data?.revision || editor.revision || editor.selectedRevision?.();
  return Array.isArray(revision?.integrity?.issues) ? revision.integrity.issues.length : 0;
}

function defaultTone(editor, message) {
  return /controll/i.test(message) && integrityIssueCount(editor) > 0 ? "warning" : "success";
}

function itemNoticeTone(editor, message) {
  if (/^Controllo completato:/i.test(message) && integrityIssueCount(editor) > 0) return "warning";
  if (/^(Bozza ripristinata|Soggetto selezionato|Identità già presente|Testo aggiunto)/i.test(message)) return "info";
  return "success";
}

function consumeTransientProperty(editor, property, toneResolver) {
  const message = normalizedText(editor[property]);
  if (!message) return;
  emitNotification(message, toneResolver(editor, message));
  editor[property] = null;
  removeLegacyTransientNode(editor, message);
}

function installTransientPropertyAdapter(constructor, property, toneResolver = defaultTone) {
  const prototype = constructor.prototype;
  const flag = `__globalTransientFeedback_${property}`;
  if (prototype[flag]) return;
  const render = prototype.render;
  prototype.render = function renderWithGlobalTransientFeedback(...args) {
    const result = render.apply(this, args);
    consumeTransientProperty(this, property, toneResolver);
    return result;
  };
  Object.defineProperty(prototype, flag, { value: true });
}

installTransientPropertyAdapter(ArtAroundNamespaceEditorView, "message");
installTransientPropertyAdapter(ArtAroundPhysicalVocabularyEditorView, "message");
installTransientPropertyAdapter(ArtAroundVisitAuthoringView, "message");
installTransientPropertyAdapter(ArtAroundVenueEditorView, "message");
installTransientPropertyAdapter(ItemAuthoringView, "notice", itemNoticeTone);
