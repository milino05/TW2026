import { ArtAroundPhysicalVocabularyEditorView } from "./physical-vocabulary-editor-view.js";
import { icon } from "./icons.js";

/*
 * Namespace and Physical Vocabulary deliberately keep separate domain editors:
 * their fields and persistence rules are different. This adapter owns only the
 * common authoring shell so the two resources present the same interaction
 * grammar without duplicating domain logic.
 */

function has(operations, code) {
  return (operations || []).some((entry) => entry.code === code);
}

function enhancePhysicalVocabularyShell(editor) {
  const main = editor.querySelector(".physical-editor-page");
  const header = main?.querySelector(".physical-editor-header");
  const state = header?.querySelector(".physical-editor-state");
  const nav = main?.querySelector(".physical-editor-tabs");
  const section = main?.querySelector(".physical-editor-section");
  if (!main || !header || !state || !nav || !section) return;

  /* Header actions live in the same place as Namespace actions. */
  main.querySelector(".physical-overview-copy > .button-row")?.remove();

  const side = document.createElement("div");
  side.className = "namespace-editor-side";

  const actions = document.createElement("div");
  actions.className = "namespace-editor-actions";
  actions.innerHTML = `
    <button class="button-secondary" type="button" data-tutorial-start>${icon("info", { size: 16 })} Ripeti tutorial</button>
    <button type="button" data-starter-open ${has(editor.operations(), "physical_vocabulary.starter.apply") ? "" : "disabled"}>${icon("plus", { size: 16 })} Usa configurazione base</button>
  `;

  state.classList.add("namespace-editor-status");
  side.append(actions, state);
  header.append(side);

  /* Vertical tab semantics mirror the Namespace rail. */
  nav.setAttribute("role", "tablist");
  nav.setAttribute("aria-orientation", "vertical");
  for (const button of nav.querySelectorAll("[data-section]")) {
    const key = button.dataset.section;
    const selected = key === editor.activeSection;
    button.id = `physical-tab-${key}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(selected));
    button.setAttribute("aria-controls", `physical-${key}`);
    button.tabIndex = selected ? 0 : -1;
  }

  section.id ||= `physical-${editor.activeSection}`;
  section.setAttribute("role", "tabpanel");
  section.setAttribute("aria-labelledby", `physical-tab-${editor.activeSection}`);
}

const prototype = ArtAroundPhysicalVocabularyEditorView.prototype;
if (!prototype.__sharedVocabularyShellInstalled) {
  const renderPhysicalVocabulary = prototype.render;
  prototype.render = function renderWithSharedVocabularyShell(...args) {
    const result = renderPhysicalVocabulary.apply(this, args);
    if (this.data) enhancePhysicalVocabularyShell(this);
    return result;
  };
  Object.defineProperty(prototype, "__sharedVocabularyShellInstalled", { value: true });
}
