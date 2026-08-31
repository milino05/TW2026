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

function definitionKey(field, definition, index) {
  return `${field}:${definition?.definitionId || index}`;
}

function tabLabel(nav, section) {
  return nav.querySelector(`[data-section="${section}"] span`)?.textContent?.trim() || section;
}

function openDefinition(editor, key) {
  editor.__sharedPhysicalEditingDefinitionKey = key;
  editor.__sharedPhysicalFocusDefinitionKey = key;
  editor.render();
}

function alignSectionHierarchy(editor, nav, section) {
  section.classList.add("namespace-section");

  if (editor.activeSection === "general") {
    const heading = document.createElement("div");
    heading.className = "section-heading physical-shared-general-heading";
    heading.innerHTML = `<div><span class="eyebrow">Generale</span><h2>Identità e controllo</h2><p>Configura l'identità del vocabolario fisico e controlla quando la revisione è pronta per essere usata dalle sedi.</p></div>`;
    section.prepend(heading);
    return;
  }

  const intro = section.querySelector(".physical-section-intro");
  if (!intro) return;
  intro.classList.add("section-heading");
  const heading = intro.querySelector("h2");
  const question = heading?.textContent?.trim() || "";
  const description = [...intro.querySelectorAll("p")].find((entry) => !entry.classList.contains("physical-example"))?.textContent?.trim() || "";
  const label = tabLabel(nav, editor.activeSection);
  const eyebrow = intro.querySelector(".eyebrow");
  if (eyebrow) eyebrow.textContent = editor.activeSection === "mappings" ? "Interoperabilità" : label;
  if (heading) heading.textContent = label;

  if (editor.activeSection === "mappings") {
    section.querySelector(".physical-mapping-list")?.classList.add("namespace-mapping-grid");
    for (const card of section.querySelectorAll(".physical-mapping-card")) card.classList.add("namespace-mapping-card");
    return;
  }

  const example = intro.querySelector(".physical-example");
  const guidance = document.createElement("div");
  guidance.className = "namespace-guidance physical-shared-guidance";
  const marker = document.createElement("span");
  marker.innerHTML = icon("info", { size: 20 });
  const copy = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = question;
  const paragraph = document.createElement("p");
  paragraph.textContent = description;
  copy.append(strong, paragraph);
  if (example) {
    const small = document.createElement("small");
    small.textContent = example.textContent?.trim() || "";
    copy.append(small);
    example.remove();
  }
  guidance.append(marker, copy);
  intro.after(guidance);
}

function enhanceDefinitionDisclosure(editor, main) {
  const grid = main.querySelector(".physical-definition-grid");
  if (!grid) return;
  grid.classList.add("namespace-definition-list");

  const pendingField = editor.__sharedPhysicalOpenAfterAdd;
  if (pendingField && pendingField === editor.activeSection) {
    const index = (editor.definitions[pendingField]?.length || 0) - 1;
    if (index >= 0) {
      const definition = editor.definitions[pendingField][index];
      const key = definitionKey(pendingField, definition, index);
      editor.__sharedPhysicalEditingDefinitionKey = key;
      editor.__sharedPhysicalFocusDefinitionKey = key;
    }
    editor.__sharedPhysicalOpenAfterAdd = null;
  }

  for (const card of grid.querySelectorAll(".physical-definition-card")) {
    const control = card.querySelector("[data-collection][data-index]");
    if (!control) continue;
    const field = control.dataset.collection;
    const index = Number(control.dataset.index);
    const definition = editor.definition(field, index);
    if (!definition) continue;
    const key = definitionKey(field, definition, index);
    const expanded = editor.canEdit() && editor.__sharedPhysicalEditingDefinitionKey === key;
    const remove = card.querySelector("[data-remove-definition]");

    card.classList.add("namespace-definition");
    card.classList.toggle("namespace-definition--collapsed", !expanded);
    card.dataset.definitionKey = key;
    card.dataset.expanded = String(expanded);

    for (const child of [...card.children]) {
      if (child.tagName !== "HEADER") child.hidden = !expanded;
    }

    const header = card.querySelector(":scope > header");
    const heading = header?.querySelector(":scope > div");
    if (!expanded) {
      card.setAttribute("role", "button");
      card.tabIndex = editor.canEdit() ? 0 : -1;
      card.setAttribute("aria-expanded", "false");
      if (remove) remove.hidden = true;
      if (heading) {
        const summary = document.createElement("div");
        summary.className = "namespace-definition-summary";
        const description = document.createElement("p");
        description.textContent = definition.description || (definition.label ? "Nessuna descrizione aggiunta." : "Definizione da completare.");
        summary.append(description);
        heading.append(summary);
      }
    } else {
      card.removeAttribute("role");
      card.removeAttribute("tabindex");
      card.setAttribute("aria-expanded", "true");
      if (remove) {
        remove.hidden = false;
        remove.classList.remove("icon-danger");
        remove.classList.add("danger", "small");
        remove.innerHTML = `${icon("trash", { size: 15 })} Rimuovi`;
      }
    }
  }

  const focusKey = editor.__sharedPhysicalFocusDefinitionKey;
  if (focusKey) {
    editor.__sharedPhysicalFocusDefinitionKey = null;
    requestAnimationFrame(() => editor.querySelector(`[data-definition-key="${focusKey}"] [data-property="label"]`)?.focus({ preventScroll: true }));
  }
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

  nav.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const tabs = [...nav.querySelectorAll("[data-section]")];
    const current = tabs.indexOf(document.activeElement);
    if (current < 0 || !tabs.length) return;
    event.preventDefault();
    let nextIndex = current;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else if (event.key === "ArrowDown") nextIndex = (current + 1) % tabs.length;
    else nextIndex = (current - 1 + tabs.length) % tabs.length;
    const nextSection = tabs[nextIndex].dataset.section;
    editor.goToSection(nextSection);
    requestAnimationFrame(() => editor.querySelector(`#physical-tab-${nextSection}`)?.focus({ preventScroll: true }));
  });

  section.id ||= `physical-${editor.activeSection}`;
  section.setAttribute("role", "tabpanel");
  section.setAttribute("aria-labelledby", `physical-tab-${editor.activeSection}`);
  alignSectionHierarchy(editor, nav, section);
  enhanceDefinitionDisclosure(editor, main);

  main.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const add = target.closest("[data-add-definition]");
    if (add) editor.__sharedPhysicalOpenAfterAdd = add.dataset.addDefinition;
    const card = target.closest(".physical-definition-card.namespace-definition--collapsed");
    if (!card || !editor.canEdit() || target.closest("button,input,select,textarea,label,a,details,summary")) return;
    event.preventDefault();
    event.stopPropagation();
    openDefinition(editor, card.dataset.definitionKey);
  });

  main.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    const card = event.target instanceof Element ? event.target.closest(".physical-definition-card.namespace-definition--collapsed") : null;
    if (!card || event.target !== card || !editor.canEdit()) return;
    event.preventDefault();
    event.stopPropagation();
    openDefinition(editor, card.dataset.definitionKey);
  });
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
