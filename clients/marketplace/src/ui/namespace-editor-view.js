import { navigate } from "../application/router.js";
import { accountRepository } from "../infrastructure/http/account-repository.js";
import { managementRepository } from "../infrastructure/http/management-repository.js";
import { userFacingFieldLabel, userFacingIssueMessage } from "../application/user-facing-errors.js";
import { starterDefinitions } from "../application/namespace-editor-starter.js";
import { icon } from "./icons.js";
import "./semantic-entity-picker.js";

const SECTIONS = [
  ["general", "Generale"],
  ["durationTypes", "Durate"],
  ["languageLevels", "Livelli di linguaggio"],
  ["subjectClasses", "Tipi di soggetto"],
  ["relationTypes", "Relazioni"],
  ["presentationAspects", "Presentazione"],
  ["selectionSignals", "Selezione"],
  ["mappings", "Mapping esterni"],
];
const COLLECTION_META = {
  durationTypes: { title: "Durate", description: "Stabilisci quanto può essere lungo un testo, così chi scrive può scegliere fra una versione rapida e una più approfondita.", question: "Quanto tempo deve richiedere la lettura?", example: "Breve · circa 1 minuto; Media · circa 3 minuti.", singular: "durata" },
  languageLevels: { title: "Livelli di linguaggio", description: "Definisci come cambia il linguaggio per pubblici diversi, dal visitatore occasionale a chi conosce già l'argomento.", question: "Quanto deve essere semplice o specialistico il testo?", example: "Semplice · termini comuni; Specialistico · lessico disciplinare.", singular: "livello" },
  subjectClasses: { title: "Tipi di soggetto", description: "Indica quali cose potranno essere raccontate: opere, persone, luoghi, movimenti artistici o altri soggetti.", question: "Di quali tipi di soggetto parleranno i contenuti?", example: "Opera o bene culturale; Persona o autore; Luogo.", singular: "tipo di soggetto" },
  relationTypes: { title: "Relazioni", description: "Descrivi i collegamenti fra i soggetti, le domande a cui devono rispondere e quale tipo di contenuto è preferibile quando vengono esplorati.", question: "Come sono collegati tra loro i soggetti?", example: "Creata da · risponde alla domanda “Chi è l'autore?” · preferisce Panoramica/Biografia.", singular: "relazione" },
  presentationAspects: { title: "Presentazione", description: "Definisci, se serve, la funzione delle diverse parti del testo e il modo in cui presentare le informazioni.", question: "Come deve essere organizzato e presentato il testo?", example: "Apertura del testo; Conclusione e invito all'osservazione.", singular: "aspetto di presentazione" },
  selectionSignals: { title: "Selezione", description: "Aggiungi criteri facoltativi che aiutano a proporre il contenuto più adatto a una situazione, a un intento o a un pubblico.", question: "Quando è particolarmente adatto questo contenuto?", example: "Panoramica; Biografia; Curiosità; Adatto a famiglie.", singular: "segnale di selezione" },
};
const DEFINITION_COPY = {
  durationTypes: { name: "Nome della durata", placeholder: "Es. Breve", nameHelp: "Il nome che l'autore vedrà quando sceglie quanto deve essere lungo il testo.", description: "Quando usare questa durata?", descriptionPlaceholder: "Es. Per una lettura rapida davanti all'opera.", descriptionHelp: "Spiega in una frase in quale situazione questa durata è consigliata." },
  languageLevels: { name: "Nome del livello", placeholder: "Es. Semplice", nameHelp: "Il nome del livello di complessità mostrato a chi scrive.", description: "Come deve essere il linguaggio?", descriptionPlaceholder: "Es. Frasi brevi e termini comuni, senza conoscenze pregresse.", descriptionHelp: "Descrivi tono, lessico e conoscenze che puoi dare per scontate." },
  subjectClasses: { name: "Nome del tipo di soggetto", placeholder: "Es. Opera o bene culturale", nameHelp: "Una categoria di cose di cui i contenuti possono parlare.", description: "Che cosa comprende?", descriptionPlaceholder: "Es. Dipinti, sculture, manufatti e altri beni culturali.", descriptionHelp: "Chiarisci quali soggetti appartengono a questa categoria." },
  relationTypes: { name: "Nome della relazione", placeholder: "Es. Creata da", nameHelp: "Il collegamento leggibile fra due soggetti, per esempio fra un'opera e il suo autore.", description: "A quale domanda risponde?", descriptionPlaceholder: "Es. Risponde a “Chi è l'autore?” e collega l'opera alla persona che l'ha realizzata.", descriptionHelp: "Scrivi la domanda dell'utente e il significato del collegamento." },
  presentationAspects: { name: "Nome dell'aspetto", placeholder: "Es. Apertura del testo", nameHelp: "Una parte o una funzione editoriale della presentazione, non un collegamento tra soggetti.", description: "Come deve essere presentata?", descriptionPlaceholder: "Es. Introduci subito l'opera con un dettaglio riconoscibile e una frase breve.", descriptionHelp: "Descrivi l'effetto e la struttura che questa parte del testo dovrebbe avere." },
  selectionSignals: { name: "Nome del criterio", placeholder: "Es. Curiosità", nameHelp: "Un indizio usato per scegliere quando proporre questo contenuto. Può descrivere una funzione editoriale, un intento o una situazione.", description: "Quando si applica?", descriptionPlaceholder: "Es. Quando l'utente chiede dettagli insoliti o sorprendenti.", descriptionHelp: "Descrivi la situazione in cui questo criterio rende il contenuto pertinente." },
};
const TUTORIAL_STORAGE_KEY = "artaround.namespace-editor.tutorial.v1";
const TUTORIAL_STEPS = [
  { title: "A cosa servono le regole editoriali?", body: "Sono il modello condiviso che guida chi scrive: stabiliscono lunghezza, linguaggio, soggetti, relazioni e domande da affrontare.", target: '[data-tutorial-anchor="overview"]', section: "general" },
  { title: "Un passaggio alla volta", body: "Usa queste sezioni come un percorso. I numeri indicano quante definizioni hai già aggiunto; puoi tornare su ogni sezione in qualsiasi momento.", target: '[data-tutorial-anchor="sections"]' },
  { title: "1. Scegli le durate", body: "Crea almeno una durata. Dai un nome comprensibile e indica i secondi di lettura: per esempio Breve, 60 secondi.", target: "#namespace-durationTypes", section: "durationTypes" },
  { title: "2. Definisci il linguaggio", body: "Crea almeno un livello di linguaggio. La descrizione deve dire con chiarezza quale lessico e quali conoscenze sono adatti al pubblico.", target: "#namespace-languageLevels", section: "languageLevels" },
  { title: "3. Guida ciò che verrà raccontato", body: "Tipi di soggetto, segnali di selezione e relazioni trasformano domande concrete — come “Chi è l'autore?” — in collegamenti riutilizzabili che possono scegliere il contenuto più pertinente sul soggetto di arrivo.", target: "#namespace-relationTypes", section: "relationTypes" },
  { title: "Controlla e mantieni il controllo", body: "Torna in Generale per salvare ed eseguire il controllo finale. Se è tutto corretto, le regole diventano private e potrai decidere in seguito se portarle nel Marketplace.", target: '[data-tutorial-anchor="workflow"]', section: "general" },
  { title: "Vuoi partire da un modello pronto?", body: "Puoi aggiungere un modello culturale di base già completo di durate, linguaggi, tipi di soggetto, segnali di selezione e tre relazioni. Potrai modificarlo liberamente.", target: null, template: true },
];
const DEFINITION_FIELDS = Object.keys(COLLECTION_META);
const WORKFLOW_ACTION = {
  "namespace.revision.check": "check-consistency",
};
const WORKFLOW_LABEL = {
  "namespace.revision.check": "Controlla se è tutto pronto",
};
const MATCH_LABEL = { exact: "Equivalente", close: "Molto vicino", broader: "Più generale", narrower: "Più specifico" };

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function has(operations, code) { return (operations || []).some((entry) => entry.code === code); }
function namespaceId() { return new URLSearchParams(window.location.search).get("namespaceId"); }
function uuid() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function refsText(values = []) { return values.map((entry) => `${entry.scheme}|${entry.id}|${entry.matchType || "exact"}`).join("\n"); }
function parseRefs(value) { return String(value || "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => { const [scheme, id, matchType = "exact"] = line.split("|").map((part) => part.trim()); return { scheme, id, matchType }; }).filter((entry) => entry.scheme && entry.id); }
function comma(value) { return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean); }
function statusLabel(status) { return { draft: "Bozza", in_review: "Da ricontrollare", changes_requested: "Modifiche richieste", published: "Privata", superseded: "Superata" }[status] || status || "Da configurare"; }
function sourceLabel(source) { return source === "working" ? "Bozza di lavoro" : source === "published" ? "Versione privata" : "Non configurata"; }
function ownerBackUrl(owner) { return owner?.type === "organization" ? `/organizations/detail?organizationId=${encodeURIComponent(owner.id)}&section=rules` : "/profile#account-rules"; }
function generatedKey(field) { return `${field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}-${uuid().slice(0, 8)}`.toLowerCase(); }
function definitionKey(field, entry, index) { return `${field}:${entry?.definitionId || index}`; }
function initialNamespaceSection() {
  const requested = String(window.location.hash || "").replace(/^#namespace-/, "");
  return SECTIONS.some(([key]) => key === requested) ? requested : "general";
}
function emptyDefinition(field, existing = []) {
  const base = { definitionId: uuid(), key: generatedKey(field), label: "", description: "", semanticRefs: [] };
  if (field === "durationTypes") {
    const longest = Math.max(0, ...existing.map((entry) => Number(entry.targetSeconds) || 0));
    base.targetSeconds = longest ? longest + 60 : 60;
  }
  if (field === "relationTypes") Object.assign(base, {
    domainDefinitionIds: [], rangeDefinitionIds: [], category: "semantic", strength: "medium", directionality: "directed", userIntents: [],
    targetSelectionSignals: [],
    reverse: { label: "", description: "", userIntents: [], targetSelectionSignals: [] },
    validationRules: { allowMultiple: true, targetRequired: true },
  });
  return base;
}
function semanticRefChips(values = [], editable = true) {
  if (!values.length) return `<span class="muted">Nessun mapping esterno</span>`;
  return values.map((entry, index) => `<span class="semantic-ref-chip"><span>${escapeHtml(entry.scheme)} · ${escapeHtml(entry.id)} · ${escapeHtml(MATCH_LABEL[entry.matchType] || entry.matchType || "Equivalente")}</span>${editable ? `<button type="button" data-remove-semantic-ref="${index}" aria-label="Rimuovi mapping ${escapeHtml(entry.id)}">×</button>` : ""}</span>`).join("");
}
function helpButton(label, explanation) {
  return `<button class="namespace-help" type="button" aria-label="${escapeHtml(`${label}: ${explanation}`)}" data-tooltip="${escapeHtml(explanation)}">?</button>`;
}

export class ArtAroundNamespaceEditorView extends HTMLElement {
  data = null; busy = false; error = null; message = null; dirty = false; id = namespaceId(); leaveConfirmation = false; pendingWorkflow = null; workflowMessage = ""; activeSection = initialNamespaceSection(); editingDefinitionKey = null; tutorialOpen = false; tutorialStep = 0; tutorialReturnSection = "general"; starterDialogOpen = false; privateSuccessOpen = false;

  connectedCallback() { this.addEventListener("click", this.onClick); this.addEventListener("keydown", this.onSectionKeyDown); this.addEventListener("submit", this.onSubmit); this.addEventListener("input", this.onInput); this.addEventListener("semantic-ref-selected", this.onSemanticRefSelected); this.addEventListener("wheel", this.onTutorialScroll, { passive: false }); this.addEventListener("touchmove", this.onTutorialScroll, { passive: false }); window.addEventListener("beforeunload", this.onBeforeUnload); window.addEventListener("resize", this.onTutorialViewportChange); this.load(); }
  disconnectedCallback() { this.removeEventListener("click", this.onClick); this.removeEventListener("keydown", this.onSectionKeyDown); this.removeEventListener("submit", this.onSubmit); this.removeEventListener("input", this.onInput); this.removeEventListener("semantic-ref-selected", this.onSemanticRefSelected); this.removeEventListener("wheel", this.onTutorialScroll); this.removeEventListener("touchmove", this.onTutorialScroll); window.removeEventListener("beforeunload", this.onBeforeUnload); window.removeEventListener("resize", this.onTutorialViewportChange); document.documentElement.classList.remove("namespace-overlay-open"); document.body?.classList.remove("namespace-overlay-open"); }
  async load() {
    if (!this.id) { this.error = "Regole editoriali non specificate"; this.render(); return; }
    this.busy = true; this.error = null; this.render();
    try {
      this.data = await managementRepository.namespace(this.id);
      if (this.shouldStartTutorial()) {
        this.tutorialOpen = true;
        this.tutorialStep = 0;
        this.tutorialReturnSection = this.activeSection;
        this.activeSection = "general";
        this.rememberTutorialSeen();
      }
    } catch (error) { this.error = error instanceof Error ? error.message : "Regole editoriali non disponibili"; }
    finally { this.busy = false; this.render(); }
  }
  async execute(callback, message) { this.busy = true; this.error = null; this.message = null; this.render(); try { await callback(); this.dirty = false; this.leaveConfirmation = false; this.pendingWorkflow = null; this.workflowMessage = ""; this.message = message; this.data = await managementRepository.namespace(this.id); } catch (error) { const field = error?.details?.find((entry) => entry?.field)?.field || ""; const section = DEFINITION_FIELDS.find((entry) => field.startsWith(entry)); if (section) this.activeSection = section; const definitionIndex = Number(field.match(/^[^.[]+(?:\.|\[)(\d+)/)?.[1]); const definition = section && Number.isInteger(definitionIndex) ? this.data?.revision?.definitions?.[section]?.[definitionIndex] : null; if (definition) this.editingDefinitionKey = definitionKey(section, definition, definitionIndex); this.error = error instanceof Error ? error.message : "Non è stato possibile salvare le regole editoriali"; } finally { this.busy = false; this.render(); if (this.privateSuccessOpen) requestAnimationFrame(() => this.querySelector(".namespace-private-success-dialog")?.focus({ preventScroll: true })); } }

  shouldStartTutorial() {
    if (!this.data?.revision || this.data.revision.version !== 1 || this.data.revision.status !== "draft") return false;
    if (DEFINITION_FIELDS.some((field) => (this.data.revision.definitions?.[field] || []).length)) return false;
    try { return localStorage.getItem(TUTORIAL_STORAGE_KEY) !== "seen"; } catch { return false; }
  }
  rememberTutorialSeen() { try { localStorage.setItem(TUTORIAL_STORAGE_KEY, "seen"); } catch { /* Il tutorial resta comunque utilizzabile nella sessione. */ } }
  startTutorial() {
    if (this.dirty) this.snapshotDraft();
    this.tutorialReturnSection = this.activeSection;
    this.tutorialOpen = true;
    this.starterDialogOpen = false;
    this.tutorialStep = 0;
    this.activeSection = "general";
    this.rememberTutorialSeen();
    this.render();
  }
  finishTutorial() {
    this.tutorialOpen = false;
    this.tutorialStep = 0;
    this.activeSection = this.tutorialReturnSection || "general";
    this.render();
  }
  setTutorialStep(step) {
    if (this.dirty) this.snapshotDraft();
    this.tutorialStep = Math.max(0, Math.min(TUTORIAL_STEPS.length - 1, step));
    const section = TUTORIAL_STEPS[this.tutorialStep].section;
    if (section) this.activeSection = section;
    this.render();
  }
  syncOverlayLock() {
    const locked = this.tutorialOpen || this.starterDialogOpen || this.privateSuccessOpen;
    document.documentElement.classList.toggle("namespace-overlay-open", locked);
    document.body?.classList.toggle("namespace-overlay-open", locked);
  }
  onTutorialScroll = (event) => { if (this.tutorialOpen) event.preventDefault(); };
  onTutorialViewportChange = () => { if (this.tutorialOpen) requestAnimationFrame(() => this.positionTutorial()); };
  positionTutorial() {
    const overlay = this.querySelector("[data-tutorial-overlay]");
    const bubble = overlay?.querySelector("[data-tutorial-bubble]");
    const spotlight = overlay?.querySelector("[data-tutorial-spotlight]");
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
    const overlay = this.querySelector("[data-tutorial-overlay]");
    const bubble = overlay?.querySelector("[data-tutorial-bubble]");
    const spotlight = overlay?.querySelector("[data-tutorial-spotlight]");
    if (!overlay || !bubble || !spotlight) return;
    const rect = target.getBoundingClientRect();
    const padding = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const highlight = {
      left: Math.max(6, rect.left - padding),
      top: Math.max(6, rect.top - padding),
      right: Math.min(viewportWidth - 6, rect.right + padding),
      bottom: Math.min(viewportHeight - 6, rect.bottom + padding),
    };
    highlight.width = Math.max(1, highlight.right - highlight.left);
    highlight.height = Math.max(1, highlight.bottom - highlight.top);
    Object.assign(spotlight.style, { left: `${highlight.left}px`, top: `${highlight.top}px`, width: `${highlight.width}px`, height: `${highlight.height}px` });
    if (window.innerWidth <= 720) { overlay.dataset.mobile = "true"; bubble.querySelector("button")?.focus(); return; }
    const gap = 20;
    const bubbleWidth = bubble.offsetWidth;
    const bubbleHeight = bubble.offsetHeight;
    let left;
    let top;
    let side;
    if (viewportWidth - highlight.right >= bubbleWidth + gap) { side = "right"; left = highlight.right + gap; top = highlight.top + highlight.height / 2 - bubbleHeight / 2; }
    else if (highlight.left >= bubbleWidth + gap + 16) { side = "left"; left = highlight.left - bubbleWidth - gap; top = highlight.top + highlight.height / 2 - bubbleHeight / 2; }
    else if (viewportHeight - highlight.bottom >= bubbleHeight + gap) { side = "bottom"; left = highlight.left + highlight.width / 2 - bubbleWidth / 2; top = highlight.bottom + gap; }
    else if (highlight.top >= bubbleHeight + gap + 16) { side = "top"; left = highlight.left + highlight.width / 2 - bubbleWidth / 2; top = highlight.top - bubbleHeight - gap; }
    else { side = "floating"; left = viewportWidth - bubbleWidth - 16; top = viewportHeight - bubbleHeight - 16; }
    bubble.dataset.side = side;
    Object.assign(bubble.style, { left: `${Math.max(16, Math.min(viewportWidth - bubbleWidth - 16, left))}px`, top: `${Math.max(16, Math.min(viewportHeight - bubbleHeight - 16, top))}px` });
    bubble.querySelector("button")?.focus();
  }
  async applyStarterTemplate() {
    if (!this.data?.revision || !has(this.data.availableOperations, "namespace.revision.update")) return;
    const { metadata, definitions } = this.snapshotDraft();
    const prepared = starterDefinitions(definitions);
    this.data.revision.definitions = prepared;
    this.tutorialOpen = false;
    this.starterDialogOpen = false;
    this.activeSection = "relationTypes";
    this.editingDefinitionKey = null;
    await this.execute(async () => {
      if (metadata) await accountRepository.updateNamespace(this.id, metadata);
      await managementRepository.updateNamespaceRevision(this.id, prepared);
    }, "Modello iniziale aggiunto. Puoi personalizzarlo in ogni sezione.");
  }

  onBeforeUnload = (event) => { if (!this.dirty) return; event.preventDefault(); event.returnValue = ""; };
  onSectionKeyDown = (event) => {
    const modal = this.querySelector('[aria-modal="true"]');
    if (modal && event.key === "Escape") { event.preventDefault(); this.tutorialOpen ? this.finishTutorial() : (this.starterDialogOpen = false, this.render()); return; }
    if (modal && event.key === "Tab") {
      const focusable = [...modal.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      return;
    }
    const compactDefinition = event.target instanceof Element ? event.target.closest("[data-edit-definition]") : null;
    if (compactDefinition && ["Enter", " "].includes(event.key)) { event.preventDefault(); compactDefinition.click(); return; }
    const tab = event.target instanceof Element ? event.target.closest("[data-namespace-section]") : null;
    if (!tab || !["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    const tabs = [...this.querySelectorAll("[data-namespace-section]")];
    const current = tabs.indexOf(tab);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : ["ArrowDown", "ArrowRight"].includes(event.key) ? (current + 1) % tabs.length : (current - 1 + tabs.length) % tabs.length;
    event.preventDefault();
    this.showSection(tabs[next].dataset.namespaceSection);
    tabs[next].focus();
  };
  onInput = (event) => {
    const target = event.target instanceof Element ? event.target : null; if (!target) return;
    if (target.matches("[data-workflow-message]")) { this.workflowMessage = target.value; const button = this.querySelector("[data-confirm-workflow], [data-save-and-workflow]"); if (button) button.disabled = !this.workflowMessage.trim(); return; }
    if (target.matches("[data-semantic-ref-manual]")) { const card = target.closest("[data-mapping-card]"); if (card) { const input = this.definitionSemanticInput(card.dataset.mapField, Number(card.dataset.mapIndex)); if (input) input.value = target.value; const list = card.querySelector("[data-semantic-ref-list]"); if (list) list.innerHTML = semanticRefChips(parseRefs(target.value), true); } this.markDirty(); return; }
    if (target.closest("artaround-semantic-entity-picker")) return;
    this.markDirty();
  };
  markDirty() { this.dirty = true; const indicator = this.querySelector("[data-dirty-indicator]"); if (indicator) { indicator.dataset.tone = "warning"; indicator.innerHTML = `${icon("warning", { size: 14 })} Modifiche non salvate`; } }

  collectDefinitions() {
    const output = {};
    for (const field of DEFINITION_FIELDS) {
      output[field] = [...this.querySelectorAll(`[data-collection="${field}"] [data-definition-row]`)].map((row) => {
        const value = (name) => row.querySelector(`[name="${name}"]`)?.value || "";
        const relationSignals = (direction) => [...row.querySelectorAll(`[data-relation-selection-signal="${direction}"]`)]
          .filter((group) => group.querySelector('[data-selection-enabled]')?.checked)
          .map((group) => ({
            definitionId: group.dataset.definitionId,
            weight: Number(group.querySelector('[data-selection-weight]')?.value || 1),
          }));
        const base = { definitionId: value("definitionId"), key: value("key"), label: value("label"), description: value("description"), semanticRefs: parseRefs(value("semanticRefs")) };
        if (field === "durationTypes") base.targetSeconds = Number(value("targetSeconds"));
        if (field === "relationTypes") Object.assign(base, {
          domainDefinitionIds: [...row.querySelectorAll('[name="domainDefinitionIds"] option:checked')].map((entry) => entry.value),
          rangeDefinitionIds: [...row.querySelectorAll('[name="rangeDefinitionIds"] option:checked')].map((entry) => entry.value),
          category: value("category") || "semantic", strength: value("strength") || "medium", directionality: value("directionality") || "directed",
          userIntents: comma(value("userIntents")),
          targetSelectionSignals: relationSignals("forward"),
          reverse: {
            label: value("reverseLabel"), description: value("reverseDescription"), userIntents: comma(value("reverseUserIntents")),
            targetSelectionSignals: relationSignals("reverse"),
          },
          validationRules: { allowMultiple: Boolean(row.querySelector('[name="allowMultiple"]')?.checked), targetRequired: Boolean(row.querySelector('[name="targetRequired"]')?.checked) },
        });
        return base;
      });
      if (field === "durationTypes") output[field].sort((left, right) => left.targetSeconds - right.targetSeconds);
    }
    return output;
  }
  metadataPayload() { const form = this.querySelector("[data-namespace-metadata]"); if (!form) return null; const data = new FormData(form); return { name: String(data.get("name") || "").trim(), description: String(data.get("description") || "").trim() }; }
  snapshotDraft() { if (!this.data) return { metadata: null, definitions: null }; const metadata = this.metadataPayload(); const editable = has(this.data.availableOperations, "namespace.revision.update"); const definitions = editable && this.data.revision ? this.collectDefinitions() : null; if (metadata) Object.assign(this.data.namespace, metadata); if (definitions && this.data.revision) this.data.revision.definitions = definitions; return { metadata, definitions }; }
  async saveAll({ continueWorkflow = null } = {}) { if (!this.data) return; const { metadata, definitions } = this.snapshotDraft(); await this.execute(async () => { if (metadata) await accountRepository.updateNamespace(this.id, metadata); if (definitions) await managementRepository.updateNamespaceRevision(this.id, definitions); if (continueWorkflow) { const result = await this.runWorkflowRequest(continueWorkflow); this.privateSuccessOpen = Boolean(result?.finalized && !(result?.issues || []).some((issue) => issue.severity !== "warning")); } }, continueWorkflow ? null : "Regole editoriali salvate."); }
  definitionSemanticInput(field, index) { return this.querySelector(`[data-collection="${field}"] [data-definition-index="${index}"] [name="semanticRefs"]`); }
  async runWorkflowRequest(code) { const action = WORKFLOW_ACTION[code]; if (!action) return null; return managementRepository.namespaceWorkflow(this.id, action, {}); }
  async performWorkflow(code) { if (code !== "namespace.revision.check") return; await this.execute(async () => { const result = await this.runWorkflowRequest(code); this.privateSuccessOpen = Boolean(result?.finalized && !(result?.issues || []).some((issue) => issue.severity !== "warning")); }, null); }

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null; if (!target) return;
    if (target.closest("[data-close-private-success]")) { this.privateSuccessOpen = false; this.render(); return; }
    if (target.closest("[data-start-tutorial]")) { this.startTutorial(); return; }
    if (target.closest("[data-close-tutorial], [data-finish-tutorial]")) { this.finishTutorial(); return; }
    if (target.closest("[data-tutorial-previous]")) { this.setTutorialStep(this.tutorialStep - 1); return; }
    if (target.closest("[data-tutorial-next]")) { this.setTutorialStep(this.tutorialStep + 1); return; }
    if (target.closest("[data-open-starter-template]")) { if (this.dirty) this.snapshotDraft(); this.starterDialogOpen = true; this.tutorialOpen = false; this.render(); return; }
    if (target.closest("[data-cancel-starter-template]")) { this.starterDialogOpen = false; this.render(); return; }
    if (target.closest("[data-apply-starter-template]")) { await this.applyStarterTemplate(); return; }
    const sectionTab = target.closest("[data-namespace-section]");
    if (sectionTab) { this.showSection(sectionTab.dataset.namespaceSection, { scroll: true }); return; }
    if (target.closest("[data-back]")) { if (this.dirty) { this.snapshotDraft(); this.leaveConfirmation = true; this.pendingWorkflow = null; this.render(); } else navigate(ownerBackUrl(this.data?.namespace.owner)); return; }
    if (target.closest("[data-cancel-leave]")) { this.leaveConfirmation = false; this.render(); return; }
    if (target.closest("[data-confirm-leave]")) { navigate(ownerBackUrl(this.data?.namespace.owner)); return; }
    const editDefinition = target.closest("[data-edit-definition]");
    if (editDefinition) { if (this.dirty) this.snapshotDraft(); const key = editDefinition.dataset.editDefinition; this.editingDefinitionKey = key; this.render(); requestAnimationFrame(() => this.querySelector(`[data-definition-key="${key}"] input[name="label"]`)?.focus({ preventScroll: true })); return; }
    const add = target.closest("[data-add-definition]");
    if (add) { const { definitions } = this.snapshotDraft(); const field = add.dataset.addDefinition; const definition = emptyDefinition(field, definitions[field]); definitions[field].push(definition); this.data.revision.definitions = definitions; this.editingDefinitionKey = definitionKey(field, definition, definitions[field].length - 1); this.dirty = true; this.render(); requestAnimationFrame(() => this.querySelector(`[data-definition-key="${this.editingDefinitionKey}"] input[name="label"]`)?.focus()); return; }
    const remove = target.closest("[data-remove-definition]");
    if (remove) { const { definitions } = this.snapshotDraft(); const field = remove.dataset.collection; const key = remove.dataset.definitionKey; const index = definitions[field].findIndex((entry, entryIndex) => definitionKey(field, entry, entryIndex) === key); if (index >= 0) definitions[field].splice(index, 1); this.data.revision.definitions = definitions; if (this.editingDefinitionKey === key) this.editingDefinitionKey = null; this.dirty = true; this.render(); return; }
    const removeSemanticRef = target.closest("[data-remove-semantic-ref]");
    if (removeSemanticRef) { const card = removeSemanticRef.closest("[data-mapping-card]"); if (!card) return; const input = this.definitionSemanticInput(card.dataset.mapField, Number(card.dataset.mapIndex)); if (!input) return; const refs = parseRefs(input.value); refs.splice(Number(removeSemanticRef.dataset.removeSemanticRef), 1); input.value = refsText(refs); const manual = card.querySelector("[data-semantic-ref-manual]"); if (manual) manual.value = input.value; const list = card.querySelector("[data-semantic-ref-list]"); if (list) list.innerHTML = semanticRefChips(refs, true); this.markDirty(); return; }
    if (target.closest("[data-cancel-workflow]")) { this.pendingWorkflow = null; this.workflowMessage = ""; this.render(); return; }
    if (target.closest("[data-save-and-workflow]") && this.pendingWorkflow) { const code = this.pendingWorkflow; await this.saveAll({ continueWorkflow: code }); return; }
    if (target.closest("[data-confirm-workflow]") && this.pendingWorkflow) { const code = this.pendingWorkflow; await this.execute(() => this.runWorkflowRequest(code), "Workflow delle regole editoriali aggiornato."); return; }
    const operation = target.closest("[data-operation]"); if (!operation) return; const code = operation.dataset.operation;
    if (code === "namespace.working.ensure") { await this.execute(() => managementRepository.ensureNamespaceWorking(this.id), "Bozza di lavoro pronta."); return; }
    if (this.dirty) { this.snapshotDraft(); this.pendingWorkflow = code; this.workflowMessage = ""; this.render(); return; }
    await this.performWorkflow(code);
  };

  onSemanticRefSelected = (event) => { const picker = event.target instanceof Element ? event.target : null; const card = picker?.closest("[data-mapping-card]"); const semanticRef = event.detail?.semanticRef; if (!card || !semanticRef) return; const input = this.definitionSemanticInput(card.dataset.mapField, Number(card.dataset.mapIndex)); if (!input) return; const refs = parseRefs(input.value); const refKey = `${semanticRef.scheme}::${semanticRef.id}::${semanticRef.matchType}`; if (!refs.some((entry) => `${entry.scheme}::${entry.id}::${entry.matchType}` === refKey)) refs.push(semanticRef); input.value = refsText(refs); const manual = card.querySelector("[data-semantic-ref-manual]"); if (manual) manual.value = input.value; const list = card.querySelector("[data-semantic-ref-list]"); if (list) list.innerHTML = semanticRefChips(refs, true); this.markDirty(); };
  onSubmit = async (event) => { const form = event.target instanceof HTMLFormElement ? event.target : null; if (!form) return; if (form.matches("[data-namespace-metadata], [data-definitions]")) { event.preventDefault(); await this.saveAll(); } };

  renderTechnicalBase(entry) { return `<details class="namespace-advanced"><summary>Dettagli tecnici della definizione</summary><div class="namespace-technical-grid"><label>Chiave tecnica<input name="key" value="${escapeHtml(entry.key || "")}" required></label><label>ID definizione<input name="definitionIdDisplay" value="${escapeHtml(entry.definitionId || "")}" readonly></label></div><p class="note">La chiave e l'ID mantengono stabile il riferimento interno. Modificali solo se sai perché serve.</p></details>`; }
  renderRelationSignalPreferences(selectionSignals, selected = [], direction) {
    if (!selectionSignals.length) return `<p class="note">Definisci prima almeno un segnale nella sezione Selezione per configurare quale contenuto preferire sul soggetto di arrivo.</p>`;
    const selectedById = new Map((selected || []).map((entry) => [String(entry.definitionId), entry]));
    return `<div class="namespace-relation-signal-list">${selectionSignals.map((signal) => {
      const active = selectedById.get(String(signal.definitionId));
      return `<label class="namespace-relation-signal" data-relation-selection-signal="${direction}" data-definition-id="${escapeHtml(signal.definitionId)}"><span><input type="checkbox" data-selection-enabled ${active ? "checked" : ""}><strong>${escapeHtml(signal.label || signal.key)}</strong></span><span>Peso <input type="number" min="0" max="1" step="0.1" data-selection-weight value="${escapeHtml(active?.weight ?? 1)}"></span><small>${escapeHtml(signal.description || "Criterio per scegliere il contenuto di destinazione")}</small></label>`;
    }).join("")}</div>`;
  }
  renderRelationFields(entry, subjectClasses, selectionSignals) {
    const options = (selected = []) => subjectClasses.map((subject) => `<option value="${escapeHtml(subject.definitionId)}" ${selected.includes(subject.definitionId) ? "selected" : ""}>${escapeHtml(subject.label || subject.key)}</option>`).join("");
    return `<details class="namespace-advanced"><summary>Vincoli e semantica della relazione</summary><div class="namespace-technical-grid"><label>Tipi ammessi in partenza<select name="domainDefinitionIds" multiple>${options(entry.domainDefinitionIds)}</select></label><label>Tipi ammessi in arrivo<select name="rangeDefinitionIds" multiple>${options(entry.rangeDefinitionIds)}</select></label><label>Categoria<select name="category"><option value="semantic" ${entry.category === "semantic" ? "selected" : ""}>Semantica</option><option value="contextual" ${entry.category === "contextual" ? "selected" : ""}>Contestuale</option><option value="editorial" ${entry.category === "editorial" ? "selected" : ""}>Editoriale</option></select></label><label>Forza<select name="strength"><option value="strong" ${entry.strength === "strong" ? "selected" : ""}>Forte</option><option value="medium" ${(!entry.strength || entry.strength === "medium") ? "selected" : ""}>Media</option><option value="weak" ${entry.strength === "weak" ? "selected" : ""}>Debole</option></select></label><label>Direzione<select name="directionality"><option value="directed" ${(!entry.directionality || entry.directionality === "directed") ? "selected" : ""}>Diretta</option><option value="symmetric" ${entry.directionality === "symmetric" ? "selected" : ""}>Simmetrica</option></select></label><label>Intenti utente<input name="userIntents" value="${escapeHtml((entry.userIntents || []).join(", "))}" placeholder="es. chi è l'autore, chi ha creato l'opera"></label><label>Etichetta inversa<input name="reverseLabel" value="${escapeHtml(entry.reverse?.label || "")}"></label><label>Descrizione inversa<input name="reverseDescription" value="${escapeHtml(entry.reverse?.description || "")}"></label><label>Intenti inversi<input name="reverseUserIntents" value="${escapeHtml((entry.reverse?.userIntents || []).join(", "))}"></label><label class="check"><input type="checkbox" name="allowMultiple" ${entry.validationRules?.allowMultiple !== false ? "checked" : ""}> Consenti più valori</label><label class="check"><input type="checkbox" name="targetRequired" ${entry.validationRules?.targetRequired !== false ? "checked" : ""}> Destinazione obbligatoria</label></div><section class="namespace-relation-selection"><h4>Contenuti preferiti sul soggetto di arrivo</h4><p class="note">Quando l'utente segue questa relazione, ArtAround confronta questi segnali con quelli dichiarati dagli Item che parlano del Subject raggiunto. Un pareggio resta una scelta esplicita.</p>${this.renderRelationSignalPreferences(selectionSignals, entry.targetSelectionSignals || [], "forward")}</section><section class="namespace-relation-selection"><h4>Contenuti preferiti nella direzione inversa</h4><p class="note">Puoi configurare una preferenza diversa quando la relazione viene attraversata al contrario.</p>${this.renderRelationSignalPreferences(selectionSignals, entry.reverse?.targetSelectionSignals || [], "reverse")}</section></details>`;
  }
  renderDefinition(field, entry, index, definitions, editable) {
    const title = entry.label || `Nuovo ${COLLECTION_META[field].singular}`;
    const copy = DEFINITION_COPY[field];
    const inputId = `namespace-${field}-${index}`;
    const key = definitionKey(field, entry, index);
    const expanded = !editable || this.editingDefinitionKey === key;
    const description = entry.description || (entry.label ? "Nessuna descrizione aggiunta." : "Definizione da completare.");
    const durationSummary = field === "durationTypes" ? `<span class="chip">${Number(entry.targetSeconds) || 60} secondi</span>` : "";
    const durationField = field === "durationTypes" ? `<div class="namespace-form-field"><div class="namespace-label-row"><label for="${inputId}-seconds">Tempo di lettura in secondi</label>${helpButton("Tempo di lettura", "È una stima utile per confrontare e ordinare le durate. Un minuto corrisponde a 60 secondi.")}</div><input id="${inputId}-seconds" name="targetSeconds" type="number" min="1" value="${Number(entry.targetSeconds) || 60}" required><small>Per esempio: 60 per un testo breve, 180 per uno medio.</small></div>` : "";
    const actions = editable && expanded ? `<div class="namespace-definition-actions"><button class="danger small" type="button" data-collection="${field}" data-remove-definition="${index}" data-definition-key="${escapeHtml(key)}">${icon("trash", { size: 15 })} Rimuovi</button></div>` : "";
    const compactInteraction = editable && !expanded ? `role="button" tabindex="0" aria-expanded="false" data-edit-definition="${escapeHtml(key)}"` : "";
    return `<article class="namespace-definition${expanded ? "" : " namespace-definition--collapsed"}" data-definition-row data-definition-index="${index}" data-definition-key="${escapeHtml(key)}" data-expanded="${expanded}" ${compactInteraction}><input type="hidden" name="definitionId" value="${escapeHtml(entry.definitionId || uuid())}"><textarea name="semanticRefs" hidden>${escapeHtml(refsText(entry.semanticRefs || []))}</textarea><header><div class="namespace-definition-heading"><span class="eyebrow">${escapeHtml(COLLECTION_META[field].singular)}</span><h3>${escapeHtml(title)}</h3>${expanded ? "" : `<div class="namespace-definition-summary"><p>${escapeHtml(description)}</p>${durationSummary}</div>`}</div>${actions}</header><div class="namespace-definition-editor" ${expanded ? "" : "hidden"}><div class="namespace-definition-fields"><div class="namespace-form-field"><div class="namespace-label-row"><label for="${inputId}-label">${escapeHtml(copy.name)}</label>${helpButton(copy.name, copy.nameHelp)}</div><input id="${inputId}-label" name="label" value="${escapeHtml(entry.label || "")}" required placeholder="${escapeHtml(copy.placeholder)}"><small>${escapeHtml(copy.nameHelp)}</small></div>${durationField}<div class="namespace-form-field wide"><div class="namespace-label-row"><label for="${inputId}-description">${escapeHtml(copy.description)}</label>${helpButton(copy.description, copy.descriptionHelp)}</div><textarea id="${inputId}-description" name="description" rows="2" placeholder="${escapeHtml(copy.descriptionPlaceholder)}">${escapeHtml(entry.description || "")}</textarea><small>${escapeHtml(copy.descriptionHelp)}</small></div></div>${field === "relationTypes" ? this.renderRelationFields(entry, definitions.subjectClasses || [], definitions.selectionSignals || []) : ""}${this.renderTechnicalBase(entry)}</div></article>`;
  }
  renderCollection(field, definitions, editable) {
    const meta = COLLECTION_META[field];
    const rows = (definitions[field] || []).map((entry, index) => this.renderDefinition(field, entry, index, definitions, editable)).join("");
    return `<section class="namespace-section" id="namespace-${field}" data-collection="${field}"><div class="section-heading"><div><span class="eyebrow">${escapeHtml(meta.title)}</span><h2>${escapeHtml(meta.title)}</h2><p>${escapeHtml(meta.description)}</p></div><span class="count">${(definitions[field] || []).length}</span></div><div class="namespace-guidance"><span>${icon("info", { size: 20 })}</span><div><strong>${escapeHtml(meta.question)}</strong><p>${escapeHtml(meta.description)}</p><small><b>Esempio:</b> ${escapeHtml(meta.example)}</small></div></div>${rows ? `<div class="namespace-definition-list">${rows}</div>` : `<div class="empty-state namespace-empty-guided"><h3>Non hai ancora aggiunto nessun ${escapeHtml(meta.singular)}</h3><p>Usa l'esempio qui sopra come punto di partenza. Potrai modificare tutto in seguito.</p></div>`}${editable ? `<button class="button-secondary" type="button" data-add-definition="${field}">${icon("plus", { size: 16 })} Aggiungi ${escapeHtml(meta.singular)}</button>` : ""}</section>`;
  }
  renderMappings(definitions, editable) {
    const groups = DEFINITION_FIELDS.map((field) => { const entries = definitions[field] || []; if (!entries.length) return ""; const cards = entries.map((entry, index) => `<article class="namespace-mapping-card" data-mapping-card data-map-field="${field}" data-map-index="${index}"><header><div><span class="eyebrow">${escapeHtml(COLLECTION_META[field].title)}</span><h3>${escapeHtml(entry.label || entry.key)}</h3></div><span class="chip">${(entry.semanticRefs || []).length} mapping</span></header><p>Collega questa definizione a identificatori di vocabolari esterni senza cambiarne l'identità interna.</p><div data-semantic-ref-list>${semanticRefChips(entry.semanticRefs || [], editable)}</div>${editable ? `<artaround-semantic-entity-picker mode="mapping" entity-kind="${field === "relationTypes" ? "property" : "item"}"></artaround-semantic-entity-picker><details class="namespace-advanced"><summary>Inserimento provider-neutral</summary><label>Una riga schema|ID|relazione<textarea rows="3" data-semantic-ref-manual placeholder="schema|identificativo|exact">${escapeHtml(refsText(entry.semanticRefs || []))}</textarea></label><p class="note">Relazioni supportate: exact, close, broader, narrower.</p></details>` : ""}</article>`).join(""); return `<section class="namespace-mapping-group"><div class="section-heading"><div><h3>${escapeHtml(COLLECTION_META[field].title)}</h3><p>${entries.length} definizioni configurabili.</p></div></div><div class="namespace-mapping-grid">${cards}</div></section>`; }).join("");
    return `<section class="namespace-section" id="namespace-mappings"><div class="section-heading"><div><span class="eyebrow">Interoperabilità</span><h2>Mapping esterni</h2><p>Associa le definizioni a Wikidata o altri schemi provider-neutral. Questi mapping descrivono equivalenze o vicinanze semantiche: non creano nuovi Subject globali.</p></div></div>${groups || `<div class="empty-state"><h3>Nessuna definizione da collegare</h3><p>Crea prima almeno una durata, un livello, un tipo, una relazione o un altro criterio editoriale.</p></div>`}</section>`;
  }
  renderWorkflowPanel() { if (!this.pendingWorkflow) return ""; return `<section class="confirmation-panel namespace-confirmation" role="alert"><div><strong>Prima salva le modifiche</strong><p>Il controllo deve usare la versione effettivamente salvata. Salva ora e continua con il controllo finale.</p></div><div class="button-row"><button type="button" data-save-and-workflow>Salva e controlla</button><button class="button-secondary" type="button" data-cancel-workflow>Annulla</button></div></section>`; }
  renderGeneral(namespace, revision, availableOperations) {
    const issues = (revision?.integrity?.issues || []).map((issue) => `<li><strong>${escapeHtml(userFacingFieldLabel(issue.field) || "Controllo")}</strong><span>${escapeHtml(userFacingIssueMessage({ ...issue, field: "" }))}</span></li>`).join("");
    const workflowButtons = availableOperations.filter((entry) => entry.code === "namespace.revision.check").map((entry) => `<button type="button" data-operation="${escapeHtml(entry.code)}">${icon("check", { size: 16 })} ${escapeHtml(WORKFLOW_LABEL[entry.code] || entry.label)}</button>`).join("");
    const ensure = availableOperations.find((entry) => entry.code === "namespace.working.ensure");
    const privateReady = revision?.status === "published";
    return `<section class="namespace-section" id="namespace-general">
      <div class="section-heading"><div><span class="eyebrow">Generale</span><h2>Identità e controllo</h2><p>Dai un nome riconoscibile a questo modello e controlla quando è pronto per essere usato.</p></div></div>
      <div class="namespace-purpose-card"><span>${icon("book", { size: 22 })}</span><div><strong>In parole semplici</strong><p>Queste regole aiutano più autori a produrre testi coerenti: decidono quali versioni creare, quali domande affrontare e quale linguaggio usare.</p></div></div>
      <form data-namespace-metadata class="namespace-general-form"><div class="namespace-form-field"><div class="namespace-label-row"><label for="namespace-name">Nome delle regole</label>${helpButton("Nome delle regole", "Scegli un nome che faccia capire a quale collezione, progetto o stile editoriale si applicano.")}</div><input id="namespace-name" name="name" value="${escapeHtml(namespace.name)}" required placeholder="Es. Regole editoriali della collezione permanente"><small>Lo vedranno gli autori quando scelgono le regole da usare.</small></div><div class="namespace-form-field wide"><div class="namespace-label-row"><label for="namespace-description">Scopo e ambito</label>${helpButton("Scopo e ambito", "Spiega per quali contenuti e per quale pubblico sono state pensate queste regole.")}</div><textarea id="namespace-description" name="description" rows="3" placeholder="Es. Linee guida per i contenuti delle opere della collezione, rivolti a visitatori adulti non specialisti.">${escapeHtml(namespace.description || "")}</textarea><small>Una o due frasi sono sufficienti.</small></div><button type="submit">${icon("check", { size: 16 })} Salva dettagli</button></form>
      ${ensure ? `<div class="namespace-start"><div><strong>Non c'è una bozza modificabile</strong><p>Avvia una bozza per aggiornare le regole mantenendo intatta la versione privata corrente.</p></div><button type="button" data-operation="namespace.working.ensure">${escapeHtml(ensure.label)}</button></div>` : ""}
      ${revision ? `<div class="namespace-workflow" data-tutorial-anchor="workflow"><div class="namespace-workflow-heading"><div><span class="eyebrow">Controllo finale</span><h3>${escapeHtml(statusLabel(revision.status))}</h3><p>${privateReady ? "Le regole hanno superato i controlli e restano private finché non sceglierai di portarle nel Marketplace." : "Se manca qualcosa, verrai portato direttamente alla sezione da correggere. Se è tutto corretto, le regole diventeranno private."}</p></div><span class="chip" data-tone="${revision.integrity.status === "valid" ? "success" : "warning"}">${icon(revision.integrity.status === "valid" ? "check" : "warning", { size: 14 })} ${privateReady ? "Regole private e corrette" : revision.integrity.status === "valid" ? "Controllo superato" : "Da controllare"}</span></div>${issues ? `<div class="issues"><h4>Problemi da risolvere</h4><ul>${issues}</ul></div>` : privateReady ? `<p class="note">Questa versione è pronta per essere usata e non è visibile nel Marketplace.</p>` : `<p class="note">Nessun problema segnalato nell'ultimo controllo.</p>`}${workflowButtons ? `<div class="button-row">${workflowButtons}</div>` : ""}</div>` : ""}
      ${this.renderWorkflowPanel()}
    </section>`;
  }

  renderTutorial() {
    if (!this.tutorialOpen) return "";
    const step = TUTORIAL_STEPS[this.tutorialStep];
    const canApplyTemplate = Boolean(this.data?.revision && has(this.data?.availableOperations, "namespace.revision.update"));
    const progress = TUTORIAL_STEPS.map((_, index) => `<span class="${index === this.tutorialStep ? "active" : ""}"></span>`).join("");
    const actions = step.template
      ? `<div class="namespace-tutorial-template"><button type="button" data-apply-starter-template ${canApplyTemplate ? "" : "disabled"}>${icon("plus", { size: 16 })} Usa il modello guidato</button><button class="button-secondary" type="button" data-finish-tutorial>Preferisco partire da zero</button></div>${canApplyTemplate ? "" : `<p class="namespace-tutorial-note">Per applicare il modello, avvia prima una bozza modificabile.</p>`}<button class="button-secondary small" type="button" data-tutorial-previous>${icon("arrowLeft", { size: 14 })} Precedente</button>`
      : `<div class="namespace-tutorial-navigation"><button class="button-secondary" type="button" data-tutorial-previous ${this.tutorialStep === 0 ? "disabled" : ""}>${icon("arrowLeft", { size: 14 })} Precedente</button><button type="button" data-tutorial-next>Avanti ${icon("chevron", { size: 14 })}</button></div>`;
    return `<div class="namespace-tutorial-overlay" data-tutorial-overlay role="dialog" aria-modal="true" aria-labelledby="namespace-tutorial-title"><div class="namespace-tutorial-spotlight" data-tutorial-spotlight></div><article class="namespace-tutorial-bubble" data-tutorial-bubble><button class="namespace-tutorial-close" type="button" data-close-tutorial aria-label="Chiudi tutorial">×</button><span class="eyebrow">Guida · ${this.tutorialStep + 1} di ${TUTORIAL_STEPS.length}</span><h2 id="namespace-tutorial-title">${escapeHtml(step.title)}</h2><p>${escapeHtml(step.body)}</p>${step.template ? `<ul><li><strong>Creata da</strong> · relazione: “Chi è l'autore?”</li><li><strong>Contesto storico e culturale</strong> · relazione: “Quando e dove è stata realizzata?”</li><li><strong>Tecnica e esecuzione</strong> · relazione su materiali e tecniche impiegati</li><li><strong>4 segnali di selezione</strong> · Panoramica, Biografia, Curiosità e Aneddoto</li></ul>` : ""}<div class="namespace-tutorial-progress" aria-hidden="true">${progress}</div>${actions}</article></div>`;
  }

  renderStarterDialog() {
    if (!this.starterDialogOpen) return "";
    return `<div class="namespace-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="starter-template-title"><article class="namespace-starter-dialog"><button class="namespace-tutorial-close" type="button" data-cancel-starter-template aria-label="Chiudi">×</button><span class="eyebrow">Modello facoltativo</span><h2 id="starter-template-title">Aggiungere un modello culturale di partenza?</h2><p>Il modello preserva le definizioni che hai inserito. Se riconosce le due voci create da una versione precedente del modello, le corregge spostandole da Presentazione a Relazioni.</p><div class="namespace-starter-preview"><div><strong>3 durate</strong><small>Breve, Media, Approfondita</small></div><div><strong>3 linguaggi</strong><small>Semplice, Divulgativo, Specialistico</small></div><div><strong>4 tipi di soggetto</strong><small>Opera, autore, contesto e tecnica</small></div><div><strong>4 segnali di selezione</strong><small>Panoramica, Biografia, Curiosità, Aneddoto</small></div><div><strong>3 relazioni</strong><small>Creata da, Contesto storico e culturale, Tecnica e esecuzione</small></div></div><div class="button-row"><button type="button" data-apply-starter-template>${icon("plus", { size: 16 })} Aggiungi il modello</button><button class="button-secondary" type="button" data-cancel-starter-template>Annulla</button></div></article></div>`;
  }

  renderPrivateSuccessDialog() {
    if (!this.privateSuccessOpen) return "";
    const marketplaceHref = `/workspace/resource?ownership=owned&resourceType=namespace&resourceId=${encodeURIComponent(this.id)}`;
    return `<div class="namespace-private-success-overlay"><section class="namespace-private-success-dialog" role="dialog" aria-modal="true" aria-labelledby="namespace-private-success-title" tabindex="-1"><span class="namespace-private-success-icon">${icon("check", { size: 28 })}</span><div><span class="eyebrow">Controlli superati</span><h2 id="namespace-private-success-title">Le regole editoriali sono corrette e ora sono private</h2><p>La versione ha superato tutti i controlli ed è pronta per essere usata nei tuoi contenuti. Non è ancora visibile agli altri utenti.</p><p>Quando vuoi, puoi configurare un’offerta e pubblicarla nel Marketplace, oppure mantenerla privata.</p></div><div class="namespace-private-success-actions"><a class="button-link" data-route href="${escapeHtml(marketplaceHref)}">Configura offerta e pubblica ${icon("chevron", { size: 15 })}</a><button class="button-secondary" type="button" data-close-private-success>Mantieni privata</button></div></section></div>`;
  }

  syncSectionNavigation({ scroll = false } = {}) {
    const available = SECTIONS.map(([key]) => key).filter((key) => this.querySelector(`#namespace-${key}`));
    if (!available.includes(this.activeSection)) this.activeSection = available[0] || "general";
    for (const tab of this.querySelectorAll("[data-namespace-section]")) {
      const selected = tab.dataset.namespaceSection === this.activeSection;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const panel of this.querySelectorAll(".namespace-section")) {
      const selected = panel.id === `namespace-${this.activeSection}`;
      panel.hidden = !selected;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", `namespace-tab-${panel.id.replace("namespace-", "")}`);
      panel.tabIndex = -1;
    }
    const panel = this.querySelector(`#namespace-${this.activeSection}`);
    if (scroll && panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  showSection(section, { scroll = false } = {}) {
    if (!SECTIONS.some(([key]) => key === section)) return;
    this.activeSection = section;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#namespace-${section}`);
    this.syncSectionNavigation({ scroll });
  }

  render() {
    this.syncOverlayLock();
    if (!this.data) { this.innerHTML = `<main class="page namespace-editor-page"><p role="${this.error ? "alert" : "status"}">${escapeHtml(this.error || "Caricamento regole editoriali…")}</p></main>`; return; }
    const { namespace, revision, availableOperations } = this.data; const editable = has(availableOperations, "namespace.revision.update"); const definitions = revision?.definitions || Object.fromEntries(DEFINITION_FIELDS.map((field) => [field, []]));
    const visibleSections = revision ? SECTIONS : SECTIONS.filter(([field]) => field === "general");
    const nav = visibleSections.map(([field, label]) => { const count = DEFINITION_FIELDS.includes(field) ? (definitions[field] || []).length : null; return `<button type="button" id="namespace-tab-${field}" role="tab" data-namespace-section="${field}" aria-controls="namespace-${field}">${escapeHtml(label)}${count !== null ? `<span>${count}</span>` : ""}</button>`; }).join("");
    const collections = revision ? DEFINITION_FIELDS.map((field) => this.renderCollection(field, definitions, editable)).join("") : ""; const mappings = revision ? this.renderMappings(definitions, editable) : "";
    const leavePanel = this.leaveConfirmation ? `<section class="confirmation-panel namespace-confirmation" role="alert"><div><strong>Uscire senza salvare?</strong><p>Le modifiche non salvate alle regole editoriali andranno perse.</p></div><div class="button-row"><button class="danger" type="button" data-confirm-leave>Esci senza salvare</button><button class="button-secondary" type="button" data-cancel-leave>Resta nell'editor</button></div></section>` : "";
    this.innerHTML = `<main class="page namespace-editor-page" aria-busy="${this.busy}"><nav class="breadcrumb" aria-label="Percorso"><button type="button" data-back>${icon("arrowLeft", { size: 16 })} ${namespace.owner.type === "organization" ? "Organizzazione" : "Account e organizzazioni"}</button><span>/</span><span>Regole editoriali</span></nav><header class="namespace-editor-header" data-tutorial-anchor="overview"><div class="namespace-editor-heading"><span class="eyebrow">Regole editoriali ${namespace.owner.type === "organization" ? "dell'organizzazione" : "personali"}</span><h1>${escapeHtml(namespace.name)}</h1><p>${escapeHtml(namespace.description || "Configura le indicazioni che guideranno chi scrive i contenuti.")}</p></div><div class="namespace-editor-side"><div class="namespace-editor-actions"><button class="button-secondary" type="button" data-start-tutorial>${icon("info", { size: 16 })} Ripeti tutorial</button><button type="button" data-open-starter-template ${editable ? "" : "disabled"}>${icon("plus", { size: 16 })} Usa modello guidato</button></div><div class="namespace-editor-status"><span class="chip">${escapeHtml(sourceLabel(namespace.source))}</span>${revision ? `<span class="chip">Versione ${revision.version}</span><span class="chip">${escapeHtml(statusLabel(revision.status))}</span>` : ""}<span class="chip" data-dirty-indicator data-tone="${this.dirty ? "warning" : "success"}">${icon(this.dirty ? "warning" : "check", { size: 14 })} ${this.dirty ? "Modifiche non salvate" : "Tutto salvato"}</span></div></div></header>${this.busy ? `<p role="status">Aggiornamento…</p>` : ""}${this.message ? `<p role="status">${icon("check", { size: 16 })} ${escapeHtml(this.message)}</p>` : ""}${this.error ? `<p role="alert">${icon("warning", { size: 16 })} ${escapeHtml(this.error)}</p>` : ""}${leavePanel}<div class="namespace-editor-layout"><aside class="namespace-editor-nav" data-tutorial-anchor="sections"><nav role="tablist" aria-orientation="vertical" aria-label="Sezioni regole editoriali">${nav}</nav><details class="technical-details"><summary>Dettagli tecnici</summary><dl class="definition-list"><div><dt>Namespace ID</dt><dd><code>${escapeHtml(namespace.id)}</code></dd></div>${revision ? `<div><dt>NamespaceRevision ID</dt><dd><code>${escapeHtml(revision.id)}</code></dd></div>` : ""}</dl></details></aside><div class="namespace-editor-content">${this.renderGeneral(namespace, revision, availableOperations)}${revision ? `<form data-definitions><fieldset class="definitions-fieldset" ${editable ? "" : "disabled"}>${collections}${mappings}</fieldset>${editable ? `<div class="namespace-savebar"><div><strong>${this.dirty ? "Hai modifiche da salvare" : "Bozza salvata"}</strong><small>Salva per rendere effettive tutte le modifiche fatte in questa sezione.</small></div><button type="submit" data-save-all ${this.busy ? "disabled" : ""}>${icon("check", { size: 16 })} Salva modifiche</button></div>` : ""}</form>` : `<div class="empty-state"><h3>Nessuna revisione disponibile</h3><p>Avvia una bozza dalla sezione Generale per iniziare a configurare le regole.</p></div>`}</div></div></main>${this.renderStarterDialog()}${this.renderTutorial()}`;
    this.insertAdjacentHTML("beforeend", this.renderPrivateSuccessDialog());
    this.syncSectionNavigation();
    if (this.tutorialOpen) requestAnimationFrame(() => this.positionTutorial());
    else if (this.starterDialogOpen) requestAnimationFrame(() => this.querySelector("[data-apply-starter-template]")?.focus());
  }
}
customElements.define("artaround-namespace-editor-view", ArtAroundNamespaceEditorView);
