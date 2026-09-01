import { navigate, pushSameDocumentHistory } from "../application/router.js";
import { confirmNavigationLoss, hasNavigationLossRisk } from "../application/navigation-loss-guard.js";
import { accountRepository } from "../infrastructure/http/account-repository.js";
import { icon } from "./icons.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function number(value, fallback = 0.5) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function checked(value) { return value === true ? "checked" : ""; }
function roleLabel(roles = []) { return roles.map((role) => role.name).join(" · ") || "Membro"; }
function stateLabel(resource, published = "Pubblicata") { const mode = resource.state?.mode; const label = mode === "working" ? "Bozza" : mode === "published" ? published : "Da configurare"; return `${label}${resource.state?.version ? ` · v${resource.state.version}` : ""}`; }

const ACCOUNT_SECTIONS = [
  { code: "account-overview", label: "Panoramica" },
  { code: "account-preferences", label: "Preferenze visita" },
  { code: "account-organizations", label: "Organizzazioni" },
  { code: "account-rules", label: "Regole editoriali" },
  { code: "account-physical", label: "Vocabolari fisici" },
];
const ACCOUNT_SECTION_CODES = new Set(ACCOUNT_SECTIONS.map((entry) => entry.code));
function accountSectionFromHash() { const requested = String(window.location.hash || "").replace(/^#/, ""); return ACCOUNT_SECTION_CODES.has(requested) ? requested : "account-overview"; }

export class ArtAroundProfileView extends HTMLElement {
  workspace = null;
  busy = false;
  error = null;
  message = null;
  activeSection = accountSectionFromHash();

  connectedCallback() { this.addEventListener("submit", this.onSubmit); this.addEventListener("click", this.onClick); this.load(); }
  disconnectedCallback() { this.removeEventListener("submit", this.onSubmit); this.removeEventListener("click", this.onClick); }

  async load() {
    this.busy = true; this.error = null; this.render();
    try { this.workspace = await accountRepository.workspace(); }
    catch (error) { this.error = error instanceof Error ? error.message : "Account non disponibile"; }
    finally { this.busy = false; this.activeSection = accountSectionFromHash(); this.render(); }
  }

  async execute(callback, message) {
    this.busy = true; this.error = null; this.message = null; this.render();
    let result = null;
    try { result = await callback(); this.message = message; this.workspace = await accountRepository.workspace(); }
    catch (error) { this.error = error instanceof Error ? error.message : "Operazione non riuscita"; }
    finally { this.busy = false; this.render(); }
    return result;
  }

  async setSection(section) {
    const normalized = ACCOUNT_SECTION_CODES.has(section) ? section : "account-overview";
    if (normalized === this.activeSection) return;
    if (hasNavigationLossRisk()) {
      const confirmed = await confirmNavigationLoss({ kind: "section", from: this.activeSection, to: normalized });
      if (!confirmed) return;
    }
    this.activeSection = normalized;
    this.message = null;
    this.error = null;
    const nextUrl = `${window.location.pathname}${window.location.search}#${normalized}`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== nextUrl) pushSameDocumentHistory(nextUrl);
    this.render();
    requestAnimationFrame(() => this.querySelector(".organization-section, .organization-overview")?.focus({ preventScroll: true }));
  }

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const section = target?.closest("[data-account-section]");
    if (section) { await this.setSection(section.dataset.accountSection); return; }
    if (target?.closest("[data-context-hub]")) { navigate("/context"); return; }
    const namespace = target?.closest("[data-namespace]");
    if (namespace) { navigate(`/namespaces/editor?namespaceId=${encodeURIComponent(namespace.dataset.namespace)}`); return; }
    const physicalVocabulary = target?.closest("[data-physical-vocabulary]");
    if (physicalVocabulary) navigate(`/physical-vocabularies/editor?physicalVocabularyId=${encodeURIComponent(physicalVocabulary.dataset.physicalVocabulary)}`);
  };

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

  renderOverview() {
    const { organizations, personalNamespaces, personalPhysicalVocabularies = [] } = this.workspace;
    const cards = [
      ["account-preferences", icon("user", { size: 20 }), "Preferenze", "Personalizzazione della visita"],
      ["account-organizations", icon("building", { size: 20 }), organizations.length, "Organizzazioni"],
      ["account-rules", icon("book", { size: 20 }), personalNamespaces.length, "Regole editoriali"],
      ["account-physical", icon("route", { size: 20 }), personalPhysicalVocabularies.length, "Vocabolari fisici"],
    ].map(([section, mark, count, label]) => `<button type="button" data-account-section="${section}"><span>${mark}</span><strong>${escapeHtml(count)}</strong><small>${escapeHtml(label)}</small></button>`).join("");
    return `<section class="organization-overview" tabindex="-1"><div class="organization-overview__intro"><span class="eyebrow">Panoramica</span><h2>La tua area personale</h2><p>Qui gestisci soltanto preferenze e risorse personali. Per amministrare un'organizzazione devi prima passare alla sua area di lavoro.</p></div><div class="organization-summary-grid">${cards}</div></section>`;
  }

  renderPreferences() {
    const account = this.workspace.account;
    const presentation = account.defaultPresentationPreference || { depthPreference: 0.5, languageComplexityPreference: 0.5 };
    const navigation = account.defaultNavigationPreference || { movementPacePreference: 0.5 };
    const learning = account.learningPreferences || {};
    return `<section class="organization-section" tabindex="-1"><div class="section-heading"><div><span class="eyebrow">Preferenze visita</span><h2>Come vuoi vivere le visite</h2><p>Queste impostazioni appartengono al tuo account personale e aiutano il Navigator ad adattare l'esperienza.</p></div></div><div class="account-preferences"><form class="panel" data-presentation-preference><div class="preference-heading"><span>${icon("book", { size: 20 })}</span><div><h3>Presentazione</h3><p>Regola profondità e linguaggio.</p></div></div><label>Profondità <input type="range" min="0" max="1" step="0.05" name="depthPreference" value="${number(presentation.depthPreference)}"><span class="range-labels"><small>Essenziale</small><small>Approfondita</small></span></label><label>Complessità linguistica <input type="range" min="0" max="1" step="0.05" name="languageComplexityPreference" value="${number(presentation.languageComplexityPreference)}"><span class="range-labels"><small>Semplice</small><small>Specialistica</small></span></label><button>${icon("check", { size: 16 })} Salva</button></form><form class="panel" data-navigation-preference><div class="preference-heading"><span>${icon("route", { size: 20 })}</span><div><h3>Movimento</h3><p>Definisci il ritmo della visita.</p></div></div><label>Ritmo preferito <input type="range" min="0" max="1" step="0.05" name="movementPacePreference" value="${number(navigation.movementPacePreference)}"><span class="range-labels"><small>Rilassato</small><small>Sostenuto</small></span></label><button>${icon("check", { size: 16 })} Salva</button></form><form class="panel" data-learning-preference><div class="preference-heading"><span>${icon("user", { size: 20 })}</span><div><h3>Adattamento</h3><p>Controlla l'uso dei segnali personali.</p></div></div><label class="check"><input type="checkbox" name="personalHistory" ${checked(learning.personalHistory)}> <span>Usa la mia cronologia</span></label><label class="check"><input type="checkbox" name="collectiveContribution" ${checked(learning.collectiveContribution)}> <span>Contribuisci in forma pseudonima</span></label><button>${icon("check", { size: 16 })} Salva</button></form></div></section>`;
  }

  renderOrganizations() {
    const cards = this.workspace.organizations.map((entry) => {
      const counts = [
        Number.isFinite(entry.counts?.members) ? `<div><dt>Persone</dt><dd>${entry.counts.members}</dd></div>` : "",
        Number.isFinite(entry.counts?.venues) ? `<div><dt>Sedi</dt><dd>${entry.counts.venues}</dd></div>` : "",
        Number.isFinite(entry.counts?.namespaces) ? `<div><dt>Regole</dt><dd>${entry.counts.namespaces}</dd></div>` : "",
        Number.isFinite(entry.counts?.physicalVocabularies) ? `<div><dt>Vocabolari fisici</dt><dd>${entry.counts.physicalVocabularies}</dd></div>` : "",
      ].join("");
      return `<article class="account-resource-card"><header><span class="resource-mark">${icon("building", { size: 20 })}</span><div><span class="eyebrow">${escapeHtml(roleLabel(entry.roles))}</span><h3>${escapeHtml(entry.name)}</h3>${entry.isOwner ? `<span class="owner-badge">Owner</span>` : ""}</div></header><p>${escapeHtml(entry.description || "Nessuna descrizione disponibile.")}</p>${counts ? `<dl class="account-counts">${counts}</dl>` : ""}</article>`;
    }).join("");
    return `<section class="organization-section" tabindex="-1"><div class="section-heading"><div><span class="eyebrow">Organizzazioni</span><h2>Aree a cui puoi accedere</h2><p>Da qui puoi vedere le tue membership, ma non modificare dati dell'organizzazione mentre sei nell'area personale.</p></div><span class="count">${this.workspace.organizations.length}</span></div><div class="account-resource-grid">${cards || `<div class="empty-state account-empty">${icon("building", { size: 26 })}<h3>Nessuna organizzazione</h3><p>Puoi crearne una dalla schermata delle aree di lavoro.</p></div>`}</div><section class="settings-card"><div><h3>Vuoi lavorare per un'organizzazione?</h3><p>Passa esplicitamente alla sua area: da lì compariranno gli strumenti di gestione consentiti dai tuoi ruoli.</p></div><button type="button" data-context-hub>${icon("workspace", { size: 16 })} Cambia o crea area</button></section></section>`;
  }

  renderRules() {
    const cards = this.workspace.personalNamespaces.map((entry) => `<article class="account-resource-card"><header><span class="resource-mark">${icon("book", { size: 20 })}</span><div><span class="eyebrow">${escapeHtml(stateLabel(entry, "Privata"))}</span><h3>${escapeHtml(entry.name)}</h3></div></header><p>${escapeHtml(entry.description || "Nessuna descrizione disponibile.")}</p><button type="button" data-namespace="${escapeHtml(entry.id)}">Modifica regole editoriali ${icon("chevron", { size: 15 })}</button></article>`).join("");
    return `<section class="organization-section" tabindex="-1"><div class="section-heading"><div><span class="eyebrow">Regole editoriali</span><h2>Namespace personali</h2><p>Definiscono criteri editoriali di tua proprietà e restano separati da quelli delle organizzazioni.</p></div><span class="count">${this.workspace.personalNamespaces.length}</span></div><div class="account-resource-grid">${cards || `<div class="empty-state account-empty">${icon("book", { size: 26 })}<h3>Nessuna regola editoriale personale</h3></div>`}</div><details class="account-create"><summary>${icon("plus", { size: 16 })} Nuove regole editoriali</summary><form data-create-namespace><label>Nome<input name="name" required placeholder="Es. Le mie regole editoriali"></label><label>Descrizione<textarea name="description" placeholder="Scopo e pubblico"></textarea></label><button>${icon("plus", { size: 16 })} Crea e configura</button></form></details></section>`;
  }

  renderPhysical() {
    const entries = this.workspace.personalPhysicalVocabularies || [];
    const cards = entries.map((entry) => `<article class="account-resource-card"><header><span class="resource-mark">${icon("route", { size: 20 })}</span><div><span class="eyebrow">${escapeHtml(stateLabel(entry))}</span><h3>${escapeHtml(entry.name)}</h3></div></header><p>${escapeHtml(entry.description || "Linguaggio fisico riutilizzabile per sedi e routing.")}</p><button type="button" data-physical-vocabulary="${escapeHtml(entry.id)}">Configura vocabolario fisico ${icon("chevron", { size: 15 })}</button></article>`).join("");
    return `<section class="organization-section" tabindex="-1"><div class="section-heading"><div><span class="eyebrow">Dominio fisico</span><h2>Vocabolari fisici personali</h2><p>Risorse autonome di tua proprietà. I vocabolari di un'organizzazione si modificano dalla sua area di lavoro.</p></div><span class="count">${entries.length}</span></div><div class="account-resource-grid">${cards || `<div class="empty-state account-empty">${icon("route", { size: 26 })}<h3>Nessun vocabolario fisico personale</h3></div>`}</div><details class="account-create"><summary>${icon("plus", { size: 16 })} Nuovo vocabolario fisico</summary><form data-create-physical-vocabulary><label>Nome<input name="name" required placeholder="Es. Il mio vocabolario fisico"></label><label>Descrizione<textarea name="description" placeholder="Quali esigenze deve coprire?"></textarea></label><label>Punto di partenza<select name="startingPoint"><option value="starter">Configurazione ArtAround di base</option><option value="blank">Parti da zero</option></select></label><button>${icon("plus", { size: 16 })} Crea e configura</button></form></details></section>`;
  }

  renderCurrentSection() {
    if (this.activeSection === "account-preferences") return this.renderPreferences();
    if (this.activeSection === "account-organizations") return this.renderOrganizations();
    if (this.activeSection === "account-rules") return this.renderRules();
    if (this.activeSection === "account-physical") return this.renderPhysical();
    return this.renderOverview();
  }

  tabLabel(section) {
    const counts = {
      "account-organizations": this.workspace.organizations.length,
      "account-rules": this.workspace.personalNamespaces.length,
      "account-physical": (this.workspace.personalPhysicalVocabularies || []).length,
    };
    return counts[section.code] === undefined ? section.label : `${section.label} (${counts[section.code]})`;
  }

  render() {
    if (!this.workspace) { this.innerHTML = `<main class="page organization-page"><p role="${this.error ? "alert" : "status"}">${escapeHtml(this.error || "Caricamento account…")}</p></main>`; return; }
    const account = this.workspace.account;
    const tabs = ACCOUNT_SECTIONS.map((section) => `<button type="button" data-account-section="${section.code}" aria-current="${this.activeSection === section.code ? "page" : "false"}">${escapeHtml(this.tabLabel(section))}</button>`).join("");
    this.innerHTML = `<main class="page organization-page account-page" aria-busy="${this.busy}"><header class="organization-header"><div><span class="eyebrow">Account ArtAround</span><h1>${escapeHtml(account.username)}</h1><p>Profilo, preferenze e risorse che appartengono esclusivamente alla tua area personale.</p></div><div class="account-avatar" aria-hidden="true">${escapeHtml(account.username.slice(0, 2).toUpperCase())}</div></header><nav class="organization-tabs account-tabs" aria-label="Sezioni account">${tabs}</nav>${this.busy ? `<p role="status">Aggiornamento…</p>` : ""}${this.message ? `<p class="feedback-success" role="status">${icon("check", { size: 16 })} ${escapeHtml(this.message)}</p>` : ""}${this.error ? `<p role="alert">${icon("warning", { size: 16 })} ${escapeHtml(this.error)}</p>` : ""}${this.renderCurrentSection()}</main>`;
  }
}

customElements.define("artaround-profile-view", ArtAroundProfileView);