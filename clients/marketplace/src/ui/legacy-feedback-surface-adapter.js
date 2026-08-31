import { openActionDialog } from "./feedback-primitives.js";
import { ArtAroundNamespaceEditorView } from "./namespace-editor-view.js";
import { ArtAroundPhysicalVocabularyEditorView } from "./physical-vocabulary-editor-view.js";
import { ItemAuthoringView } from "./item-authoring-view.js";
import { ArtAroundVisitAuthoringView } from "./visit-authoring-view.js";

/*
 * Incremental migration for legacy feedback surfaces whose semantics are already
 * unambiguous. Complex workflow dialogs and contextual search/provider panels
 * stay specialized until they can be mapped without losing domain interaction.
 */
function replaceElement(legacy, tagName, tone, { role = null } = {}) {
  if (!legacy || legacy.tagName.toLowerCase() === tagName) return legacy;
  const replacement = document.createElement(tagName);
  replacement.setAttribute("tone", tone);
  if (role) replacement.setAttribute("role", role);
  replacement.className = legacy.className;
  replacement.innerHTML = legacy.innerHTML;
  for (const attribute of legacy.attributes) {
    if (!["class", "role"].includes(attribute.name)) replacement.setAttribute(attribute.name, attribute.value);
  }
  legacy.replaceWith(replacement);
  return replacement;
}

function replaceIssuePanels(root) {
  const standard = [
    ...root.querySelectorAll(".issue-panel:not(artaround-issue-panel)"),
    ...root.querySelectorAll(".namespace-workflow .issues:not(artaround-issue-panel)"),
  ];
  const physical = [...root.querySelectorAll(".physical-integrity--warning:not(artaround-issue-panel)")]
    .filter((legacy) => legacy.querySelector("ul"));
  for (const legacy of new Set([...standard, ...physical])) replaceElement(legacy, "artaround-issue-panel", "warning");
}

function replaceNamespaceWorkflowCallout(editor) {
  if (!editor.pendingWorkflow || editor.leaveConfirmation) return;
  const legacy = editor.querySelector(".namespace-confirmation");
  if (legacy) replaceElement(legacy, "artaround-callout", "warning");
}

function replaceItemBlockerCallout(editor) {
  const legacy = editor.querySelector(".blocker-panel:not(artaround-callout)");
  if (legacy) replaceElement(legacy, "artaround-callout", "warning");
}

/* These roots were audited individually. Their role=alert nodes represent
 * persistent page/form failures, therefore Inline Callout danger is correct.
 * Do not broaden this selector to every role=alert in Marketplace: the semantic
 * entity picker and domain-specific workflow surfaces remain contextual. */
const PERSISTENT_ERROR_ROOTS = [
  "artaround-create-hub-view",
  "artaround-venue-target-chooser",
  "artaround-home-view",
  "artaround-context-hub-view",
  "artaround-catalog-view",
];

function replaceKnownPersistentErrors(root = document) {
  for (const rootSelector of PERSISTENT_ERROR_ROOTS) {
    for (const legacy of root.querySelectorAll?.(`${rootSelector} [role="alert"]:not(artaround-callout):not(artaround-issue-panel)`) || []) {
      replaceElement(legacy, "artaround-callout", "danger", { role: "alert" });
    }
  }
}

function installPersistentErrorObserver() {
  const start = () => {
    replaceKnownPersistentErrors(document);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          replaceKnownPersistentErrors(node.matches(PERSISTENT_ERROR_ROOTS.join(",")) ? node.parentElement || document : node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
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
  replaceNamespaceWorkflowCallout(editor);
  showNamespaceLeaveDialog(editor);
});

installRenderAdapter(ArtAroundPhysicalVocabularyEditorView, "__sharedFeedbackSurfaces", (editor) => {
  replaceIssuePanels(editor);
  showPhysicalConfirmationDialog(editor);
});

installRenderAdapter(ItemAuthoringView, "__sharedFeedbackSurfaces", (editor) => {
  replaceIssuePanels(editor);
  replaceItemBlockerCallout(editor);
});

installRenderAdapter(ArtAroundVisitAuthoringView, "__sharedFeedbackSurfaces", replaceIssuePanels);
installPersistentErrorObserver();
