import { notify } from "../application/ui-feedback.js";
import { ArtAroundNamespaceEditorView } from "./namespace-editor-view.js";
import { ArtAroundPhysicalVocabularyEditorView } from "./physical-vocabulary-editor-view.js";

/* Compatibility adapter for the two existing vocabulary editors.
 * Only their explicit transient `message` channel becomes a toast. Busy states,
 * persistent errors, integrity issues and confirmations intentionally stay local.
 */
function consumeTransientMessage(editor) {
  const message = String(editor.message || "").trim();
  if (!message) return;

  notify.success(message);
  editor.message = null;

  for (const status of editor.querySelectorAll('p[role="status"]')) {
    const text = status.textContent?.replace(/\s+/g, " ").trim() || "";
    if (text.includes(message)) status.remove();
  }
}

function installTransientMessageAdapter(prototype, flag) {
  if (prototype[flag]) return;
  const render = prototype.render;
  prototype.render = function renderWithGlobalTransientFeedback(...args) {
    const result = render.apply(this, args);
    consumeTransientMessage(this);
    return result;
  };
  Object.defineProperty(prototype, flag, { value: true });
}

installTransientMessageAdapter(ArtAroundNamespaceEditorView.prototype, "__globalTransientFeedbackInstalled");
installTransientMessageAdapter(ArtAroundPhysicalVocabularyEditorView.prototype, "__globalTransientFeedbackInstalled");
