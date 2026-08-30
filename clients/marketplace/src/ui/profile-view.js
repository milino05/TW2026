import { navigate } from "../application/router.js";
import { accountRepository } from "../infrastructure/http/account-repository.js";
import { icon } from "./icons.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function number(value, fallback = 0.5) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function checked(value) { return value === true ? "checked" : ""; }
function roleLabel(roles = []) { return roles.map((role) => role.name).join(" · ") || "Membro"; }
function stateLabel(resource, published = "Pubblicata") { const mode = resource.state?.mode; const label = mode === "working" ? "Bozza" : mode === "published" ? published : "Da configurare"; return `${label}${resource.state?.version ? ` · v${resource.state.version}` : ""}`; }
function organizationUrl(organizationId, section = "overview") { const params = new URLSearchParams({ organizationId: String(organizationId), section }); return `/organizations/detail?${params.toString()}`; }
const ACCOUNT_SECTIONS = new Set(["account-overview", "account-preferences", "account-organizations", "account-rules", "account-physical"]);
function accountSectionFromHash() { const requested = String(window.location.hash || "").replace(/^#/, ""); return ACCOUNT_SECTIONS.has(requested) ? requested : null; }

export class ArtAroundProfileView extends HTMLElement {
  workspace = null;
  busy = false;
  error = null;
  message = null;
  activeSection = "account-overview";

  connectedCallback() { this.activeSection = accountSectionFromHash() || "account-overview"; this.addEventListener("submit", this.onSubmit); this.addEventListener("click", this.onClick); this.load(); }
  disconnectedCallback() { this.removeEventListener("submit", this.onSubmit); this.removeEventListener("click", this.onClick); }

  async load() {
    this.busy = true; this.error = null; this.render();
    try { this.workspace = await accountRepository.workspace(); }
    catch (error) { this.error = error instanceof Error ? error.message : "Account non disponibile"; }
    finally {
      this.busy = false;
      const requestedSection = accountSectionFromHash();
      this.activeSection = requestedSection || "account-overview";
      this.render();
      if (requestedSection) this.scrollToSection(requestedSection, { behavior: "auto" });
    }
  }
  async execute(callback, message) {
    this.busy = true; this.error = null; this.message = null; this.render();
    let result = null;
    try { result = await callback(); this.message = message; this.workspace = await accountRepository.workspace(); }
    catch (error) { this.error = error instanceof Error ? error.message : "Operazione non riuscita"; }
    finally { this.busy = false; this.render(); }
    return result;
  }

  onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const accountSection = target?.closest("a[data-account-section]");
    if (accountSection) { event.preventDefault(); this.scrollToSection(accountSection.dataset.accountSection, { updateHistory: true }); return; }
    if (target?.closest("[data-context-hub]")) { navigate("/context"); return; }
    const section = target?.closest("[data-organization-section]");
    if (section) { navigate(organizationUrl(section.dataset.organization, section.dataset.organizationSection)); return; }
    const organization = target?.closest("[data-organization]");
    if (organization) { navigate(organizationUrl(organization.dataset.organization)); return; }
    const namespace = target?.closest("[data-namespace]");
    if (namespace) { navigate(`/namespaces/editor?namespaceId=${encodeURIComponent(namespace.dataset.namespace)}`); return; }
    const physicalVocabulary = target?.closest("[data-physical-vocabulary]");
    if (physicalVocabulary) navigate(`/physical-vocabularies/editor?physicalVocabularyId=${encodeURIComponent(physicalVocabulary.dataset.physicalVocabulary)}`);
  };

  scrollToSection(sectionId, { updateHistory = false, behavior = "smooth" } = {}) {
    const normalized = ACCOUNT_SECTIONS.has(sectionId) ? sectionId : "account-overview";
    const section = this.querySelector(`#${normalized}`);
    if (!section) return;
    this.activeSection = normalized;
    this.querySelectorAll("a[data-account-section]").forEach((link) => link.setAttribute("aria-current", link.dataset.accountSection === normalized ? "page" : "false"));
    if (updateHistory) {
      const nextUrl = `${window.location.pathname}${window.location.search}#${normalized}`;
      if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== nextUrl) window.history.pushState({}, "", nextUrl);
    }
    requestAnimationFrame(() => { section.scrollIntoView({ behavior, block: "start" }); section.focus({ preventScroll: true }); });
  }

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    const data = new FormData(form);
    if (form.matches("[data-create-namespace]")) {
      event.preventDefault();
      const created = await this.execute(() => accountRepository.createNamespace({ ownerType: "user", ownerId: this.workspace.account.id, name: String(data.get("name") || ""), description: String(data.get("description") || "") }), "Regole editoriali personali create.");
      const createdId = created?.namespace?._id || created?.namespace?.id;
      if (createdId) navigate(`/namespaces/editor?namespaceId=${encodeURIComponent(createdId)}`);
    } else if (form.matches("[data-create-physical-vocabulary]")) {
      event.preventDefault();
      const created = await this.execute(() => accountRepository.createPhysicalVocabulary({
        ownerType: "user", ownerId: this.workspace.account.id,
        name: String(data.get("name") || ""), description: String(data.get("description") || ""),
        applyStarter: String(data.get("startingPoint") || "starter") !== "blank",
      }), "Vocabolario fisico personale creato.");
      const createdId = created?.physicalVocabulary?._id || created?.physicalVocabulary?.id;
      if (createdId) navigate(`/physical-vocabularies/editor?physicalVocabularyId=${encodeURIComponent(createdId)}`);
    } else if (form.matches("[data-presentation-preference]")) {
      event.preventDefault();
      await this.execute(() => accountRepository.updatePresentationPreference({ depthPreference: number(data.get("depthPreference")), languageComplexityPreference: number(data.get("languageComplexityPreference")) }), "Preferenze di presentazione aggiornate.");
    } else if (form.matches("[data-navigation-preference]")) {
      event.preventDefault();
      await this.execute(() => accountRepository.updateNavigationPreference({ movementPacePreference: number(data.get("movementPacePreference")), requirements: this.workspace.account.defaultNavigationPreference?.requirements || [] }), "Preferenza di movimento aggiornata.");
    } else if (form.matches("[data-learning-preference]")) {
      event.preventDefault();
      await this.execute(() => accountRepository.updateLearningPreferences({ personalHistory: data.get("personalHistory") === "on", collectiveContribution: data.get("collectiveContribution") === "on" }), "Preferenze adattive aggiornate.");
    }
  };

  renderOrganizations(organizations) {
    const cards = organizations.map((entry) => {
      const sections = new Set((entry.availableSections || []).map((section) => section.code));
      const counts = [
        Number.isFinite(entry.counts?.members) ? `<div><dt>Persone</dt><dd>${entry.counts.members}</dd></div>` : "",
        Number.isFinite(entry.counts?.venues) ? `<div><dt>Sedi</dt><dd>${entry.counts.venues}</dd></div>` : "",
        Number.isFinite(entry.counts?.namespaces) ? `<div><dt>Regole</dt><dd>${entry.counts.namespaces}</dd></div>` : "",
        Number.isFinite(entry.counts?.physicalVocabularies) ? `<div><dt>Vocabolari fisici</dt><dd>${entry.counts.physicalVocabularies}</dd></div>` : "",
      ].join("");
      return `<article class="account-resource-card"><header><span class="resource-mark">${icon("building", { size: 20 })}</span><div><span class="eyebrow">${escapeHtml(roleLabel(entry.roles))}</span><h3>${escapeHtml(entry.name)}</h3>${entry.isOwner ? `<span class="owner-badge">Owner</span>` : ""}</div></header><p>${escapeHtml(entry.description || "Nessuna descrizione disponibile.")}</p>${counts ? `<dl class="account-counts">${counts}</dl>` : ""}<div class="account-card-actions"><button type="button" data-organization="${escapeHtml(entry.id)}">Apri organizzazione ${icon("chevron", { size: 15 })}</button>${sections.has("venues") ? `<button class="button-secondary" type="button" data-organization="${escapeHtml(entry.id)}" data-organization-section="venues">Sedi</button>` : ""}${sections.has("rules") ? `<button class="button-secondary" type="button" data-organization="${escapeHtml(entry.id)}" data-organization-section="rules">Regole editoriali</button>` : ""}${sections.has("physical") ? `<button class="button-secondary" type="button" data-organization="${escapeHtml(entry.id)}" data-organization-section="physical">Vocabolari fisici</button>` : ""}</div></article>`;
    }).join("");
    return cards || `<div class="empty-state account-empty">${icon("building", { size: 26 })}<h3>Nessuna organizzazione</h3><p>Puoi crearne una dalla schermata in cui scegli l'area di lavoro.</p></div>`;
  }
  renderPersonalRules(personalNamespaces) {
    const cards = personalNamespaces.map((entry) => `<article class="account-resource-card"><header><span class="resource-mark">${icon("book", { size: 20 })}</span><div><span class="eyebrow">${escapeHtml(stateLabel(entry, "Private"))}</span><h3>${escapeHtml(entry.name)}</h3></div></header><p>${escapeHtml(entry.description || "Nessuna descrizione disponibile.")}</p><button type="button" data-namespace="${escapeHtml(entry.id)}">Modifica regole editoriali ${icon("chevron", { size: 15 })}</button></article>`).join("");
    return cards || `<div class="empty-state account-empty">${icon("book", { size: 26 })}<h3>Nessuna regola editoriale personale</h3><p>Creale se vuoi definire un vocabolario e criteri editoriali di tua proprietà.</p></div>`;
  }
  renderPersonalPhysicalVocabularies(personalPhysicalVocabularies) {
    const cards = personalPhysicalVocabularies.map((entry) => `<article class="account-resource-card"><header><span class="resource-mark">${icon("route", { size: 20 })}</span><div><span class="eyebrow">${escapeHtml(stateLabel(entry))}</span><h3>${escapeHtml(entry.name)}</h3></div></header><p>${escapeHtml(entry.description || "Linguaggio fisico riutilizzabile per sedi e routing.")}</p><button type="button" data-physical-vocabulary="${escapeHtml(entry.id)}">Configura vocabolario fisico ${icon("chevron", { size: 15 })}</button></article>`).join("");
    return cards || `<div class="empty-state account-empty">${icon("route", { size: 26 })}<h3>Nessun vocabolario fisico personale</h3><p>Creane uno se vuoi sviluppare e pubblicare un linguaggio fisico indipendente da un'organizzazione.</p></div>`;
  }
  renderPreferences(presentation, navigation, learning) {
    return `<section class="account-section" id="account-preferences" tabindex="-1"><div class="section-heading"><div><span class="eyebrow">Preferenze visita</span><h2>Come vuoi vivere le visite</h2><p>Queste impostazioni aiutano il Navigator a personalizzare l'esperienza.</p></div></div><div class="account-preferences"><form class="panel" data-presentation-preference><div class="preference-heading"><span>${icon("book", { size: 20 })}</span><div><h3>Presentazione</h3><p>Regola profondità e linguaggio.</p></div></div><label>Profondità <input type="range" min="0" max="1" step="0.05" name="depthPreference" value="${number(presentation.depthPreference)}"><span class="range-labels"><small>Essenziale</small><small>Approfondita</small></span></label><label>Complessità linguistica <input type="range" min="0" max="1" step="0.05" name="languageComplexityPreference" value="${number(presentation.languageComplexityPreference)}"><span class="range-labels"><small>Semplice</small><small>Specialistica</small></span></label><button>${icon("check", { size: 16 })} Salva</button></form><form class="panel" data-navigation-preference><div class="preference-heading"><span>${icon("route", { size: 20 })}</span><div><h3>Movimento</h3><p>Definisci il ritmo della visita.</p></div></div><label>Ritmo preferito <input type="range" min="0" max="1" step="0.05" name="movementPacePreference" value="${number(navigation.movementPacePreference)}"><span class="range-labels"><small>Rilassato</small><small>Sostenuto</small></span></label><button>${icon("check", { size: 16 })} Salva</button></form><form class="panel" data-learning-preference><div class="preference-heading"><span>${icon("user", { size: 20 })}</span><div><h3>Adattamento</h3><p>Controlla l'uso dei segnali personali.</p></div></div><label class="check"><input type="checkbox" name="personalHistory" ${checked(learning.personalHistory)}> <span>Usa la mia cronologia</span></label><label class="check"><input type="checkbox" name="collectiveContribution" ${checked(learning.collectiveContribution)}> <span>Contribuisci in forma pseudonima</span></label><button>${icon("check", { size: 16 })} Salva</button></form></div></section>`;
  }

  render() {
    if (!this.workspace) { this.innerHTML = `<main class="page account-page"><p role="${this.error ? "alert" : "status"}">${escapeHtml(this.error || "Caricamento account…")}</p></main>`; return; }
    const { account, organizations, personalNamespaces, personalPhysicalVocabularies = [] } = this.workspace;
    const presentation = account.defaultPresentationPreference || { depthPreference: 0.5, languageComplexityPreference: 0.5 };
    const navigation = account.defaultNavigationPreference || { movementPacePreference: 0.5 };
    const learning = account.learningPreferences || {};
    this.innerHTML = `<main class="page account-page" aria-busy="${this.busy}"><header class="account-header"><div><span class="eyebrow">Account ArtAround</span><h1>${escapeHtml(account.username)}</h1><p>Profilo, preferenze personali, accessi alle organizzazioni e strumenti editoriali avanzati.</p></div><div class="account-avatar" aria-hidden="true">${escapeHtml(account.username.slice(0, 2).toUpperCase())}</div></header><nav class="account-tabs" aria-label="Sezioni account"><a href="#account-overview" data-account-section="account-overview" aria-controls="account-overview" aria-current="${this.activeSection === "account-overview" ? "page" : "false"}">Profilo</a><a href="#account-preferences" data-account-section="account-preferences" aria-controls="account-preferences" aria-current="${this.activeSection === "account-preferences" ? "page" : "false"}">Preferenze visita</a><a href="#account-organizations" data-account-section="account-organizations" aria-controls="account-organizations" aria-current="${this.activeSection === "account-organizations" ? "page" : "false"}">Organizzazioni <span>${organizations.length}</span></a><a href="#account-rules" data-account-section="account-rules" aria-controls="account-rules" aria-current="${this.activeSection === "account-rules" ? "page" : "false"}">Regole editoriali <span>${personalNamespaces.length}</span></a><a href="#account-physical" data-account-section="account-physical" aria-controls="account-physical" aria-current="${this.activeSection === "account-physical" ? "page" : "false"}">Vocabolari fisici <span>${personalPhysicalVocabularies.length}</span></a></nav>${this.busy ? `<p role="status">Aggiornamento…</p>` : ""}${this.message ? `<p role="status">${icon("check", { size: 16 })} ${escapeHtml(this.message)}</p>` : ""}${this.error ? `<p role="alert">${icon("warning", { size: 16 })} ${escapeHtml(this.error)}</p>` : ""}<section class="account-overview" id="account-overview" tabindex="-1"><div><span class="eyebrow">Profilo</span><h2>Il tuo account</h2><p>Sei sempre autenticato con questo account. L'area di lavoro selezionata determina soltanto dove vengono create, acquisite e pubblicate le risorse.</p></div><dl class="account-summary"><div><dt>Organizzazioni</dt><dd>${organizations.length}</dd></div><div><dt>Regole editoriali personali</dt><dd>${personalNamespaces.length}</dd></div><div><dt>Vocabolari fisici personali</dt><dd>${personalPhysicalVocabularies.length}</dd></div></dl></section>${this.renderPreferences(presentation, navigation, learning)}<section class="account-section" id="account-organizations" tabindex="-1"><div class="section-heading"><div><span class="eyebrow">Accessi</span><h2>Organizzazioni</h2><p>Qui controlli le organizzazioni di cui fai parte. Per lavorare in una di esse, cambiala dalla schermata delle aree di lavoro.</p></div><button type="button" data-context-hub>${icon("workspace", { size: 16 })} Cambia o crea area</button></div><div class="account-resource-grid">${this.renderOrganizations(organizations)}</div></section><section class="account-section" id="account-rules" tabindex="-1"><div class="section-heading"><div><span class="eyebrow">Strumenti editoriali</span><h2>Regole editoriali personali</h2><p>Namespace e criteri editoriali di tua proprietà, separati da quelli delle organizzazioni.</p></div><span class="count">${personalNamespaces.length}</span></div><div class="account-resource-grid">${this.renderPersonalRules(personalNamespaces)}</div><details class="account-create"><summary>${icon("plus", { size: 16 })} Crea regole editoriali personali</summary><form data-create-namespace><div class="namespace-create-intro"><strong>Da dove si parte?</strong><p>Crea il contenitore delle regole: nella schermata successiva troverai spiegazioni, tutorial e un modello già pronto facoltativo.</p></div><label>Nome<input name="name" required placeholder="Es. Regole della collezione permanente"><small>Usa un nome che faccia capire a quale progetto o collezione si applicano.</small></label><label>Scopo e pubblico<textarea name="description" placeholder="Es. Indicazioni per raccontare le opere a un pubblico adulto non specialista."></textarea></label><button>${icon("plus", { size: 16 })} Crea e configura</button></form></details></section><section class="account-section" id="account-physical" tabindex="-1"><div class="section-heading"><div><span class="eyebrow">Dominio fisico</span><h2>Vocabolari fisici personali</h2><p>Tipi di luoghi, collegamenti, caratteristiche e profili di routing di tua proprietà. Le Venue possono adottare revisioni pubblicate senza incorporarne una copia.</p></div><span class="count">${personalPhysicalVocabularies.length}</span></div><div class="account-resource-grid">${this.renderPersonalPhysicalVocabularies(personalPhysicalVocabularies)}</div><details class="account-create"><summary>${icon("plus", { size: 16 })} Crea vocabolario fisico personale</summary><form data-create-physical-vocabulary><div class="namespace-create-intro"><strong>Come vuoi partire?</strong><p>La configurazione base è consigliata e rimane completamente modificabile. Puoi anche iniziare da una bozza vuota.</p></div><label>Nome<input name="name" required placeholder="Es. Vocabolario fisico accessibile"></label><label>Descrizione<textarea name="description" placeholder="Quali esigenze fisiche e di routing deve coprire?"></textarea></label><fieldset><legend>Punto di partenza</legend><label class="check"><input type="radio" name="startingPoint" value="starter" checked><span><strong>Usa configurazione base</strong><small>Servizi, scale, ascensori, accessibilità e profili comuni già predisposti.</small></span></label><label class="check"><input type="radio" name="startingPoint" value="blank"><span><strong>Parti da zero</strong><small>Definisci manualmente ogni famiglia del vocabolario.</small></span></label></fieldset><button>${icon("plus", { size: 16 })} Crea e configura</button></form></details></section></main>`;
  }
}
customElements.define("artaround-profile-view", ArtAroundProfileView);
