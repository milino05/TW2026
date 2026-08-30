import { semanticRepository } from "../infrastructure/http/semantic-repository.js";
import { icon } from "./icons.js";
import { observeReliableSelects } from "./reliable-selects.js";
import {
  normalizeSemanticQuery,
  searchExternalCandidates,
  searchSubjectCascade,
} from "./semantic-search-flow.js";

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function subjectId(subject) { return String(subject?.id || subject?._id || ""); }

export class ArtAroundSemanticEntityPicker extends HTMLElement {
  localResults = [];
  localSuggestions = [];
  externalResults = [];
  selectedCandidate = null;
  provider = null;
  busy = false;
  error = null;
  notice = null;
  query = "";
  localSearched = false;
  externalSearched = false;
  manualAvailable = false;
  searchRequestId = 0;
  providerRetryMode = null;
  providerRetryAfterSeconds = null;
  providerUnavailable = false;
  externalQuery = null;
  venueContext = null;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  get mode() { return this.getAttribute("mode") === "mapping" ? "mapping" : "subject"; }
  get entityKind() { return this.getAttribute("entity-kind") === "property" ? "property" : "item"; }
  get venueId() { return String(this.getAttribute("venue-id") || "").trim(); }

  connectedCallback() {
    if (!this.query && this.hasAttribute("initial-query")) this.query = normalizeSemanticQuery(this.getAttribute("initial-query"));
    this.stopReliableSelects = observeReliableSelects(this.shadowRoot);
    this.shadowRoot.addEventListener("submit", this.onSubmit);
    this.shadowRoot.addEventListener("click", this.onClick);
    this.render();
    if (this.hasAttribute("auto-search") && this.query.length >= 2) queueMicrotask(() => this.runSubjectSearch(this.query));
  }

  disconnectedCallback() {
    this.stopReliableSelects?.();
    this.stopReliableSelects = null;
    this.shadowRoot.removeEventListener("submit", this.onSubmit);
    this.shadowRoot.removeEventListener("click", this.onClick);
  }

  emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  clearProviderFailure() {
    this.providerRetryMode = null;
    this.providerRetryAfterSeconds = null;
    this.providerUnavailable = false;
  }

  captureProviderFailure(error, retryMode) {
    this.error = error instanceof Error ? error.message : "Resolver non disponibile";
    if (error?.code !== "PROVIDER_UNAVAILABLE") {
      this.clearProviderFailure();
      return false;
    }
    this.providerUnavailable = true;
    if (error.retryable === false) {
      this.providerRetryMode = null;
      this.providerRetryAfterSeconds = null;
      return true;
    }
    this.providerRetryMode = retryMode;
    const retryAfter = error.retryAfterSeconds;
    this.providerRetryAfterSeconds = retryAfter !== null && retryAfter !== undefined
      && Number.isFinite(Number(retryAfter))
      ? Math.max(0, Math.ceil(Number(retryAfter))) : null;
    return true;
  }

  async run(task, { providerRetryMode = null } = {}) {
    this.busy = true;
    this.error = null;
    this.notice = null;
    this.clearProviderFailure();
    this.render();
    try { await task(); }
    catch (error) {
      if (!providerRetryMode || !this.captureProviderFailure(error, providerRetryMode)) {
        this.error = error instanceof Error ? error.message : "Resolver non disponibile";
      }
    }
    finally { this.busy = false; this.render(); }
  }

  resetSubjectSearch(query) {
    this.query = normalizeSemanticQuery(query);
    this.localResults = [];
    this.localSuggestions = [];
    this.externalResults = [];
    this.selectedCandidate = null;
    this.provider = null;
    this.localSearched = false;
    this.externalSearched = false;
    this.manualAvailable = false;
    this.error = null;
    this.notice = null;
    this.externalQuery = null;
    this.clearProviderFailure();
  }

  externalResultsNotice(defaultMessage) {
    if (!this.externalQuery?.variantApplied) return defaultMessage;
    if (this.externalQuery.variantUnavailable) {
      return `Risultati caricati per la frase inserita. La variante “${this.externalQuery.variant}” non era disponibile.`;
    }
    return `Risultati della frase inserita integrati con la variante “${this.externalQuery.variant}”.`;
  }

  async runSubjectSearch(query) {
    const requestId = ++this.searchRequestId;
    this.resetSubjectSearch(query);
    this.busy = true;
    this.render();
    try {
      let result;
      if (this.venueId) {
        const venueResult = await semanticRepository.searchVenueSubjects(this.venueId, this.query);
        this.venueContext = { venue: venueResult.venue, permissions: venueResult.permissions };
        this.localSuggestions = venueResult.suggestions || [];
        if ((venueResult.exact || []).length) {
          result = {
            localResults: venueResult.exact,
            externalResults: [],
            externalSearched: false,
            provider: null,
            externalQuery: null,
          };
        } else {
          const external = await searchExternalCandidates({
            repository: semanticRepository,
            query: this.query,
            entityKind: this.entityKind,
            retryWithoutItalianArticle: true,
          });
          result = {
            localResults: [],
            externalResults: external.candidates,
            externalSearched: true,
            provider: external.provider,
            externalQuery: external.query,
          };
        }
      } else {
        result = await searchSubjectCascade({
          repository: semanticRepository,
          query: this.query,
          entityKind: this.entityKind,
        });
      }
      if (requestId !== this.searchRequestId) return;
      this.localSearched = true;
      this.localResults = result.localResults;
      this.externalResults = result.externalResults;
      this.externalSearched = result.externalSearched;
      this.provider = result.provider;
      this.externalQuery = result.externalQuery;
      if (this.localResults.length) {
        this.notice = `${this.localResults.length} ${this.localResults.length === 1 ? "soggetto ArtAround trovato" : "soggetti ArtAround trovati"}.`;
      } else if (this.externalResults.length) {
        this.notice = this.externalResultsNotice("Nessun soggetto con lo stesso nome in ArtAround: risultati Wikidata caricati automaticamente.");
      } else {
        this.notice = "Nessun risultato in ArtAround o Wikidata. Puoi creare un nuovo soggetto manualmente.";
        this.manualAvailable = true;
      }
    } catch (error) {
      if (requestId !== this.searchRequestId) return;
      this.localSearched = true;
      this.externalSearched = true;
      this.manualAvailable = this.captureProviderFailure(error, "subject");
      if (!this.manualAvailable) this.error = error instanceof Error ? error.message : "Resolver non disponibile";
    } finally {
      if (requestId === this.searchRequestId) {
        this.busy = false;
        this.render();
      }
    }
  }

  async runExternalContinuation() {
    const requestId = ++this.searchRequestId;
    this.busy = true;
    this.error = null;
    this.notice = null;
    this.selectedCandidate = null;
    this.externalResults = [];
    this.externalSearched = false;
    this.manualAvailable = false;
    this.externalQuery = null;
    this.clearProviderFailure();
    this.render();
    try {
      const result = await searchExternalCandidates({
        repository: semanticRepository,
        query: this.query,
        entityKind: this.entityKind,
        retryWithoutItalianArticle: true,
      });
      if (requestId !== this.searchRequestId) return;
      this.provider = result.provider;
      this.externalResults = result.candidates;
      this.externalSearched = true;
      this.externalQuery = result.query;
      if (this.externalResults.length) {
        this.notice = this.externalResultsNotice("Risultati Wikidata aggiunti alla ricerca.");
      } else {
        this.notice = "Nessun altro risultato. Puoi creare un nuovo soggetto manualmente.";
        this.manualAvailable = true;
      }
    } catch (error) {
      if (requestId !== this.searchRequestId) return;
      this.externalSearched = true;
      this.manualAvailable = this.captureProviderFailure(error, "subject");
      if (!this.manualAvailable) this.error = error instanceof Error ? error.message : "Resolver non disponibile";
    } finally {
      if (requestId === this.searchRequestId) {
        this.busy = false;
        this.render();
      }
    }
  }

  async runMappingSearch(query) {
    this.query = normalizeSemanticQuery(query);
    this.externalResults = [];
    this.selectedCandidate = null;
    this.provider = null;
    this.externalQuery = null;
    await this.run(async () => {
      const result = await searchExternalCandidates({
        repository: semanticRepository,
        query: this.query,
        entityKind: this.entityKind,
      });
      this.provider = result.provider;
      this.externalResults = result.candidates;
      if (!this.externalResults.length) this.notice = "Nessuna candidate esterna trovata.";
    }, { providerRetryMode: "mapping" });
  }

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    event.preventDefault();
    event.stopPropagation();
    const data = new FormData(form);

    if (form.matches("[data-subject-search]")) {
      await this.runSubjectSearch(String(data.get("query") || ""));
      return;
    }

    if (form.matches("[data-external-search]")) {
      await this.runMappingSearch(String(data.get("query") || ""));
      return;
    }

    if (form.matches("[data-local-create]")) {
      await this.run(async () => {
        const subject = await semanticRepository.createLocalSubject({
          preferredLabel: String(data.get("preferredLabel") || "").trim(),
          description: String(data.get("description") || "").trim(),
        });
        this.emit("subject-selected", { subject, source: "local_created" });
        this.notice = "Soggetto locale creato e selezionato.";
        this.manualAvailable = false;
      });
      return;
    }

  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const retryExternal = target?.closest("button[data-retry-external]");
    if (retryExternal) {
      if (this.providerRetryMode === "mapping") this.runMappingSearch(this.query);
      else this.runExternalContinuation();
      return;
    }
    const continueExternal = target?.closest("button[data-continue-external]");
    if (continueExternal) {
      this.runExternalContinuation();
      return;
    }
    const showManual = target?.closest("button[data-show-manual]");
    if (showManual) {
      this.manualAvailable = true;
      this.notice = "Creazione manuale disponibile: verifica prima che nessun risultato corrisponda al soggetto desiderato.";
      this.render();
      return;
    }
    const local = target?.closest("button[data-local-subject]");
    if (local) {
      const subject = [...this.localResults, ...this.localSuggestions]
        .find((entry) => subjectId(entry) === local.dataset.localSubject);
      if (subject) this.emit("subject-selected", { subject, source: "local_existing" });
      return;
    }

    const candidateButton = target?.closest("button[data-external-candidate]");
    if (!candidateButton) return;
    const candidate = this.externalResults.find((entry) => entry.id === candidateButton.dataset.externalCandidate);
    if (!candidate) return;
    if (this.mode === "mapping") {
      const matchType = this.shadowRoot.querySelector("select[data-match-type]")?.value || "exact";
      this.emit("semantic-ref-selected", {
        semanticRef: { scheme: candidate.scheme, id: candidate.id, matchType },
        candidate,
      });
      this.notice = "Mapping aggiunto alla definizione.";
      this.render();
      return;
    }
    if (candidate.alreadyBoundSubject) {
      this.emit("subject-selected", { subject: candidate.alreadyBoundSubject, source: "reuse_existing" });
      this.notice = "Riutilizzato il soggetto già collegato a questa identità.";
      this.render();
      return;
    }
    this.selectedCandidate = candidate;
    await this.run(async () => {
      const result = await semanticRepository.createSubjectFromExternalIdentity({
        scheme: candidate.scheme,
        id: candidate.requestedId || candidate.id,
        preferredLabel: candidate.label,
        description: candidate.description || "",
        locale: "it",
      });
      this.notice = result.created ? "Soggetto verificato creato e selezionato." : "Identità già presente: riutilizzato il soggetto esistente.";
      this.emit("subject-selected", { subject: result.subject, source: result.outcome, resolution: result.resolution });
    });
    if (this.error) {
      this.selectedCandidate = null;
      this.render();
    }
  };

  renderLocalResults() {
    if (!this.localResults.length) return "";
    return `<section class="result-group"><div class="result-heading"><div><span class="result-source">ArtAround · identità condivise</span><strong>Soggetti con lo stesso nome</strong></div><span class="result-count">${this.localResults.length}</span></div><ul class="resolver-results">${this.localResults.map((subject) => `<li><div><strong>${escapeHtml(subject.preferredLabel)}</strong><small>${escapeHtml(subject.description || "Senza descrizione")}</small>${subject.state ? `<span class="bound">Inventario della sede · ${escapeHtml({ exposed: "Esposta", unplaced: "Da collocare", unavailable: "Non disponibile" }[subject.state] || subject.state)}</span>` : ""}</div><button type="button" data-local-subject="${escapeHtml(subjectId(subject))}">Usa</button></li>`).join("")}</ul></section>`;
  }

  renderLocalSuggestions() {
    if (!this.localSuggestions.length) return "";
    return `<section class="result-group"><div class="result-heading"><div><span class="result-source">ArtAround · verifica consigliata</span><strong>Possibili corrispondenze nella sede</strong></div><span class="result-count">${this.localSuggestions.length}</span></div><ul class="resolver-results">${this.localSuggestions.map((subject) => `<li><div><strong>${escapeHtml(subject.preferredLabel)}</strong><small>${escapeHtml(subject.description || "Senza descrizione")}</small>${subject.state ? `<span class="bound">Inventario della sede · ${escapeHtml({ exposed: "Esposta", unplaced: "Da collocare", unavailable: "Non disponibile" }[subject.state] || subject.state)}</span>` : ""}</div><button type="button" data-local-subject="${escapeHtml(subjectId(subject))}">Usa</button></li>`).join("")}</ul></section>`;
  }

  renderExternalResults() {
    if (!this.externalResults.length) return "";
    const queryMatch = (candidate) => {
      if (!this.externalQuery?.variantApplied || !candidate.queryMatches?.length) return "";
      const requested = candidate.queryMatches.includes("requested");
      const variant = candidate.queryMatches.includes("variant");
      const label = requested && variant
        ? "Trovato con entrambe le forme"
        : variant ? "Trovato senza l’articolo iniziale" : "Trovato con la frase inserita";
      return `<span class="query-match">${escapeHtml(label)}</span>`;
    };
    return `<section class="result-group"><div class="result-heading"><div><span class="result-source">Wikidata</span><strong>${this.mode === "mapping" ? "Concetti esterni" : "Corrispondenze verificate"}</strong></div><span class="result-count">${this.externalResults.length}</span></div><ul class="resolver-results">${this.externalResults.map((candidate) => { const selected = this.mode === "subject" && this.selectedCandidate?.id === candidate.id; const action = this.mode === "mapping" ? "Aggiungi" : candidate.alreadyBoundSubject ? "Usa esistente" : selected ? icon("check", { size: 17 }) : "Seleziona"; return `<li><div><strong>${escapeHtml(candidate.label || candidate.id)}</strong><small>${escapeHtml(candidate.description || "Nessuna descrizione disponibile")}</small><span class="identity">${escapeHtml(candidate.scheme)} · ${escapeHtml(candidate.id)}${candidate.resolutionStatus === "redirected" ? " · redirect verificato" : ""}</span>${queryMatch(candidate)}${candidate.alreadyBoundSubject ? `<span class="bound">Già presente in ArtAround come ${escapeHtml(candidate.alreadyBoundSubject.preferredLabel)}</span>` : ""}</div><button type="button" data-external-candidate="${escapeHtml(candidate.id)}" ${selected ? `aria-label="Soggetto selezionato"` : ""}>${action}</button></li>`; }).join("")}</ul>${this.mode === "subject" ? `<div class="result-actions"><span>Nessuna corrispondenza è quella giusta?</span><button class="button-secondary" type="button" data-show-manual>Crea manualmente</button></div>` : ""}</section>`;
  }

  renderSubjectSearch() {
    const canContinueExternally = this.localResults.length > 0 && !this.externalSearched;
    return `<form class="unified-search" data-subject-search role="search"><label>Cerca ciò di cui vuoi parlare<input name="query" required value="${escapeHtml(this.query)}" placeholder="Opera, persona, stile, concetto o QID" autocomplete="off"></label><button ${this.busy ? "disabled" : ""}>${icon("search", { size: 16 })} Cerca</button></form>
      <p class="search-explanation">${this.venueId ? "Diamo priorità alle identità già presenti o usate dalla sede. Se non troviamo lo stesso nome, continuiamo automaticamente su Wikidata." : "Cerchiamo prima tra le identità già condivise in ArtAround. Se non troviamo quella corretta, continuiamo automaticamente su Wikidata."}</p>
      ${this.renderLocalResults()}
      ${this.renderLocalSuggestions()}
      ${canContinueExternally ? `<div class="continue-search"><div><strong>Non è quello che cercavi?</strong><small>Estendi la stessa ricerca a Wikidata.</small></div><button class="button-secondary" type="button" data-continue-external ${this.busy ? "disabled" : ""}>Cerca anche su Wikidata</button></div>` : ""}
      ${this.renderExternalResults()}`;
  }

  renderManualCreation() {
    if (this.mode !== "subject" || !this.manualAvailable) return "";
    const providerUnavailable = this.providerUnavailable;
    return `<section class="manual-create"><div><span class="result-source">Creazione manuale</span><strong>${providerUnavailable ? "Wikidata non è disponibile" : "Nessuna identità corrispondente"}</strong><p>${providerUnavailable ? "La verifica esterna non è riuscita. Puoi comunque creare un soggetto disponibile solo in ArtAround." : "Crea un nuovo soggetto in ArtAround. Potrà essere riconciliato con un'identità esterna in futuro."}</p></div><form data-local-create><label>Nome<input name="preferredLabel" required value="${escapeHtml(this.query)}"></label><label>Descrizione<textarea name="description" placeholder="Aggiungi un contesto che lo renda riconoscibile"></textarea></label><button ${this.busy ? "disabled" : ""}>Crea soggetto</button></form></section>`;
  }

  renderProviderRetry() {
    if (!this.providerRetryMode) return "";
    const waitMessage = this.providerRetryAfterSeconds === null
      ? "Puoi effettuare subito un nuovo tentativo."
      : `Wikidata consiglia di attendere almeno ${this.providerRetryAfterSeconds} ${this.providerRetryAfterSeconds === 1 ? "secondo" : "secondi"}.`;
    return `<section class="provider-retry" role="status"><div><strong>La ricerca esterna può essere ripetuta</strong><span>${escapeHtml(waitMessage)}</span></div><button class="button-secondary" type="button" data-retry-external ${this.busy ? "disabled" : ""}>Riprova Wikidata</button></section>`;
  }

  render() {
    const mapping = this.mode === "mapping";
    this.shadowRoot.innerHTML = `<style>
      :host{display:block}.resolver{display:grid;gap:.8rem;padding:.9rem;border:1px solid #c9d4cf;border-radius:.75rem;background:#fbfcfa;color:#173e35}.resolver h4{margin:0;color:#173e35}.resolver p{margin:.15rem 0;color:#5e6d67}.resolver form{display:flex;gap:.5rem;align-items:end;flex-wrap:wrap}.resolver label{display:grid;gap:.3rem;flex:1;min-width:12rem;font-size:.82rem;font-weight:700}.resolver input,.resolver select,.resolver textarea{box-sizing:border-box;width:100%;padding:.62rem;border:1px solid #aebbb5;border-radius:.5rem;background:#fff;font:inherit}.resolver input:focus,.resolver select:focus,.resolver textarea:focus{outline:3px solid #b9d9cf;outline-offset:1px;border-color:#2f7561}.resolver button{padding:.6rem .76rem;border:0;border-radius:.5rem;background:#173e35;color:white;font:inherit;font-weight:750;cursor:pointer}.resolver button:disabled{cursor:wait;opacity:.6}.resolver .button-secondary{border:1px solid #8ea69e;background:#fff;color:#173e35}.unified-search{padding:.35rem;border-radius:.65rem;background:#eef3f0}.search-explanation{font-size:.8rem}.result-group{display:grid;gap:.5rem}.result-heading{display:flex;align-items:end;justify-content:space-between;gap:.5rem}.result-heading>div{display:grid;gap:.12rem}.result-source{display:block;color:#2f7561;font-size:.7rem;font-weight:850;letter-spacing:.07em;text-transform:uppercase}.result-count{display:grid;place-items:center;min-width:1.8rem;min-height:1.8rem;border-radius:999px;background:#dce9e4;font-size:.75rem;font-weight:850}.resolver-results{display:grid;gap:.45rem;padding:0;margin:0;list-style:none}.resolver-results li{display:flex;align-items:center;justify-content:space-between;gap:.7rem;padding:.72rem;border:1px solid #d7e0dc;border-radius:.6rem;background:#fff}.resolver-results li>div{min-width:0}.resolver-results small,.resolver-results span{display:block}.identity{margin-top:.25rem;font:700 .72rem/1.2 ui-monospace,monospace;color:#46625a}.query-match{margin-top:.28rem;color:#5e6d67;font-size:.72rem;font-weight:750}.bound{margin-top:.3rem;padding:.28rem .38rem;border-radius:.35rem;background:#dcefe7;color:#176143;font-size:.75rem;font-weight:800}.result-actions,.continue-search,.provider-retry{display:flex;align-items:center;justify-content:space-between;gap:.65rem;padding:.6rem;border-radius:.55rem;background:#eef3f0;font-size:.78rem}.continue-search>div,.provider-retry>div{display:grid;gap:.1rem}.continue-search small,.provider-retry span{color:#5e6d67}.provider-retry{border:1px solid #d6c58c;background:#fff9e8}.resolver-feedback{padding:.6rem;border-radius:.5rem;background:#eef3f0}.resolver-error{background:#f8e8e4;color:#842f22}.manual-create{display:grid;gap:.55rem;padding:.75rem;border-left:3px solid #2f7561;background:#eef5f2}.manual-create form{display:grid}.attribution{font-size:.72rem;color:#285f50}@media(max-width:560px){.resolver{padding:.72rem}.resolver form,.resolver-results li,.result-actions,.continue-search,.provider-retry{align-items:stretch;flex-direction:column}.resolver button{width:100%}.resolver label{min-width:0}}
    </style><section class="resolver" aria-busy="${this.busy}">
      <div><h4>${mapping ? "Collega un concetto esterno" : "Trova o crea il soggetto corretto"}</h4><p>${mapping ? "Il mapping descrive il rapporto tra questa definizione e un vocabolario esterno." : "ArtAround riusa un'identità condivisa quando esiste e ne crea una nuova solo quando serve."}</p></div>
      ${mapping ? `<form data-external-search><label>Wikidata · ${this.entityKind === "property" ? "Property" : "Item"}<input name="query" required value="${escapeHtml(this.query)}" placeholder="Testo o ${this.entityKind === "property" ? "P" : "Q"}ID"></label><label>Relazione<select data-match-type><option value="exact">exact · stesso significato</option><option value="close">close · molto vicino</option><option value="broader">broader · esterno più ampio</option><option value="narrower">narrower · esterno più specifico</option></select></label><button ${this.busy ? "disabled" : ""}>${icon("search", { size: 15 })} Cerca su Wikidata</button></form>${this.renderExternalResults()}` : this.renderSubjectSearch()}
      ${this.renderProviderRetry()}
      ${this.renderManualCreation()}
      ${this.busy ? `<p class="resolver-feedback" role="status">Interrogazione in corso…</p>` : ""}
      ${this.notice ? `<p class="resolver-feedback" role="status">${escapeHtml(this.notice)}</p>` : ""}
      ${this.error ? `<p class="resolver-feedback resolver-error" role="alert">${escapeHtml(this.error)}${!mapping && this.manualAvailable ? " Puoi comunque creare un soggetto locale." : ""}</p>` : ""}
      ${this.provider ? `<a class="attribution" href="${escapeHtml(this.provider.attribution.url)}" target="_blank" rel="noreferrer">${escapeHtml(this.provider.attribution.label)}</a>` : ""}
    </section>`;
  }
}

if (!customElements.get("artaround-semantic-entity-picker")) {
  customElements.define("artaround-semantic-entity-picker", ArtAroundSemanticEntityPicker);
}
