import { navigate } from "../application/router.js";
import { accountRepository } from "../infrastructure/http/account-repository.js";
import { icon } from "./icons.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function number(value, fallback = 0.5) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function checked(value) { return value === true ? "checked" : ""; }
function roleLabel(role) { return role === "manager" ? "Manager" : "Operatore"; }
function stateLabel(namespace) { const mode = namespace.state?.mode; const label = mode === "working" ? "Bozza" : mode === "published" ? "Pubblicate" : "Da configurare"; return `${label}${namespace.state?.version ? ` · v${namespace.state.version}` : ""}`; }
function organizationUrl(organizationId, section = "overview") { const params = new URLSearchParams({ organizationId: String(organizationId), section }); return `/organizations/detail?${params.toString()}`; }
const ACCOUNT_SECTIONS = new Set(["account-overview", "account-preferences", "account-organizations", "account-rules"]);
function accountSectionFromHash() {
  const requested = String(window.location.hash || "").replace(/^#/, "");
  return ACCOUNT_SECTIONS.has(requested) ? requested : null;
}

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
    if (accountSection) {
      event.preventDefault();
      this.scrollToSection(accountSection.dataset.accountSection, { updateHistory: true });
      return;
    }
    if (target?.closest("[data-context-hub]")) { navigate("/context"); return; }
    const section = target?.closest("[data-organization-section]");
    if (section) { navigate(organizationUrl(section.dataset.organization, section.dataset.organizationSection)); return; }
    const organization = target?.closest("[data-organization]");
    if (organization) { navigate(organizationUrl(organization.dataset.organization)); return; }
    const namespace = target?.closest("[data-namespace]");
    if (namespace) navigate(`/namespaces/editor?namespaceId=${encodeURIComponent(namespace.dataset.namespace)}`);
  };

  scrollToSection(sectionId, { updateHistory = false, behavior = "smooth" } = {}) {
    const normalized = ACCOUNT_SECTIONS.has(sectionId) ? sectionId : "account-overview";
    const section = this.querySelector(`#${normalized}`);
    if (!section) return;
    this.activeSection = normalized;
    this.querySelectorAll("a[data-account-section]").forEach((link) => {
      link.setAttribute("aria-current", link.dataset.accountSection === normalized ? "page" : "false");
    });
    if (updateHistory) {
      const nextUrl = `${window.location.pathname}${window.location.search}#${normalized}`;
      if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== nextUrl) window.history.pushState({}, "", nextUrl);
    }
    requestAnimationFrame(() => {
      section.scrollIntoView({ behavior, block: "start" });
      section.focus({ preventScroll: true });
    });
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
    const cards = organizations.map((entry) => `<article class="account-resource-card"><header><span class="resource-mark">${icon("building", { size: 20 })}</span><div><span class="eyebrow">${escapeHtml(roleLabel(entry.role))}</span><h3>${escapeHtml(entry.name)}</h3></div></header><p>${escapeHtml(entry.description || "Nessuna descrizione disponibile.")}</p><dl class="account-counts"><div><dt>Persone</dt><dd>${entry.counts.members}</dd></div><div><dt>Sedi</dt><dd>${entry.counts.venues}</dd></div><div><dt>Regole</dt><dd>${entry.counts.namespaces}</dd></div></dl><div class="account-card-actions"><button type="button" data-organization="${escapeHtml(entry.id)}">Gestisci organizzazione ${icon("chevron", { size: 15 })}</button><button class="button-secondary" type="button" data-organization="${escapeHtml(entry.id)}" data-organization-section="venues">Sedi</button><button class="button-secondary" type="button" data-organization="${escapeHtml(entry.id)}" data-organization-section="rules">Regole editoriali</button></div></article>`).join("");
    return cards || `<div class="empty-state account-empty">${icon("building", { size: 26 })}<h3>Nessuna organizzazione</h3><p>Puoi crearne una dalla schermata in cui scegli l'area di lavoro.</p></div>`;
  }

  renderPersonalRules(personalNamespaces) {
    const cards = personalNamespaces.map((entry) => `<article class="account-resource-card"><header><span class="resource-mark">${icon("book", { size: 20 })}</span><div><span class="eyebrow">${escapeHtml(stateLabel(entry))}</span><h3>${escapeHtml(entry.name)}</h3></div></header><p>${escapeHtml(entry.description || "Nessuna descrizione disponibile.")}</p><button type="button" data-namespace="${escapeHtml(entry.id)}">Modifica regole editoriali ${icon("chevron", { size: 15 })}</button></article>`).join("");
    return cards || `<div class="empty-state account-empty">${icon("book", { size: 26 })}<h3>Nessuna regola editoriale personale</h3><p>Creale se vuoi definire un vocabolario e criteri editoriali di tua proprietà.</p></div>`;
  }

  render() {
    if (!this.workspace) { this.innerHTML = `<main class="page account-page"><p role="${this.error ? "alert" : "status"}">${escapeHtml(this.error || "Caricamento account…")}</p></main>`; return; }
    const { account, organizations, personalNamespaces } = this.workspace;
    const presentation = account.defaultPresentationPreference || { depthPreference: 0.5, languageComplexityPreference: 0.5 };
    const navigation = account.defaultNavigationPreference || { movementPacePreference: 0.5 };
    const learning = account.learningPreferences || {};
    this.innerHTML = `<main class="page account-page" aria-busy="${this.busy}"><header class="account-header"><div><span class="eyebrow">Account ArtAround</span><h1>${escapeHtml(account.username)}</h1><p>Profilo, preferenze personali, accessi alle organizzazioni e strumenti editoriali avanzati.</p></div><div class="account-avatar" aria-hidden="true">${escapeHtml(account.username.slice(0, 2).toUpperCase())}</div></header><nav class="account-tabs" aria-label="Sezioni account"><a href="#account-overview" data-account-section="account-overview" aria-controls="account-overview" aria-current="${this.activeSection === "account-overview" ? "page" : "false"}">Profilo</a><a href="#account-preferences" data-account-section="account-preferences" aria-controls="account-preferences" aria-current="${this.activeSection === "account-preferences" ? "page" : "false"}">Preferenze visita</a><a href="#account-organizations" data-account-section="account-organizations" aria-controls="account-organizations" aria-current="${this.activeSection === "account-organizations" ? "page" : "false"}">Organizzazioni <span>${organizations.length}</span></a><a href="#account-rules" data-account-section="account-rules" aria-controls="account-rules" aria-current="${this.activeSection === "account-rules" ? "page" : "false"}">Strumenti avanzati <span>${personalNamespaces.length}</span></a></nav>${this.busy ? `<p role="status">Aggiornamento…</p>` : ""}${this.message ? `<p role="status">${icon("check", { size: 16 })} ${escapeHtml(this.message)}</p>` : ""}${this.error ? `<p role="alert">${icon("warning", { size: 16 })} ${escapeHtml(this.error)}</p>` : ""}<section class="account-overview" id="account-overview" tabindex="-1"><div><span class="eyebrow">Profilo</span><h2>Il tuo account</h2><p>Sei sempre autenticato con questo account. L'area di lavoro selezionata determina soltanto dove vengono create, acquisite e pubblicate le risorse.</p></div><dl class="account-summary"><div><dt>Organizzazioni</dt><dd>${organizations.length}</dd></div><div><dt>Regole editoriali personali</dt><dd>${personalNamespaces.length}</dd></div></dl></section><section class="account-section" id="account-preferences" tabindex="-1"><div class="section-heading"><div><span class="eyebrow">Preferenze visita</span><h2>Come vuoi vivere le visite</h2><p>Queste impostazioni aiutano il Navigator a personalizzare l'esperienza.</p></div></div><div class="account-preferences"><form class="panel" data-presentation-preference><div class="preference-heading"><span>${icon("book", { size: 20 })}</span><div><h3>Presentazione</h3><p>Regola profondità e linguaggio.</p></div></div><label>Profondità <input type="range" min="0" max="1" step="0.05" name="depthPreference" value="${number(presentation.depthPreference)}"><span class="range-labels"><small>Essenziale</small><small>Approfondita</small></span></label><label>Complessità linguistica <input type="range" min="0" max="1" step="0.05" name="languageComplexityPreference" value="${number(presentation.languageComplexityPreference)}"><span class="range-labels"><small>Semplice</small><small>Specialistica</small></span></label><button>${icon("check", { size: 16 })} Salva</button></form><form class="panel" data-navigation-preference><div class="preference-heading"><span>${icon("route", { size: 20 })}</span><div><h3>Movimento</h3><p>Definisci il ritmo della visita.</p></div></div><label>Ritmo preferito <input type="range" min="0" max="1" step="0.05" name="movementPacePreference" value="${number(navigation.movementPacePreference)}"><span class="range-labels"><small>Rilassato</small><small>Sostenuto</small></span></label><button>${icon("check", { size: 16 })} Salva</button></form><form class="panel" data-learning-preference><div class="preference-heading"><span>${icon("user", { size: 20 })}</span><div><h3>Adattamento</h3><p>Controlla l'uso dei segnali personali.</p></div></div><label class="check"><input type="checkbox" name="personalHistory" ${checked(learning.personalHistory)}> <span>Usa la mia cronologia</span></label><label class="check"><input type="checkbox" name="collectiveContribution" ${checked(learning.collectiveContribution)}> <span>Contribuisci in forma pseudonima</span></label><button>${icon("check", { size: 16 })} Salva</button></form></div></section><section class="account-section" id="account-organizations" tabindex="-1"><div class="section-heading"><div><span class="eyebrow">Accessi</span><h2>Organizzazioni</h2><p>Qui controlli le organizzazioni di cui fai parte. Per lavorare in una di esse, cambiala dalla schermata delle aree di lavoro.</p></div><button type="button" data-context-hub>${icon("workspace", { size: 16 })} Cambia o crea area</button></div><div class="account-resource-grid">${this.renderOrganizations(organizations)}</div></section><section class="account-section" id="account-rules" tabindex="-1"><div class="section-heading"><div><span class="eyebrow">Strumenti avanzati</span><h2>Regole editoriali personali</h2><p>Vocabolari e criteri editoriali di tua proprietà, separati da quelli delle organizzazioni.</p></div><span class="count">${personalNamespaces.length}</span></div><div class="account-resource-grid">${this.renderPersonalRules(personalNamespaces)}</div><details class="account-create"><summary>${icon("plus", { size: 16 })} Crea regole editoriali personali</summary><form data-create-namespace><div class="namespace-create-intro"><strong>Da dove si parte?</strong><p>Crea il contenitore delle regole: nella schermata successiva troverai spiegazioni, tutorial e un modello già pronto facoltativo.</p></div><label>Nome<input name="name" required placeholder="Es. Regole della collezione permanente"><small>Usa un nome che faccia capire a quale progetto o collezione si applicano.</small></label><label>Scopo e pubblico<textarea name="description" placeholder="Es. Indicazioni per raccontare le opere a un pubblico adulto non specialista."></textarea><small>Descrivi in una frase per quali contenuti e visitatori sono pensate.</small></label><button>${icon("plus", { size: 16 })} Crea e configura</button></form></details></section></main>`;
  }
}
customElements.define("artaround-profile-view", ArtAroundProfileView);
