import { notify } from "../application/ui-feedback.js";
import { ArtAroundNamespaceEditorView } from "./namespace-editor-view.js";
import { ArtAroundPhysicalVocabularyEditorView } from "./physical-vocabulary-editor-view.js";
import { ArtAroundItemAuthoringView } from "./item-authoring-view.js";
import { ArtAroundVisitAuthoringView } from "./visit-authoring-view.js";
import { ArtAroundVenueEditorView } from "./venue-editor-view.js";

/*
 * Controlled migration bridge for legacy views.
 *
 * Only properties that are already used as explicit post-action success/info
 * channels are registered here. Persistent errors, busy states, search-result
 * notices, field validation, integrity panels and dialogs are intentionally not
 * inferred from DOM roles or class names.
 */
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

function consumeTransientProperty(editor, property) {
  const message = normalizedText(editor[property]);
  if (!message) return;
  notify.success(message);
  editor[property] = null;
  removeLegacyTransientNode(editor, message);
}

function installTransientPropertyAdapter(constructor, property) {
  const prototype = constructor.prototype;
  const flag = `__globalTransientFeedback_${property}`;
  if (prototype[flag]) return;
  const render = prototype.render;
  prototype.render = function renderWithGlobalTransientFeedback(...args) {
    const result = render.apply(this, args);
    consumeTransientProperty(this, property);
    return result;
  };
  Object.defineProperty(prototype, flag, { value: true });
}

installTransientPropertyAdapter(ArtAroundNamespaceEditorView, "message");
installTransientPropertyAdapter(ArtAroundPhysicalVocabularyEditorView, "message");
installTransientPropertyAdapter(ArtAroundVisitAuthoringView, "message");
installTransientPropertyAdapter(ArtAroundVenueEditorView, "message");
installTransientPropertyAdapter(ArtAroundItemAuthoringView, "notice");
