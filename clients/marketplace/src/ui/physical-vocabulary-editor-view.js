import { navigate, replaceCurrentHistoryUrl } from "../application/router.js";
import { managementRepository } from "../infrastructure/http/management-repository.js";
import { icon } from "./icons.js";

const SECTIONS = [
  ["general", "Generale"],
  ["placeTypes", "Tipi di luogo"],
  ["connectionTypes", "Tipi di collegamento"],
  ["physicalAttributes", "Caratteristiche fisiche"],
  ["routingProfiles", "Profili di percorso"],
  ["mappings", "Mapping esterni"],
];
const DEFINITION_FIELDS = ["placeTypes", "connectionTypes", "physicalAttributes", "routingProfiles"];
const META = {
  placeTypes: {
    title: "Tipi di luogo", singular: "tipo di luogo",
    question: "Che tipo di spazio può riconoscere una sede?",
    description: "Definisci categorie riutilizzabili come ingresso, sala, ascensore o servizi. Le sedi useranno queste definizioni senza copiarle.",
    example: "Ingresso · punto ordinario di accesso alla sede.",
  },
  connectionTypes: {
    title: "Tipi di collegamento", singular: "tipo di collegamento",
    question: "Come possono essere collegati due luoghi?",
    description: "Descrivi passaggi, corridoi, porte, rampe, scale e altri collegamenti fisici usati nella mappa.",
    example: "Corridoio · collegamento interno lineare tra ambienti.",
  },
  physicalAttributes: {
    title: "Caratteristiche fisiche", singular: "caratteristica fisica",
    question: "Quali fatti fisici servono al routing?",
    description: "Definisci caratteristiche verificabili di luoghi e collegamenti: gradini, larghezza, superficie, accessibilità e altre proprietà.",
    example: "Accessibile senza gradini · sì/no/non verificato nel layout.",
  },
  routingProfiles: {
    title: "Profili di percorso", singular: "profilo di percorso",
    question: "Come deve comportarsi il routing in una situazione ricorrente?",
    description: "Combina caratteristiche fisiche in preferenze, requisiti o elementi da evitare, senza hardcodare il museo nel motore di routing.",
    example: "Senza gradini · richiede passaggi compatibili con l'accessibilità selezionata.",
  },
};
const TUTORIAL_STORAGE_KEY = "artaround.physical-vocabulary-editor.tutorial.v2";
const TUTORIAL_STEPS = [
  { section: "general", title: "A cosa serve il vocabolario fisico?", body: "È il linguaggio condiviso con cui ArtAround descrive spazi, collegamenti e caratteristiche di una sede. Le sedi dell'organizzazione possono riutilizzarlo senza ridefinire ogni volta gli stessi concetti.", target: '[data-physical-tutorial-anchor="overview"]' },
  { section: "general", title: "Un passaggio alla volta", body: "Usa queste sezioni come un percorso. I numeri indicano quante definizioni hai già aggiunto; puoi tornare su ogni sezione in qualsiasi momento.", target: '[data-physical-tutorial-anchor="sections"]' },
  { section: "placeTypes", title: "1. Definisci i tipi di luogo", body: "Indica che cosa può rappresentare un punto sulla mappa: sala, ingresso, servizi o ascensore. Sono categorie riutilizzabili, non i luoghi reali di una singola sede.", target: "#physical-placeTypes" },
  { section: "connectionTypes", title: "2. Descrivi i collegamenti", body: "Spiega come possono essere connessi due luoghi: corridoio, porta, rampa o scala. Il collegamento concreto verrà poi disegnato nella sede.", target: "#physical-connectionTypes" },
  { section: "physicalAttributes", title: "3. Aggiungi le caratteristiche fisiche", body: "Definisci fatti verificabili utili al percorso, come la presenza di gradini o la larghezza di un passaggio. Un valore assente significa non verificato, non falso.", target: "#physical-physicalAttributes" },
  { section: "routingProfiles", title: "4. Crea profili di percorso", body: "Combina le caratteristiche in requisiti e preferenze riutilizzabili, per esempio un percorso senza gradini o adatto a passaggi larghi.", target: "#physical-routingProfiles" },
  { section: "mappings", title: "5. Collega concetti esterni", body: "Gli alias aiutano il linguaggio umano; i mapping riconoscono concetti equivalenti in vocabolari esterni senza cambiare l'identità delle definizioni locali.", target: "#physical-mappings" },
  { section: "general", title: "Controlla, poi pubblica", body: "Torna in Generale, controlla la consistenza e pubblica. Le sedi useranno una revisione precisa e stabile del vocabolario.", target: '[data-physical-tutorial-anchor="workflow"]' },
  { section: "general", title: "Vuoi partire da una configurazione pronta?", body: "Puoi aggiungere la configurazione base ArtAround con tipi di luogo, collegamenti, caratteristiche e profili già pronti. Potrai modificarla liberamente e le definizioni già presenti non verranno sovrascritte.", target: null, starter: true },
];
const WORKFLOW_ACTION = {
  "physical_vocabulary.revision.check": "check-consistency",
  "physical_vocabulary.revision.request_review": "request-review",
  "physical_vocabulary.revision.withdraw_review": "withdraw-review",
  "physical_vocabulary.revision.request_changes": "request-changes",
  "physical_vocabulary.revision.publish": "publish",
};
const WORKFLOW_LABEL = {
  "physical_vocabulary.revision.check": "Controlla consistenza",
  "physical_vocabulary.revision.request_review": "Invia in revisione",
  "physical_vocabulary.revision.withdraw_review": "Ritira dalla revisione",
  "physical_vocabulary.revision.request_changes": "Richiedi modifiche",
  "physical_vocabulary.revision.publish": "Pubblica",
};
const MATCH_LABEL = { exact: "Equivalente", close: "Molto vicino", broader: "Più generale", narrower: "Più specifico" };
const OPERATOR_LABEL = { eq: "è", neq: "non è", gte: "almeno", lte: "al massimo", gt: "maggiore di", lt: "minore di", in: "è uno di" };
const PRIORITY_LABEL = { required: "Necessario", preferred: "Preferito", avoid: "Da evitare" };

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function selected(value, current) { return String(value ?? "") === String(current ?? "") ? "selected" : ""; }
function checked(value) { return value === true ? "checked" : ""; }
function has(operations, code) { return (operations || []).some((entry) => entry.code === code); }
function physicalVocabularyId() { return new URLSearchParams(window.location.search).get("physicalVocabularyId"); }
function uuid() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function clone(value) { return globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
function statusLabel(status) { return { draft: "Bozza", in_review: "In revisione", changes_requested: "Modifiche richieste", published: "Pubblicata", superseded: "Superata" }[status] || status || "Da configurare"; }
function sourceLabel(source) { return source === "working" ? "Bozza di lavoro" : source === "published" ? "Versione pubblicata" : "Non configurato"; }
function ownerBackUrl(owner) { return owner?.type === "organization" ? `/organizations/detail?organizationId=${encodeURIComponent(owner.id)}&section=physical` : "/profile#account-physical"; }
function requestedReturnUrl() {
  const value = new URLSearchParams(window.location.search).get("returnTo");
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  try {
    const resolved = new URL(value, window.location.origin);
    if (resolved.origin !== window.location.origin) return null;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch { return null; }
}
function physicalVocabularyBackUrl(owner) { return requestedReturnUrl() || ownerBackUrl(owner); }
function initialSection() { const requested = String(window.location.hash || "").replace(/^#physical-/, ""); return SECTIONS.some(([key]) => key === requested) ? requested : "general"; }
function localAliases(definition) { return (definition.localizations || []).find((entry) => String(entry.locale).toLowerCase().startsWith("it"))?.aliases || []; }
function replaceAliases(definition, aliases) {
  const localizations = clone(definition.localizations || []);
  const index = localizations.findIndex((entry) => String(entry.locale).toLowerCase().startsWith("it"));
  if (index >= 0) localizations[index] = { ...localizations[index], aliases };
  else localizations.push({ locale: "it-IT", aliases });
  definition.localizations = localizations;
}
function splitAliases(value) { return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean); }
function optionsText(options = []) { return options.map((entry) => `${entry.value} = ${entry.label}`).join("\n"); }
function parseOptions(value) {
  return String(value || "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const separator = line.indexOf("=");
    return separator < 0
      ? { value: line, label: line }
      : { value: line.slice(0, separator).trim(), label: line.slice(separator + 1).trim() };
  }).filter((entry) => entry.value && entry.label);
}
function valueForInput(value) { return Array.isArray(value) ? value.join(", ") : value === undefined || value === null ? "" : String(value); }
function parseRequirementValue(raw, attribute, operator) {
  const value = String(raw ?? "").trim();
  if (operator === "in") return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (attribute?.dataType === "boolean") return value === "true";
  if (attribute?.dataType === "number") { const number = Number(value); return Number.isFinite(number) ? number : value; }
  return value;
}
function defaultRequirementValue(attribute) {
  if (!attribute) return "";
  if (attribute.dataType === "boolean") return true;
  if (attribute.dataType === "number") return 0;
  if (attribute.dataType === "choice") return attribute.options?.[0]?.value || "";
  return "";
}
function emptyDefinition(field) {
  const base = { definitionId: uuid(), key: null, label: "", description: "", localizations: [], semanticRefs: [], metadata: {} };
  if (field === "physicalAttributes") return { ...base, dataType: "boolean", unit: null, options: [], appliesTo: "both" };
  if (field === "routingProfiles") return { ...base, requirements: [] };
  if (field === "placeTypes") base.metadata = { navigationTarget: true };
  return base;
}
function definitionName(definition) { return definition.label || definition.key || "Nuova definizione"; }

export class ArtAroundPhysicalVocabularyEditorView extends HTMLElement {
  id = physicalVocabularyId();
  data = null;
  definitions = Object.fromEntries(DEFINITION_FIELDS.map((field) => [field, []]));
  activeSection = initialSection();
  busy = false;
  error = null;
  message = null;
  dirty = false;
  tutorialOpen = false;
  tutorialStep = 0;
  tutorialReturnSection = "general";
  starterOpen = false;
  pendingWorkflow = null;
  workflowMessage = "";
  pendingConfirmation = null;

  connectedCallback() {
    this.addEventListener("click", this.onClick);
    this.addEventListener("keydown", this.onKeyDown);
    this.addEventListener("input", this.onInput);
    this.addEventListener("change", this.onInput);
    this.addEventListener("submit", this.onSubmit);
    this.addEventListener("wheel", this.onTutorialScroll, { passive: false });
    this.addEventListener("touchmove", this.onTutorialScroll, { passive: false });
    window.addEventListener("beforeunload", this.onBeforeUnload);
    window.addEventListener("resize", this.onTutorialViewportChange);
    this.load();
  }
  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("keydown", this.onKeyDown);
    this.removeEventListener("input", this.onInput);
    this.removeEventListener("change", this.onInput);
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("wheel", this.onTutorialScroll);
    this.removeEventListener("touchmove", this.onTutorialScroll);
    window.removeEventListener("beforeunload", this.onBeforeUnload);
    window.removeEventListener("resize", this.onTutorialViewportChange);
    document.documentElement.classList.remove("physical-overlay-open");
    document.body?.classList.remove("physical-overlay-open");
  }
  onBeforeUnload = (event) => { if (this.dirty) { event.preventDefault(); event.returnValue = ""; } };

  async load({ preserveMessage = true } = {}) {
    if (!this.id) { this.error = "Vocabolario fisico non specificato"; this.render(); return; }
    this.busy = true; this.error = null; if (!preserveMessage) this.message = null; this.render();
    try {
      this.data = await managementRepository.physicalVocabulary(this.id);
      const source = this.data.revision?.definitions || {};
      this.definitions = Object.fromEntries(DEFINITION_FIELDS.map((field) => [field, clone(source[field] || [])]));
      this.dirty = false;
      if (this.shouldStartTutorial()) this.startTutorial({ remember: true });
    } catch (error) { this.error = error instanceof Error ? error.message : "Vocabolario fisico non disponibile"; }
    finally { this.busy = false; this.render(); }
  }
  async execute(callback, message) {
    this.busy = true; this.error = null; this.message = null; this.render();
    try { await callback(); this.message = message; await this.load(); }
    catch (error) { this.error = error instanceof Error ? error.message : "Operazione non riuscita"; this.busy = false; this.render(); }
  }
  shouldStartTutorial() {
    if (!this.data?.revision || this.data.revision.version !== 1 || this.data.revision.status !== "draft") return false;
    if (DEFINITION_FIELDS.some((field) => (this.data.revision.definitions?.[field] || []).length)) return false;
    try { return localStorage.getItem(TUTORIAL_STORAGE_KEY) !== "seen"; } catch { return false; }
  }
  startTutorial({ remember = false } = {}) {
    this.tutorialReturnSection = this.activeSection; this.tutorialStep = 0; this.tutorialOpen = true; this.starterOpen = false; this.activeSection = TUTORIAL_STEPS[0].section;
    if (remember) { try { localStorage.setItem(TUTORIAL_STORAGE_KEY, "seen"); } catch { /* non bloccante */ } }
    this.render();
  }
  closeTutorial() { this.tutorialOpen = false; this.tutorialStep = 0; this.activeSection = this.tutorialReturnSection || "general"; this.render(); }
  setTutorialStep(step) {
    this.tutorialStep = Math.max(0, Math.min(TUTORIAL_STEPS.length - 1, step));
    this.activeSection = TUTORIAL_STEPS[this.tutorialStep].section || "general";
    this.render();
  }
  syncOverlayLock() {
    const locked = this.tutorialOpen || this.starterOpen || this.pendingWorkflow || this.pendingConfirmation;
    document.documentElement.classList.toggle("physical-overlay-open", Boolean(locked));
    document.body?.classList.toggle("physical-overlay-open", Boolean(locked));
  }
  onTutorialScroll = (event) => { if (this.tutorialOpen) event.preventDefault(); };
  onTutorialViewportChange = () => { if (this.tutorialOpen) requestAnimationFrame(() => this.positionTutorial()); };
  onKeyDown = (event) => {
    const modal = this.querySelector('[aria-modal="true"]');
    if (!modal) return;
    if (event.key === "Escape") { event.preventDefault(); this.tutorialOpen ? this.closeTutorial() : (this.starterOpen = false, this.pendingWorkflow = null, this.pendingConfirmation = null, this.render()); return; }
    if (event.key !== "Tab") return;
    const focusable = [...modal.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  positionTutorial() {
    const overlay = this.querySelector("[data-physical-tutorial-overlay]");
    const bubble = overlay?.querySelector("[data-physical-tutorial-bubble]");
    const spotlight = overlay?.querySelector("[data-physical-tutorial-spotlight]");
    const step = TUTORIAL_STEPS[this.tutorialStep];
    if (!overlay || !bubble || !spotlight || !step) return;
    const target = step.target ? this.querySelector(step.target) : null;
    if (!target) { overlay.dataset.centered = "true"; bubble.querySelector("button")?.focus(); return; }
    delete overlay.dataset.centered;
    delete overlay.dataset.mobile;
    target.scrollIntoView({ behavior: "auto", block: "center" });
    const expectedStep = this.tutorialStep;
    requestAnimationFrame(() => {
      if (!this.tutorialOpen || this.tutorialStep !== expectedStep || !target.isConnected) return;
      this.placeTutorial(target);
    });
  }
  placeTutorial(target) {
    const overlay = this.querySelector("[data-physical-tutorial-overlay]");
    const bubble = overlay?.querySelector("[data-physical-tutorial-bubble]");
    const spotlight = overlay?.querySelector("[data-physical-tutorial-spotlight]");
    if (!overlay || !bubble || !spotlight) return;
    const rect = target.getBoundingClientRect(); const padding = 8; const viewportWidth = window.innerWidth; const viewportHeight = window.innerHeight;
    const highlight = { left: Math.max(6, rect.left - padding), top: Math.max(6, rect.top - padding), right: Math.min(viewportWidth - 6, rect.right + padding), bottom: Math.min(viewportHeight - 6, rect.bottom + padding) };
    highlight.width = Math.max(1, highlight.right - highlight.left); highlight.height = Math.max(1, highlight.bottom - highlight.top);
    Object.assign(spotlight.style, { left: `${highlight.left}px`, top: `${highlight.top}px`, width: `${highlight.width}px`, height: `${highlight.height}px` });
    if (viewportWidth <= 720) { overlay.dataset.mobile = "true"; bubble.querySelector("button")?.focus(); return; }
    const gap = 20; const bubbleWidth = bubble.offsetWidth; const bubbleHeight = bubble.offsetHeight; let left; let top; let side;
    if (viewportWidth - highlight.right >= bubbleWidth + gap) { side = "right"; left = highlight.right + gap; top = highlight.top + highlight.height / 2 - bubbleHeight / 2; }
    else if (highlight.left >= bubbleWidth + gap + 16) { side = "left"; left = highlight.left - bubbleWidth - gap; top = highlight.top + highlight.height / 2 - bubbleHeight / 2; }
    else if (viewportHeight - highlight.bottom >= bubbleHeight + gap) { side = "bottom"; left = highlight.left + highlight.width / 2 - bubbleWidth / 2; top = highlight.bottom + gap; }
    else if (highlight.top >= bubbleHeight + gap + 16) { side = "top"; left = highlight.left + highlight.width / 2 - bubbleWidth / 2; top = highlight.top - bubbleHeight - gap; }
    else { side = "floating"; left = viewportWidth - bubbleWidth - 16; top = viewportHeight - bubbleHeight - 16; }
    bubble.dataset.side = side;
    Object.assign(bubble.style, { left: `${Math.max(16, Math.min(viewportWidth - bubbleWidth - 16, left))}px`, top: `${Math.max(16, Math.min(viewportHeight - bubbleHeight - 16, top))}px` });
    bubble.querySelector("button")?.focus();
  }
  goToSection(section) {
    if (!SECTIONS.some(([key]) => key === section)) return;
    this.activeSection = section;
    replaceCurrentHistoryUrl(`${window.location.pathname}${window.location.search}#physical-${section}`);
    this.render();
  }
  definition(field, index) { return this.definitions[field]?.[Number(index)] || null; }
  allDefinitionsPayload() { return Object.fromEntries(DEFINITION_FIELDS.map((field) => [field, this.definitions[field]])); }

  onInput = (event) => {
    const input = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement ? event.target : null;
    if (!input) return;
    if (input.matches("[data-workflow-message-input]")) { this.workflowMessage = input.value; return; }
    if (input.closest("[data-metadata-form]")) { this.markDirty(); return; }
    if (!input.dataset.collection) return;
    const definition = this.definition(input.dataset.collection, input.dataset.index);
    if (!definition) return;
    const property = input.dataset.property;
    if (property === "label" || property === "description") definition[property] = input.value;
    else if (property === "aliases") replaceAliases(definition, splitAliases(input.value));
    else if (property === "key") definition.key = input.value.trim() || null;
    else if (property === "navigationTarget") definition.metadata = { ...(definition.metadata || {}), navigationTarget: input.checked };
    else if (property === "dataType") { definition.dataType = input.value; if (input.value !== "choice") definition.options = []; }
    else if (property === "appliesTo") definition.appliesTo = input.value;
    else if (property === "unit") definition.unit = input.value.trim() || null;
    else if (property === "options") definition.options = parseOptions(input.value);
    else if (property?.startsWith("requirement.")) {
      const requirement = definition.requirements?.[Number(input.dataset.requirementIndex)];
      if (!requirement) return;
      const requirementProperty = property.split(".")[1];
      if (requirementProperty === "physicalAttributeDefinitionId") {
        requirement.physicalAttributeDefinitionId = input.value;
        const attribute = this.definitions.physicalAttributes.find((entry) => entry.definitionId === input.value);
        requirement.value = defaultRequirementValue(attribute);
        requirement.operator = "eq";
      } else if (requirementProperty === "operator" || requirementProperty === "priority") requirement[requirementProperty] = input.value;
      else if (requirementProperty === "weight") requirement.weight = Math.max(0, Number(input.value) || 0);
      else if (requirementProperty === "value") {
        const attribute = this.definitions.physicalAttributes.find((entry) => entry.definitionId === requirement.physicalAttributeDefinitionId);
        requirement.value = parseRequirementValue(input.value, attribute, requirement.operator);
      }
    }
    this.markDirty();
  };

  markDirty() {
    this.dirty = true;
    const indicator = this.querySelector("[data-dirty-indicator]");
    if (indicator) indicator.innerHTML = `<em>${icon("warning", { size: 14 })} Modifiche non salvate</em>`;
  }

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("[data-back]")) {
      if (this.dirty) {
        this.pendingConfirmation = {
          type: "leave",
          title: "Uscire senza salvare?",
          detail: "Le modifiche non ancora salvate in questa bozza andranno perse.",
          confirmLabel: "Esci senza salvare",
        };
        this.render();
        return;
      }
      navigate(physicalVocabularyBackUrl(this.data?.physicalVocabulary?.owner)); return;
    }
    if (target.closest("[data-confirm-cancel]")) { this.pendingConfirmation = null; this.render(); return; }
    if (target.closest("[data-confirm-action]") && this.pendingConfirmation) {
      const confirmation = this.pendingConfirmation;
      this.pendingConfirmation = null;
      if (confirmation.type === "leave") { navigate(physicalVocabularyBackUrl(this.data?.physicalVocabulary?.owner)); return; }
      if (confirmation.type === "remove-definition") {
        const definition = this.definition(confirmation.field, confirmation.index);
        if (!definition || definition.definitionId !== confirmation.definitionId) { this.render(); return; }
        this.definitions[confirmation.field].splice(confirmation.index, 1);
        if (confirmation.field === "physicalAttributes") {
          this.definitions.routingProfiles.forEach((profile) => {
            profile.requirements = (profile.requirements || []).filter((entry) => entry.physicalAttributeDefinitionId !== confirmation.definitionId);
          });
        }
        this.dirty = true;
        this.render();
        return;
      }
    }
    const sectionButton = target.closest("[data-section]");
    if (sectionButton) { this.goToSection(sectionButton.dataset.section); return; }
    if (target.closest("[data-tutorial-start]")) { this.startTutorial(); return; }
    if (target.closest("[data-tutorial-close], [data-tutorial-finish]")) { this.closeTutorial(); return; }
    if (target.closest("[data-tutorial-next]")) { this.setTutorialStep(this.tutorialStep + 1); return; }
    if (target.closest("[data-tutorial-prev]")) { this.setTutorialStep(this.tutorialStep - 1); return; }
    if (target.closest("[data-starter-open]")) { this.starterOpen = true; this.tutorialOpen = false; this.render(); return; }
    if (target.closest("[data-starter-close]")) { this.starterOpen = false; this.render(); return; }
    if (target.closest("[data-starter-apply]")) { this.starterOpen = false; this.tutorialOpen = false; this.activeSection = "general"; await this.execute(() => managementRepository.applyPhysicalVocabularyStarter(this.id), "Configurazione base applicata senza sovrascrivere le definizioni esistenti."); return; }
    if (target.closest("[data-working-ensure]")) { await this.execute(() => managementRepository.ensurePhysicalVocabularyWorking(this.id), "Nuova bozza creata dalla versione pubblicata."); return; }
    const add = target.closest("[data-add-definition]");
    if (add) { this.definitions[add.dataset.addDefinition].push(emptyDefinition(add.dataset.addDefinition)); this.dirty = true; this.render(); return; }
    const remove = target.closest("[data-remove-definition]");
    if (remove) {
      const field = remove.dataset.removeDefinition; const index = Number(remove.dataset.index); const definition = this.definitions[field][index];
      if (!definition) return;
      this.pendingConfirmation = {
        type: "remove-definition",
        field,
        index,
        definitionId: definition.definitionId,
        title: `Rimuovere “${definitionName(definition)}”?`,
        detail: field === "physicalAttributes"
          ? "La definizione verrà rimossa dalla bozza insieme ai riferimenti presenti nei profili di percorso."
          : "La definizione verrà rimossa dalla bozza. La modifica diventerà effettiva soltanto al salvataggio.",
        confirmLabel: "Rimuovi dalla bozza",
      };
      this.render();
      return;
    }
    const addRequirement = target.closest("[data-add-requirement]");
    if (addRequirement) {
      const profile = this.definition("routingProfiles", addRequirement.dataset.index); const attribute = this.definitions.physicalAttributes[0];
      if (!profile || !attribute) return;
      profile.requirements ||= [];
      profile.requirements.push({ physicalAttributeDefinitionId: attribute.definitionId, operator: "eq", value: defaultRequirementValue(attribute), priority: "preferred", weight: 1 });
      this.dirty = true; this.render(); return;
    }
    const removeRequirement = target.closest("[data-remove-requirement]");
    if (removeRequirement) { this.definition("routingProfiles", removeRequirement.dataset.index)?.requirements?.splice(Number(removeRequirement.dataset.requirementIndex), 1); this.dirty = true; this.render(); return; }
    const removeMapping = target.closest("[data-remove-mapping]");
    if (removeMapping) { this.definition(removeMapping.dataset.collection, removeMapping.dataset.index)?.semanticRefs?.splice(Number(removeMapping.dataset.mappingIndex), 1); this.dirty = true; this.render(); return; }
    if (target.closest("[data-save-mappings]")) { await this.execute(() => managementRepository.updatePhysicalVocabularyRevision(this.id, this.allDefinitionsPayload()), "Mapping esterni salvati."); return; }
    const workflow = target.closest("[data-workflow]");
    if (workflow) {
      const operation = workflow.dataset.workflow;
      if (operation === "physical_vocabulary.revision.request_changes") { this.pendingWorkflow = operation; this.workflowMessage = ""; this.render(); return; }
      await this.runWorkflow(operation); return;
    }
    if (target.closest("[data-workflow-cancel]")) { this.pendingWorkflow = null; this.workflowMessage = ""; this.render(); return; }
    if (target.closest("[data-workflow-confirm]")) { if (!this.workflowMessage.trim()) { this.error = "Inserisci il motivo delle modifiche richieste."; this.render(); return; } await this.runWorkflow(this.pendingWorkflow, { message: this.workflowMessage.trim() }); }
  };

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    event.preventDefault(); const formData = new FormData(form);
    if (form.matches("[data-metadata-form]")) {
      await this.execute(() => managementRepository.updatePhysicalVocabulary(this.id, { name: String(formData.get("name") || "").trim(), description: String(formData.get("description") || "").trim() }), "Dettagli del vocabolario salvati."); return;
    }
    if (form.matches("[data-save-definitions]")) {
      const field = form.dataset.saveDefinitions;
      await this.execute(() => managementRepository.updatePhysicalVocabularyRevision(this.id, { [field]: this.definitions[field] }), `${META[field].title} salvati.`); return;
    }
    if (form.matches("[data-add-mapping]")) {
      const field = String(formData.get("collection") || ""); const index = Number(formData.get("index")); const definition = this.definition(field, index);
      const scheme = String(formData.get("scheme") || "").trim().toLowerCase(); const id = String(formData.get("id") || "").trim(); const matchType = String(formData.get("matchType") || "exact");
      if (!definition || !scheme || !id) return;
      definition.semanticRefs ||= []; definition.semanticRefs.push({ scheme, id, matchType }); this.dirty = true; this.render();
    }
  };

  async runWorkflow(operation, payload = {}) {
    if (!operation || !WORKFLOW_ACTION[operation]) return;
    if (this.dirty) { this.error = "Salva le modifiche prima di cambiare stato della revisione."; this.render(); return; }
    this.pendingWorkflow = null; this.workflowMessage = "";
    await this.execute(() => managementRepository.physicalVocabularyWorkflow(this.id, WORKFLOW_ACTION[operation], payload), `${WORKFLOW_LABEL[operation] || "Operazione"}: completata.`);
  }
  operations() { return this.data?.availableOperations || []; }
  canEdit() { return has(this.operations(), "physical_vocabulary.revision.update"); }

  renderTutorial() {
    if (!this.tutorialOpen) return "";
    const step = TUTORIAL_STEPS[this.tutorialStep];
    const canApplyStarter = has(this.operations(), "physical_vocabulary.starter.apply");
    const progress = TUTORIAL_STEPS.map((_, index) => `<span class="${index === this.tutorialStep ? "active" : ""}"></span>`).join("");
    const actions = step.starter
      ? `<div class="physical-tutorial-template"><button type="button" data-starter-apply ${canApplyStarter ? "" : "disabled"}>${icon("plus", { size: 16 })} Usa configurazione base</button><button type="button" class="button-secondary" data-tutorial-finish>Preferisco partire da zero</button></div>${canApplyStarter ? "" : `<p class="physical-tutorial-note">Per applicare la configurazione, crea prima una bozza modificabile.</p>`}<button type="button" class="button-secondary small" data-tutorial-prev>${icon("arrowLeft", { size: 14 })} Precedente</button>`
      : `<div class="physical-tutorial-navigation"><button type="button" class="button-secondary" data-tutorial-prev ${this.tutorialStep === 0 ? "disabled" : ""}>${icon("arrowLeft", { size: 14 })} Precedente</button><button type="button" data-tutorial-next>Avanti ${icon("chevron", { size: 14 })}</button></div>`;
    return `<div class="physical-tutorial-overlay" data-physical-tutorial-overlay role="dialog" aria-modal="true" aria-labelledby="physical-tutorial-title"><div class="physical-tutorial-spotlight" data-physical-tutorial-spotlight></div><article class="physical-tutorial-bubble" data-physical-tutorial-bubble><button class="physical-tutorial-close" type="button" data-tutorial-close aria-label="Chiudi tutorial">×</button><span class="eyebrow">Guida · ${this.tutorialStep + 1} di ${TUTORIAL_STEPS.length}</span><h2 id="physical-tutorial-title">${escapeHtml(step.title)}</h2><p>${escapeHtml(step.body)}</p>${step.starter ? `<div class="physical-starter-preview"><div><strong>13 tipi di luogo</strong><small>Sale, ingressi, servizi e altri spazi</small></div><div><strong>8 collegamenti</strong><small>Porte, corridoi, rampe e scale</small></div><div><strong>9 caratteristiche</strong><small>Accessibilità e proprietà utili al percorso</small></div><div><strong>4 profili</strong><small>Preferenze di percorso già configurate</small></div></div>` : ""}<div class="physical-tutorial-progress" aria-hidden="true">${progress}</div>${actions}</article></div>`;
  }
  renderStarterDialog() {
    if (!this.starterOpen) return "";
    return `<div class="physical-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="physical-starter-title"><article class="physical-dialog"><button class="physical-tutorial-close" type="button" data-starter-close aria-label="Chiudi">×</button><span class="eyebrow">Configurazione facoltativa</span><h2 id="physical-starter-title">Partire da una base pronta?</h2><p>Verranno aggiunti soltanto i tipi, le caratteristiche e i profili mancanti. Le tue definizioni, label, alias e personalizzazioni non vengono sovrascritti.</p><div class="physical-starter-preview"><div><strong>13 tipi di luogo</strong><small>Sale, ingressi, servizi e altri spazi</small></div><div><strong>8 collegamenti</strong><small>Porte, corridoi, rampe e scale</small></div><div><strong>9 caratteristiche</strong><small>Accessibilità e proprietà utili al percorso</small></div><div><strong>4 profili</strong><small>Preferenze di percorso già configurate</small></div></div><div class="button-row"><button type="button" data-starter-apply>${icon("check", { size: 16 })} Usa configurazione base</button><button type="button" class="button-secondary" data-starter-close>Annulla</button></div></article></div>`;
  }
  renderSectionNav() {
    const counts = Object.fromEntries(DEFINITION_FIELDS.map((field) => [field, this.definitions[field]?.length || 0]));
    return `<nav class="physical-editor-tabs" data-physical-tutorial-anchor="sections" aria-label="Sezioni vocabolario fisico">${SECTIONS.map(([key, label]) => `<button type="button" data-section="${key}" aria-current="${this.activeSection === key ? "page" : "false"}"><span>${escapeHtml(label)}</span>${counts[key] !== undefined ? `<small>${counts[key]}</small>` : ""}</button>`).join("")}</nav>`;
  }
  renderIntegrity() {
    const integrity = this.data?.revision?.integrity;
    if (!integrity) return `<div class="physical-integrity physical-integrity--neutral"><strong>Non ancora controllato</strong><p>Esegui il controllo di consistenza prima della pubblicazione.</p></div>`;
    const issues = integrity.issues || []; const valid = integrity.status === "valid" && !issues.some((entry) => entry.severity !== "warning");
    return `<div class="physical-integrity ${valid ? "physical-integrity--ok" : "physical-integrity--warning"}"><strong>${valid ? "Vocabolario coerente" : `${issues.length} segnalazioni da verificare`}</strong>${issues.length ? `<ul>${issues.slice(0, 6).map((issue) => `<li>${escapeHtml(issue.message || issue.code || "Problema di consistenza")}</li>`).join("")}</ul>` : `<p>Le definizioni sono strutturalmente coerenti.</p>`}</div>`;
  }
  renderWorkflow() {
    const operations = this.operations().filter((entry) => WORKFLOW_ACTION[entry.code]);
    if (!operations.length) return "";
    return `<section class="physical-workflow" data-physical-tutorial-anchor="workflow"><div><span class="eyebrow">Workflow</span><h3>Controllo e pubblicazione</h3><p>La bozza resta modificabile finché non entra in revisione. La pubblicazione crea lo snapshot stabile usato dalle Venue.</p></div><div class="button-row">${operations.map((entry) => `<button type="button" class="${entry.code.includes("request_changes") ? "button-secondary" : ""}" data-workflow="${escapeHtml(entry.code)}">${escapeHtml(WORKFLOW_LABEL[entry.code] || entry.label)}</button>`).join("")}</div></section>`;
  }
  renderGeneral() {
    const vocabulary = this.data.physicalVocabulary; const revision = this.data.revision;
    const editableMetadata = has(this.operations(), "physical_vocabulary.update"); const canStarter = has(this.operations(), "physical_vocabulary.starter.apply"); const canEnsure = has(this.operations(), "physical_vocabulary.working.ensure");
    const counts = DEFINITION_FIELDS.map((field) => `<div><strong>${this.definitions[field].length}</strong><span>${META[field].title}</span></div>`).join("");
    return `<section class="physical-editor-section"><div class="physical-overview-grid"><section class="panel physical-overview-copy"><span class="eyebrow">Vocabolario fisico</span><h2>Un linguaggio riutilizzabile per sedi e routing</h2><p>Qui descrivi categorie e caratteristiche fisiche. Le Venue useranno queste definizioni per costruire mappe concrete senza duplicare il vocabolario.</p><div class="physical-count-grid">${counts}</div><div class="button-row"><button type="button" class="button-secondary" data-tutorial-start>${icon("book", { size: 16 })} Ripeti tutorial</button>${canStarter ? `<button type="button" data-starter-open>${icon("plus", { size: 16 })} Configurazione base</button>` : ""}</div></section><section class="panel"><span class="eyebrow">Versione</span><h3>${escapeHtml(sourceLabel(vocabulary.source))}${revision ? ` · v${revision.version}` : ""}</h3><p>Stato: <strong>${escapeHtml(statusLabel(revision?.status))}</strong></p>${canEnsure ? `<button type="button" data-working-ensure>Crea nuova bozza</button>` : ""}${this.renderIntegrity()}</section></div><form class="panel physical-metadata-form" data-metadata-form><div class="section-heading compact"><div><h3>Informazioni generali</h3><p>Nome e descrizione identificano il vocabolario nel Marketplace e nelle Venue.</p></div></div><label>Nome<input name="name" required maxlength="160" value="${escapeHtml(vocabulary.name)}" ${editableMetadata ? "" : "disabled"}></label><label>Descrizione<textarea name="description" rows="4" ${editableMetadata ? "" : "disabled"}>${escapeHtml(vocabulary.description || "")}</textarea></label>${editableMetadata ? `<button>${icon("check", { size: 16 })} Salva dettagli</button>` : ""}</form>${this.renderWorkflow()}</section>`;
  }

  renderRequirement(profileIndex, requirement, requirementIndex, editable) {
    const attributes = this.definitions.physicalAttributes; const attribute = attributes.find((entry) => entry.definitionId === requirement.physicalAttributeDefinitionId);
    const valueControl = attribute?.dataType === "boolean"
      ? `<select data-collection="routingProfiles" data-index="${profileIndex}" data-requirement-index="${requirementIndex}" data-property="requirement.value" ${editable ? "" : "disabled"}><option value="true" ${selected("true", String(requirement.value))}>Sì</option><option value="false" ${selected("false", String(requirement.value))}>No</option></select>`
      : attribute?.dataType === "choice"
        ? `<select data-collection="routingProfiles" data-index="${profileIndex}" data-requirement-index="${requirementIndex}" data-property="requirement.value" ${editable ? "" : "disabled"}>${(attribute.options || []).map((option) => `<option value="${escapeHtml(option.value)}" ${selected(option.value, requirement.value)}>${escapeHtml(option.label)}</option>`).join("")}</select>`
        : `<input data-collection="routingProfiles" data-index="${profileIndex}" data-requirement-index="${requirementIndex}" data-property="requirement.value" value="${escapeHtml(valueForInput(requirement.value))}" ${attribute?.dataType === "number" ? `type="number" step="any"` : ""} ${editable ? "" : "disabled"}>`;
    return `<div class="physical-requirement"><label>Caratteristica<select data-collection="routingProfiles" data-index="${profileIndex}" data-requirement-index="${requirementIndex}" data-property="requirement.physicalAttributeDefinitionId" ${editable ? "" : "disabled"}>${attributes.map((entry) => `<option value="${escapeHtml(entry.definitionId)}" ${selected(entry.definitionId, requirement.physicalAttributeDefinitionId)}>${escapeHtml(definitionName(entry))}</option>`).join("")}</select></label><label>Condizione<select data-collection="routingProfiles" data-index="${profileIndex}" data-requirement-index="${requirementIndex}" data-property="requirement.operator" ${editable ? "" : "disabled"}>${Object.entries(OPERATOR_LABEL).map(([value, label]) => `<option value="${value}" ${selected(value, requirement.operator)}>${escapeHtml(label)}</option>`).join("")}</select></label><label>Valore${valueControl}</label><label>Importanza<select data-collection="routingProfiles" data-index="${profileIndex}" data-requirement-index="${requirementIndex}" data-property="requirement.priority" ${editable ? "" : "disabled"}>${Object.entries(PRIORITY_LABEL).map(([value, label]) => `<option value="${value}" ${selected(value, requirement.priority)}>${escapeHtml(label)}</option>`).join("")}</select></label>${editable ? `<button type="button" class="icon-danger" data-remove-requirement data-index="${profileIndex}" data-requirement-index="${requirementIndex}" aria-label="Rimuovi requisito">×</button>` : ""}</div>`;
  }
  renderDefinitionCard(field, definition, index, editable) {
    const aliases = localAliases(definition).join(", ");
    const special = field === "physicalAttributes"
      ? `<div class="physical-definition-special"><label>Tipo di valore<select data-collection="${field}" data-index="${index}" data-property="dataType" ${editable ? "" : "disabled"}><option value="boolean" ${selected("boolean", definition.dataType)}>Sì / No / Non verificato</option><option value="number" ${selected("number", definition.dataType)}>Numero</option><option value="string" ${selected("string", definition.dataType)}>Testo</option><option value="choice" ${selected("choice", definition.dataType)}>Scelta da elenco</option></select></label><label>Si applica a<select data-collection="${field}" data-index="${index}" data-property="appliesTo" ${editable ? "" : "disabled"}><option value="place" ${selected("place", definition.appliesTo)}>Luoghi</option><option value="connection" ${selected("connection", definition.appliesTo)}>Collegamenti</option><option value="both" ${selected("both", definition.appliesTo)}>Entrambi</option></select></label>${definition.dataType === "number" ? `<label>Unità di misura<input data-collection="${field}" data-index="${index}" data-property="unit" value="${escapeHtml(definition.unit || "")}" placeholder="Es. cm" ${editable ? "" : "disabled"}></label>` : ""}${definition.dataType === "choice" ? `<label class="wide">Opzioni<textarea rows="3" data-collection="${field}" data-index="${index}" data-property="options" ${editable ? "" : "disabled"}>${escapeHtml(optionsText(definition.options))}</textarea><small>Una riga per opzione: valore = etichetta visibile.</small></label>` : ""}</div>`
      : field === "routingProfiles"
        ? `<div class="physical-requirements"><div class="section-heading compact"><div><strong>Regole del profilo</strong><p>Scegli caratteristiche già definite e indica se sono necessarie, preferite o da evitare.</p></div>${editable && this.definitions.physicalAttributes.length ? `<button type="button" class="button-secondary small" data-add-requirement data-index="${index}">${icon("plus", { size: 14 })} Aggiungi regola</button>` : ""}</div>${(definition.requirements || []).map((requirement, requirementIndex) => this.renderRequirement(index, requirement, requirementIndex, editable)).join("") || `<p class="muted">Nessuna regola: il profilo non modifica ancora il routing.</p>`}</div>`
        : field === "placeTypes" ? `<label class="check physical-navigation-target"><input type="checkbox" data-collection="${field}" data-index="${index}" data-property="navigationTarget" ${checked(definition.metadata?.navigationTarget)} ${editable ? "" : "disabled"}><span>Può essere proposto come destinazione logistica al visitatore</span></label>` : "";
    return `<article class="physical-definition-card"><header><div><span class="eyebrow">${escapeHtml(META[field].singular)}</span><h3>${escapeHtml(definitionName(definition))}</h3></div>${editable ? `<button type="button" class="icon-danger" data-remove-definition="${field}" data-index="${index}" aria-label="Rimuovi ${escapeHtml(definitionName(definition))}">×</button>` : ""}</header><div class="physical-definition-fields"><label>Nome visibile<input data-collection="${field}" data-index="${index}" data-property="label" value="${escapeHtml(definition.label || "")}" ${editable ? "" : "disabled"}></label><label class="wide">Che cosa significa?<textarea rows="2" data-collection="${field}" data-index="${index}" data-property="description" ${editable ? "" : "disabled"}>${escapeHtml(definition.description || "")}</textarea></label><label class="wide">Parole equivalenti per le persone<input data-collection="${field}" data-index="${index}" data-property="aliases" value="${escapeHtml(aliases)}" placeholder="Es. bagno, toilette, wc" ${editable ? "" : "disabled"}><small>Gli alias aiutano ricerca e linguaggio naturale. Non sono mapping semantici.</small></label></div>${special}<details class="physical-advanced"><summary>Dettagli tecnici e identità stabile</summary><div class="physical-definition-fields"><label>Chiave leggibile opzionale<input data-collection="${field}" data-index="${index}" data-property="key" value="${escapeHtml(definition.key || "")}" ${editable ? "" : "disabled"}></label><label>ID stabile<input value="${escapeHtml(definition.definitionId)}" disabled></label></div></details></article>`;
  }
  renderDefinitionSection(field) {
    const meta = META[field]; const editable = this.canEdit(); const definitions = this.definitions[field] || [];
    return `<section class="physical-editor-section" id="physical-${field}"><header class="physical-section-intro"><div><span class="eyebrow">${escapeHtml(meta.title)}</span><h2>${escapeHtml(meta.question)}</h2><p>${escapeHtml(meta.description)}</p><p class="physical-example"><strong>Esempio:</strong> ${escapeHtml(meta.example)}</p></div><span class="count">${definitions.length}</span></header><form data-save-definitions="${field}"><div class="physical-definition-grid">${definitions.map((definition, index) => this.renderDefinitionCard(field, definition, index, editable)).join("") || `<div class="empty-state"><h3>Nessuna definizione</h3><p>Aggiungi la prima quando serve oppure usa la configurazione base dalla sezione Generale.</p></div>`}</div>${editable ? `<div class="physical-sticky-actions"><button type="button" class="button-secondary" data-add-definition="${field}">${icon("plus", { size: 16 })} Aggiungi ${escapeHtml(meta.singular)}</button><button type="submit">${icon("check", { size: 16 })} Salva ${escapeHtml(meta.title.toLowerCase())}</button></div>` : ""}</form></section>`;
  }
  allDefinitions() { return DEFINITION_FIELDS.flatMap((field) => this.definitions[field].map((definition, index) => ({ field, definition, index }))); }
  renderMappings() {
    const editable = this.canEdit(); const entries = this.allDefinitions();
    return `<section class="physical-editor-section" id="physical-mappings"><header class="physical-section-intro"><div><span class="eyebrow">Mapping esterni</span><h2>Collega le definizioni senza renderle globali</h2><p>I riferimenti semantici permettono di riconoscere concetti equivalenti tra vocabolari diversi. Restano separati dagli alias e non cambiano l'identità locale della definizione.</p></div><span class="count">${entries.reduce((sum, entry) => sum + (entry.definition.semanticRefs?.length || 0), 0)}</span></header><div class="physical-mapping-list">${entries.map(({ field, definition, index }) => `<article class="physical-mapping-card"><header><div><small>${escapeHtml(META[field].title)}</small><strong>${escapeHtml(definitionName(definition))}</strong></div></header><div class="semantic-ref-list">${(definition.semanticRefs || []).map((mapping, mappingIndex) => `<span class="semantic-ref-chip"><span>${escapeHtml(mapping.scheme)} · ${escapeHtml(mapping.id)} · ${escapeHtml(MATCH_LABEL[mapping.matchType] || mapping.matchType)}</span>${editable ? `<button type="button" data-remove-mapping data-collection="${field}" data-index="${index}" data-mapping-index="${mappingIndex}" aria-label="Rimuovi mapping">×</button>` : ""}</span>`).join("") || `<span class="muted">Nessun mapping</span>`}</div>${editable ? `<form data-add-mapping class="physical-mapping-add"><input type="hidden" name="collection" value="${field}"><input type="hidden" name="index" value="${index}"><label>Schema<input name="scheme" required placeholder="Es. openstreetmap-tag"></label><label>Identificatore<input name="id" required placeholder="Es. amenity=toilets"></label><label>Relazione<select name="matchType"><option value="exact">Equivalente</option><option value="close">Molto vicino</option><option value="broader">Più generale</option><option value="narrower">Più specifico</option></select></label><button type="submit" class="button-secondary">Aggiungi mapping</button></form>` : ""}</article>`).join("") || `<div class="empty-state"><h3>Nessuna definizione da mappare</h3></div>`}</div>${editable ? `<div class="physical-sticky-actions"><span>Alias e mapping restano separati; salva quando hai finito le associazioni.</span><button type="button" data-save-mappings>${icon("check", { size: 16 })} Salva mapping</button></div>` : ""}</section>`;
  }
  renderPendingWorkflowMessage() {
    if (!this.pendingWorkflow) return "";
    return `<div class="physical-modal-backdrop" role="dialog" aria-modal="true" aria-label="Richiedi modifiche"><article class="physical-dialog"><span class="eyebrow">Richiedi modifiche</span><h2>Che cosa deve essere rivisto?</h2><label>Messaggio<textarea rows="4" data-workflow-message-input>${escapeHtml(this.workflowMessage)}</textarea></label><div class="button-row"><button type="button" data-workflow-confirm>Invia richiesta</button><button type="button" class="button-secondary" data-workflow-cancel>Annulla</button></div></article></div>`;
  }
  renderPendingConfirmation() {
    if (!this.pendingConfirmation) return "";
    return `<div class="physical-modal-backdrop" role="dialog" aria-modal="true" aria-label="${escapeHtml(this.pendingConfirmation.title)}"><article class="physical-dialog"><span class="eyebrow">Conferma richiesta</span><h2>${escapeHtml(this.pendingConfirmation.title)}</h2><p>${escapeHtml(this.pendingConfirmation.detail)}</p><div class="button-row"><button type="button" class="danger" data-confirm-action>${escapeHtml(this.pendingConfirmation.confirmLabel)}</button><button type="button" class="button-secondary" data-confirm-cancel>Annulla</button></div></article></div>`;
  }
  renderCurrentSection() { if (this.activeSection === "general") return this.renderGeneral(); if (this.activeSection === "mappings") return this.renderMappings(); return this.renderDefinitionSection(this.activeSection); }
  render() {
    this.syncOverlayLock();
    if (!this.data) { this.innerHTML = `<main class="page physical-editor-page"><p role="${this.error ? "alert" : "status"}">${escapeHtml(this.error || "Caricamento vocabolario fisico…")}</p></main>`; return; }
    const vocabulary = this.data.physicalVocabulary;
    this.innerHTML = `<main class="page physical-editor-page" aria-busy="${this.busy}"><nav class="breadcrumb" aria-label="Percorso"><button type="button" data-back>${icon("arrowLeft", { size: 16 })} Indietro</button><span>/</span><span>Vocabolario fisico</span><span>/</span><span>${escapeHtml(vocabulary.name)}</span></nav><header class="physical-editor-header" data-physical-tutorial-anchor="overview"><div><span class="eyebrow">Physical Vocabulary</span><h1>${escapeHtml(vocabulary.name)}</h1><p>${escapeHtml(vocabulary.description || "Definisci il linguaggio fisico riutilizzato dalle sedi.")}</p></div><div class="physical-editor-state"><strong>${escapeHtml(statusLabel(this.data.revision?.status))}</strong><span>${escapeHtml(sourceLabel(vocabulary.source))}${this.data.revision ? ` · v${this.data.revision.version}` : ""}</span><span data-dirty-indicator>${this.dirty ? `<em>${icon("warning", { size: 14 })} Modifiche non salvate</em>` : `<small>${icon("check", { size: 14 })} Allineato al server</small>`}</span></div></header>${this.renderSectionNav()}${this.busy ? `<p role="status">Aggiornamento…</p>` : ""}${this.message ? `<p class="feedback-success" role="status">${icon("check", { size: 16 })} ${escapeHtml(this.message)}</p>` : ""}${this.error ? `<p role="alert">${icon("warning", { size: 16 })} ${escapeHtml(this.error)}</p>` : ""}${this.renderCurrentSection()}</main>${this.renderTutorial()}${this.renderStarterDialog()}${this.renderPendingWorkflowMessage()}${this.renderPendingConfirmation()}`;
    if (this.tutorialOpen) requestAnimationFrame(() => this.positionTutorial());
  }
}

customElements.define("artaround-physical-vocabulary-editor-view", ArtAroundPhysicalVocabularyEditorView);
