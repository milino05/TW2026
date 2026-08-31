import { openActionDialog } from "./feedback-primitives.js";
import { ArtAroundNamespaceEditorView } from "./namespace-editor-view.js";
import { ArtAroundPhysicalVocabularyEditorView } from "./physical-vocabulary-editor-view.js";
import { ArtAroundItemAuthoringView } from "./item-authoring-view.js";
import { ArtAroundVisitAuthoringView } from "./visit-authoring-view.js";

/*
 * Incremental migration for legacy feedback surfaces whose semantics are already
 * unambiguous. Complex workflow dialogs and contextual panels stay untouched
 * until they can be mapped without losing domain-specific interaction.
 */
function replaceIssuePanels(root) {
  for (const legacy of root.querySelectorAll(".issue-panel:not(artaround-issue-panel)")) {
    const panel = document.createElement("artaround-issue-panel");
    panel.setAttribute("tone", "warning");
    panel.className = legacy.className;
    panel.innerHTML = legacy.innerHTML;
    for (const attribute of legacy.attributes) {
      if (attribute.name !== "class") panel.setAttribute(attribute.name, attribute.value);
    }
    legacy.replaceWith(panel);
  }
}

function legacyDialogKey(value) {
  if (!value) return "";
  return [value.type, value.field, value.definitionId, value.title].filter(Boolean).join(":");
}

function showNamespaceLeaveDialog(editor) {
  const legacy = editor.querySelector(".namespace-confirmation");
  if (!editor.leaveConfirmation || !legacy || editor.__sharedLeaveDialogOpen) return;
  legacy.hidden = true;
  editor.__sharedLeaveDialogOpen = true;

  openActionDialog({
    tone: "danger",
    title: "Uscire senza salvare?",
    message: "Le modifiche non salvate alle regole editoriali andranno perse.",
    confirmLabel: "Esci senza salvare",
    cancelLabel: "Resta nell'editor",
  }).then((confirmed) => {
    editor.__sharedLeaveDialogOpen = false;
    if (!editor.isConnected || !editor.leaveConfirmation) return;
    const control = editor.querySelector(confirmed ? "[data-confirm-leave]" : "[data-cancel-leave]");
    control?.click();
    if (!confirmed) requestAnimationFrame(() => editor.querySelector("[data-back]")?.focus({ preventScroll: true }));
  });
}

function showPhysicalConfirmationDialog(editor) {
  const confirmation = editor.pendingConfirmation;
  const legacy = editor.querySelector("[data-confirm-action]")?.closest('[role="dialog"]');
  if (!confirmation || !legacy) return;
  const key = legacyDialogKey(confirmation);
  if (!key || editor.__sharedPhysicalConfirmationKey === key) {
    if (key) legacy.hidden = true;
    return;
  }

  legacy.hidden = true;
  editor.__sharedPhysicalConfirmationKey = key;
  openActionDialog({
    tone: "danger",
    title: confirmation.title,
    message: confirmation.detail,
    confirmLabel: confirmation.confirmLabel,
    cancelLabel: "Annulla",
  }).then((confirmed) => {
    if (editor.__sharedPhysicalConfirmationKey === key) editor.__sharedPhysicalConfirmationKey = null;
    if (!editor.isConnected || legacyDialogKey(editor.pendingConfirmation) !== key) return;
    const control = editor.querySelector(confirmed ? "[data-confirm-action]" : "[data-confirm-cancel]");
    control?.click();
    if (!confirmed) requestAnimationFrame(() => editor.querySelector("[data-back]")?.focus({ preventScroll: true }));
  });
}

function installRenderAdapter(constructor, flag, enhance) {
  const prototype = constructor.prototype;
  if (prototype[flag]) return;
  const render = prototype.render;
  prototype.render = function renderWithSharedFeedbackSurfaces(...args) {
    const result = render.apply(this, args);
    enhance(this);
    return result;
  };
  Object.defineProperty(prototype, flag, { value: true });
}

installRenderAdapter(ArtAroundNamespaceEditorView, "__sharedFeedbackSurfaces", (editor) => {
  replaceIssuePanels(editor);
  showNamespaceLeaveDialog(editor);
});

installRenderAdapter(ArtAroundPhysicalVocabularyEditorView, "__sharedFeedbackSurfaces", (editor) => {
  replaceIssuePanels(editor);
  showPhysicalConfirmationDialog(editor);
});

installRenderAdapter(ArtAroundItemAuthoringView, "__sharedFeedbackSurfaces", replaceIssuePanels);
installRenderAdapter(ArtAroundVisitAuthoringView, "__sharedFeedbackSurfaces", replaceIssuePanels);
