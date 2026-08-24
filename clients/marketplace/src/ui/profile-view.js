import { navigate } from "../application/router.js";
import { accountRepository } from "../infrastructure/http/account-repository.js";
import { icon } from "./icons.js";

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function number(value, fallback = 0.5) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function checked(value) { return value === true ? "checked" : ""; }
function stateLabel(namespace) {
  const mode = namespace.state?.mode;
  const label = mode === "working" ? "Bozza" : mode === "published" ? "Pubblicato" : "Da configurare";
  return `${label}${namespace.state?.version ? ` · v${namespace.state.version}` : ""}`;
}

export class ArtAroundProfileView extends HTMLElement {
  workspace = null;
  busy = false;
  error = null;
  message = null;

  connectedCallback() { this.addEventListener("submit", this.onSubmit); this.addEventListener("click", this.onClick); this.load(); }
  disconnectedCallback() { this.removeEventListener("submit", this.onSubmit); this.removeEventListener("click", this.onClick); }

  async load() {
    this.busy = true; this.error = null; this.render();
    try { this.workspace = await accountRepository.workspace(); }
    catch (error) { this.error = error instanceof Error ? error.message : "Profilo non disponibile"; }
    finally { this.busy = false; this.render(); }
  }

  async execute(callback, message) {
    this.busy = true; this.error = null; this.message = null; this.render();
    try { await callback(); this.message = message; this.workspace = await accountRepository.workspace(); }
    catch (error) { this.error = error instanceof Error ? error.message : "Operazione non riuscita"; }
    finally { this.busy = false; this.render(); }
  }

  onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const organization = target?.closest("button[data-organization]");
    if (organization) navigate(`/organizations/detail?organizationId=${encodeURIComponent(organization.dataset.organization)}`);
    const namespace = target?.closest("button[data-namespace]");
    if (namespace) navigate(`/namespaces/editor?namespaceId=${encodeURIComponent(namespace.dataset.namespace)}`);
  };

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    const data = new FormData(form);
    if (form.matches("[data-create-organization]")) {
      event.preventDefault();
      await this.execute(() => accountRepository.createOrganization({ name: String(data.get("name") || ""), description: String(data.get("description") || "") }), "Organization creata.");
    } else if (form.matches("[data-create-namespace]")) {
      event.preventDefault();
      await this.execute(() => accountRepository.createNamespace({ ownerType: "user", ownerId: this.workspace.account.id, name: String(data.get("name") || ""), description: String(data.get("description") || "") }), "Namespace personale creato.");
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

  render() {
    if (!this.workspace) { this.innerHTML = `<main class="profile-page"><p role="${this.error ? "alert" : "status"}">${escapeHtml(this.error || "Caricamento profilo…")}</p></main>`; return; }
    const { account, organizations, personalNamespaces } = this.workspace;
    const presentation = account.defaultPresentationPreference || { depthPreference: 0.5, languageComplexityPreference: 0.5 };
    const navigation = account.defaultNavigationPreference || { movementPacePreference: 0.5 };
    const learning = account.learningPreferences || {};
    const organizationCards = organizations.map((entry) => `<article class="card organization"><div class="card-title-row"><span class="resource-mark">${icon("building", { size: 20 })}</span><div><span class="eyebrow">Ruolo · ${escapeHtml(entry.role)}</span><h3>${escapeHtml(entry.name)}</h3></div></div><p>${escapeHtml(entry.description || "Nessuna descrizione")}</p><dl><div><dt>Membri</dt><dd>${entry.counts.members}</dd></div><div><dt>Sedi</dt><dd>${entry.counts.venues}</dd></div><div><dt>Namespace</dt><dd>${entry.counts.namespaces}</dd></div></dl><button type="button" data-organization="${escapeHtml(entry.id)}">Gestisci ${icon("chevron", { size: 16 })}</button></article>`).join("");
    const namespaceCards = personalNamespaces.map((entry) => `<article class="card"><div class="card-title-row"><span class="resource-mark">${icon("book", { size: 20 })}</span><div><span class="eyebrow">${escapeHtml(stateLabel(entry))}</span><h3>${escapeHtml(entry.name)}</h3></div></div><p>${escapeHtml(entry.description || "Nessuna descrizione")}</p><button type="button" data-namespace="${escapeHtml(entry.id)}">Apri editor ${icon("chevron", { size: 16 })}</button></article>`).join("");
    this.innerHTML = `<style>
      :host{display:block;background:#f3f2ed;color:#18352e;min-height:calc(100vh - 4rem)}*{box-sizing:border-box}.profile-page{max-width:74rem;margin:auto;padding:2.5rem 1rem 5rem}.hero{display:grid;grid-template-columns:1fr auto;gap:2rem;align-items:end;padding:2rem;border-radius:1.4rem;background:#173e35;color:white}.hero h1{font-size:clamp(2.2rem,6vw,4.6rem);line-height:.9;margin:.4rem 0}.mark{display:grid;place-items:center;width:5rem;height:5rem;border-radius:50%;background:#f2b65d;color:#173e35;font-size:1.5rem;font-weight:900}.eyebrow{font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;font-weight:800;color:#5c776e}.hero .eyebrow{color:#b8d7ca}.feedback{padding:.8rem 1rem;border-radius:.7rem;background:white;border:1px solid #cbd4cf}.section{margin-top:2.5rem}.section-heading{display:flex;justify-content:space-between;gap:1rem;align-items:end}.section-heading h2{margin:.2rem 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(17rem,1fr));gap:1rem;margin-top:1rem}.card{display:flex;flex-direction:column;justify-content:space-between;gap:1.25rem;padding:1.25rem;border:1px solid #d5d7d0;border-radius:1rem;background:white}.card h3{margin:.25rem 0}.card p{color:#5d6c67}.card dl{display:grid;grid-template-columns:repeat(3,1fr);gap:.4rem}.card dl div{padding:.6rem;border-radius:.6rem;background:#edf2ee}.card dt{font-size:.72rem}.card dd{margin:.2rem 0 0;font-weight:800}.preferences{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}.panel{padding:1.2rem;border-radius:1rem;background:white;border:1px solid #d5d7d0}.panel h3{margin-top:0}form{display:grid;gap:.8rem}label{display:grid;gap:.35rem;font-weight:700;font-size:.85rem}.check{grid-template-columns:auto 1fr;align-items:start}input,textarea,button{font:inherit}input,textarea{padding:.65rem;border:1px solid #aebcb6;border-radius:.55rem}button{width:max-content;padding:.65rem .85rem;border:0;border-radius:.6rem;background:#173e35;color:white;font-weight:800;cursor:pointer}.create{margin-top:1rem;padding:1rem;border:1px dashed #8fa198;border-radius:.8rem}details summary{cursor:pointer;font-weight:800}@media(max-width:52rem){.preferences{grid-template-columns:1fr}.hero{grid-template-columns:1fr}.mark{display:none}}
    </style><main class="profile-page" aria-busy="${this.busy}">
      <nav class="profile-shortcuts" aria-label="Sezioni profilo"><a href="#profile-preferences">Preferenze</a><a href="#profile-organizations">Organization <span>${organizations.length}</span></a><a href="#profile-namespaces">Namespace <span>${personalNamespaces.length}</span></a></nav>
      <section class="hero profile-hero"><div><span class="eyebrow">Account Marketplace</span><h1>${escapeHtml(account.username)}</h1><p>Gestisci le preferenze di visita, le collaborazioni e i tuoi domini editoriali da un unico spazio.</p></div><div class="mark">${escapeHtml(account.username.slice(0, 2).toUpperCase())}</div></section>
      ${this.busy ? `<p class="feedback" role="status">Aggiornamento…</p>` : ""}${this.message ? `<p class="feedback" role="status">${escapeHtml(this.message)}</p>` : ""}${this.error ? `<p class="feedback" role="alert">${escapeHtml(this.error)}</p>` : ""}
      <section class="section profile-section" id="profile-preferences"><div class="section-heading"><div><span class="eyebrow">Preferenze personali</span><h2>Esperienza di visita</h2><p>Queste impostazioni guidano la personalizzazione delle esperienze.</p></div></div><div class="preferences">
        <form class="panel" data-presentation-preference><div class="preference-heading"><span>${icon("book", { size: 20 })}</span><div><h3>Presentazione</h3><p>Regola profondità e linguaggio.</p></div></div><label>Profondità <input type="range" min="0" max="1" step="0.05" name="depthPreference" value="${number(presentation.depthPreference)}"><span class="range-labels"><small>Essenziale</small><small>Approfondita</small></span></label><label>Complessità linguistica <input type="range" min="0" max="1" step="0.05" name="languageComplexityPreference" value="${number(presentation.languageComplexityPreference)}"><span class="range-labels"><small>Semplice</small><small>Specialistica</small></span></label><button>${icon("check", { size: 16 })} Salva</button></form>
        <form class="panel" data-navigation-preference><div class="preference-heading"><span>${icon("route", { size: 20 })}</span><div><h3>Movimento</h3><p>Definisci il ritmo della visita.</p></div></div><label>Ritmo preferito <input type="range" min="0" max="1" step="0.05" name="movementPacePreference" value="${number(navigation.movementPacePreference)}"><span class="range-labels"><small>Rilassato</small><small>Sostenuto</small></span></label><button>${icon("check", { size: 16 })} Salva</button></form>
        <form class="panel" data-learning-preference><div class="preference-heading"><span>${icon("user", { size: 20 })}</span><div><h3>Adattamento</h3><p>Controlla l'uso dei segnali personali.</p></div></div><label class="check"><input type="checkbox" name="personalHistory" ${checked(learning.personalHistory)}> <span>Usa la mia cronologia</span></label><label class="check"><input type="checkbox" name="collectiveContribution" ${checked(learning.collectiveContribution)}> <span>Contribuisci in forma pseudonima</span></label><button>${icon("check", { size: 16 })} Salva</button></form>
      </div></section>
      <section class="section profile-section" id="profile-organizations"><div class="section-heading"><div><span class="eyebrow">Collaborazione</span><h2>Organization</h2><p>Team, sedi e risorse condivise.</p></div><span class="count">${organizations.length}</span></div><div class="grid">${organizationCards || `<div class="empty-state">${icon("building", { size: 26 })}<h3>Nessuna Organization</h3><p>Crea uno spazio per iniziare a collaborare.</p></div>`}</div><details class="create"><summary>${icon("plus", { size: 16 })} Crea Organization</summary><form data-create-organization><label>Nome<input name="name" required placeholder="Nome dell'Organization"></label><label>Descrizione<textarea name="description" placeholder="Scopo e attività principali"></textarea></label><button>${icon("plus", { size: 16 })} Crea Organization</button></form></details></section>
      <section class="section profile-section" id="profile-namespaces"><div class="section-heading"><div><span class="eyebrow">Dominio editoriale personale</span><h2>I miei Namespace</h2><p>Vocabolari e regole editoriali di tua proprietà.</p></div><span class="count">${personalNamespaces.length}</span></div><div class="grid">${namespaceCards || `<div class="empty-state">${icon("book", { size: 26 })}<h3>Nessun Namespace personale</h3><p>Crea un dominio editoriale per organizzare definizioni e relazioni.</p></div>`}</div><details class="create"><summary>${icon("plus", { size: 16 })} Crea Namespace personale</summary><form data-create-namespace><label>Nome<input name="name" required placeholder="Nome del Namespace"></label><label>Descrizione<textarea name="description" placeholder="Ambito e finalità editoriali"></textarea></label><button>${icon("plus", { size: 16 })} Crea Namespace</button></form></details></section>
    </main>`;
  }
}

customElements.define("artaround-profile-view", ArtAroundProfileView);
