import { ArtAroundNamespaceEditorView } from "./namespace-editor-view.js";
import { ArtAroundPhysicalVocabularyEditorView } from "./physical-vocabulary-editor-view.js";
import "./revision-workflow-controls.js";

function normalizedText(element) {
  return String(element?.textContent || "").replace(/\s+/g, " ").trim();
}

function projectWorkflow(editor, {
  rowSelector,
  buttonSelector,
  operationAttribute,
  availableOperations,
}) {
  const legacyRow = editor.querySelector(rowSelector);
  if (!(legacyRow instanceof HTMLElement)) return;
  const legacyButtons = [...legacyRow.querySelectorAll(buttonSelector)].filter((button) => button instanceof HTMLButtonElement);
  if (!legacyButtons.length) return;

  const legacyByCode = new Map(legacyButtons.map((button) => [String(button.dataset[operationAttribute] || ""), button]));
  const operations = (availableOperations || []).filter((operation) => legacyByCode.has(String(operation?.code || "")));
  if (!operations.length) return;

  const controls = document.createElement("artaround-revision-workflow-controls");
  controls.setAttribute("actions-only", "");
  controls.dataset.artaroundLegacyProjection = "revision-workflow";
  controls.toggleAttribute("busy", Boolean(editor.busy));
  controls.presentationOverrides = Object.fromEntries(legacyButtons.map((button) => [
    String(button.dataset[operationAttribute] || ""),
    { label: normalizedText(button) },
  ]).filter(([code]) => code));
  controls.availableOperations = operations;
  controls.addEventListener("artaround:revision-workflow-operation", (event) => {
    const code = String(event.detail?.operation?.code || "");
    const legacy = legacyByCode.get(code);
    if (!legacy || legacy.disabled || !editor.isConnected) return;
    legacy.click();
  });

  legacyRow.hidden = true;
  legacyRow.setAttribute("aria-hidden", "true");
  legacyRow.before(controls);
}

function installRenderProjection(constructor, flag, projector) {
  const prototype = constructor.prototype;
  if (prototype[flag]) return;
  const render = prototype.render;
  prototype.render = function renderWithSharedRevisionWorkflow(...args) {
    const result = render.apply(this, args);
    projector(this);
    return result;
  };
  Object.defineProperty(prototype, flag, { value: true });
}

installRenderProjection(ArtAroundNamespaceEditorView, "__sharedRevisionWorkflowProjection", (editor) => {
  projectWorkflow(editor, {
    rowSelector: ".namespace-workflow > .button-row",
    buttonSelector: "button[data-operation]",
    operationAttribute: "operation",
    availableOperations: editor.data?.availableOperations || [],
  });
});

installRenderProjection(ArtAroundPhysicalVocabularyEditorView, "__sharedRevisionWorkflowProjection", (editor) => {
  projectWorkflow(editor, {
    rowSelector: ".physical-workflow > .button-row",
    buttonSelector: "button[data-workflow]",
    operationAttribute: "workflow",
    availableOperations: editor.operations?.() || [],
  });
});
