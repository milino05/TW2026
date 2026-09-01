import { currentRoute, navigate } from "../application/router.js";
import { clearOperatingContext, contextKindLabel, OPERATING_CONTEXT_CHANGED, readOperatingContext, validateOperatingContext } from "../application/operating-context.js";
import { authRepository } from "../infrastructure/http/auth-repository.js";
import { accountRepository } from "../infrastructure/http/account-repository.js";
import { icon } from "./icons.js";
import { observeReliableSelects } from "./reliable-selects.js";
import "./context-hub-view.js";
import "./home-view.js";
import "./catalog-view.js";
import "./discovery-organizations-view.js";
import "./public-organization-view.js";
import "./discovery-venues-view.js";
import "./public-venue-view.js";
import "./create-hub-view.js";
import "./workspace-browser-view.js";
import "./workspace-view.js";
import "./item-authoring-view.js";
import "./visit-authoring-view.js";
import "./editorial-spaces-view.js";
import "./editorial-space-view.js";
import "./editorial-collection-create-view.js";
import "./editorial-studio-view.js";
import "./profile-view.js";
import "./organization-view.js";
import "./namespace-editor-view.js";
import "./physical-vocabulary-editor-view.js";
import "./venue-editor-view.js";
import "./listing-detail-view.js";
import "./acquisition-history-view.js";
import "./commerce-management-view.js";

const TITLES = {
  "/": "Home", "/context": "Scegli area", "/home": "Home", "/catalog": "Esplora", "/catalog/detail": "Dettaglio catalogo",
  "/organizations": "Organizzazioni", "/organizations/public": "Organizzazione", "/organizations/detail": "Gestione organizzazione",
  "/venues": "Musei e sedi", "/venues/public": "Sede", "/venues/editor": "Gestione sede",
  "/acquisitions": "Marketplace", "/create": "Crea", "/workspace": "Libreria", "/workspace/resource": "Dettaglio risorsa", "/workspace/commerce": "Vendite",
  "/workspace/item-authoring": "Modifica contenuto", "/workspace/visit-authoring": "Modifica visita",
  "/workspace/editorial-spaces": "Spazi editoriali", "/workspace/editorial-space": "Spazio editoriale",
  "/workspace/editorial-collection-new": "Nuova raccolta", "/workspace/editorial-studio": "Studio editoriale",
  "/profile": "Account", "/namespaces/editor": "Regole editoriali",
  "/physical-vocabularies/editor": "Vocabolario fisico", "/404": "Pagina non trovata",
};

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function current(route, paths) { return paths.includes(route) ? "page" : "false"; }
function authoringIsCreation(route) {
  const params = new URLSearchParams(window.location.search);
  if (["/create", "/workspace/editorial-collection-new"].includes(route)) return true;
  if (route === "/workspace/item-authoring") return !params.get("itemId");
  if (route === "/workspace/visit-authoring") return !params.get("visitId");
  return false;
}
function organizationManagementHref(context, section = "overview") {
  if (context?.type !== "organization" || !context.id) return "/profile";
  const params = new URLSearchParams({ organizationId: String(context.id), section });
  return `/organizations/detail?${params.toString()}`;
}
function routeMatchesOperatingContext(route, context) {
  if (!context) return false;
  if (route === "/profile") return context.type === "user";
  if (route === "/organizations/detail") {
    const organizationId = new URLSearchParams(window.location.search).get("organizationId");
    return context.type === "organization" && Boolean(organizationId) && String(context.id) === String(organizationId);
  }
  return true;
}

export class MarketplaceAppShell extends HTMLElement {
  user = null;
  accountWorkspace = null;
  context = null;
  authChecked = false;
  authMode = "login";
  busy = false;
  error = null;
  menuOpen = false;

  connectedCallback() {
    this.stopReliableSelects = observeReliableSelects(this);
    this.addEventListener("click", this.onClick);
    this.addEventListener("submit", this.onSubmit);
    window.addEventListener("popstate", this.onRouteChanged);
    window.addEventListener(OPERATING_CONTEXT_CHANGED, this.onContextChanged);
    this.bootstrap();
  }

  disconnectedCallback() {
    this.stopReliableSelects?.();
    this.stopReliableSelects = null;
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("submit", this.onSubmit);
    window.removeEventListener("popstate", this.onRouteChanged);
    window.removeEventListener(OPERATING_CONTEXT_CHANGED, this.onContextChanged);
  }

  async loadAccountWorkspace() {
    this.accountWorkspace = await accountRepository.workspace();
    this.context = validateOperatingContext(this.accountWorkspace);
  }

  async bootstrap() {
    try {
      const response = await authRepository.me();
      this.user = response.user;
      await this.loadAccountWorkspace();
    } catch {
      this.user = null;
      this.accountWorkspace = null;
      this.context = null;
    } finally {
      this.authChecked = true;
      if (this.user && !this.context && currentRoute() !== "/context") navigate("/context");
      else this.render();
    }
  }

  onContextChanged = (event) => {
    this.context = event.detail || readOperatingContext();
    this.menuOpen = false;
    this.render();
  };

  onRouteChanged = () => {
    this.menuOpen = false;
    this.context = readOperatingContext();
    if (this.user && !this.context && currentRoute() !== "/context") { navigate("/context"); return; }
    this.render();
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.matches("form[data-auth]")) return;
    event.preventDefault();
    const data = new FormData(form);
    this.busy = true;
    this.error = null;
    this.render();
    try {
      const username = String(data.get("username") || "");
      const password = String(data.get("password") || "");
      const response = this.authMode === "register"
        ? await authRepository.register(username, password)
        : await authRepository.login(username, password);
      this.user = response.user;
      this.authMode = "login";
      clearOperatingContext({ silent: true });
      await this.loadAccountWorkspace();
      navigate("/context");
    } catch (error) {
      this.error = error instanceof Error
        ? error.message
        : this.authMode === "register"
          ? "Registrazione non riuscita"
          : "Accesso non riuscito";
    } finally {
      this.busy = false;
      this.render();
    }
  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const authModeButton = target?.closest("button[data-auth-mode]");
    if (authModeButton) {
      this.authMode = this.authMode === "register" ? "login" : "register";
      this.error = null;
      this.render();
      return;
    }
    if (target?.closest("button[data-menu-toggle]")) { this.menuOpen = !this.menuOpen; this.render(); return; }
    if (target?.closest("button[data-change-context]")) { this.menuOpen = false; navigate("/context"); return; }
    const routeLink = target?.closest("a[data-route]");
    if (routeLink) { event.preventDefault(); this.menuOpen = false; navigate(routeLink.getAttribute("href")); return; }
    if (target?.closest("button[data-logout]")) {
      await authRepository.logout().catch(() => {});
      clearOperatingContext({ silent: true });
      this.user = null;
      this.accountWorkspace = null;
      this.context = null;
      this.authMode = "login";
      this.menuOpen = false;
      navigate("/");
      this.render();
    }
  };

  renderLogin() {
    const registering = this.authMode === "register";
    const eyebrow = registering ? "Nuovo account" : "Bentornato";
    const title = registering ? "Registrati ad ArtAround" : "Accedi ad ArtAround";
    const description = registering
      ? "Scegli username e password. Potrai usare le stesse credenziali nei prossimi accessi."
      : "Usa le credenziali del tuo account.";
    const submitLabel = registering ? "Registrati" : "Accedi";
    const busyLabel = registering ? "Creazione account…" : "Accesso in corso…";
    const switchPrompt = registering ? "Hai già un account?" : "Non hai ancora un account?";
    const switchLabel = registering ? "Accedi" : "Registrati";
    return `<main class="login-page"><section class="login-visual"><span class="eyebrow">ArtAround Marketplace</span><h1>Crea contenuti.<br>Progetta visite.</h1><p>Pubblica e condividi esperienze culturali come autore oppure insieme a un'organizzazione.</p><div class="login-features"><span>${icon("book")} Crea contenuti</span><span>${icon("route")} Progetta visite</span><span>${icon("store")} Pubblica e condividi</span></div></section><section class="login-card"><span class="brand-mark" aria-hidden="true"></span><div><span class="eyebrow">${eyebrow}</span><h2>${title}</h2><p>${description}</p></div><form data-auth><label>Username <input name="username" autocomplete="username" placeholder="Il tuo username" required></label><label>Password <input name="password" type="password" autocomplete="${registering ? "new-password" : "current-password"}" minlength="8" maxlength="128" placeholder="••••••••" required></label><button type="submit" ${this.busy ? "disabled" : ""}>${this.busy ? busyLabel : submitLabel}</button></form>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}<div class="button-row"><span class="muted">${switchPrompt}</span><button class="button-secondary small" type="button" data-auth-mode ${this.busy ? "disabled" : ""}>${switchLabel}</button></div></section></main>`;
  }

  renderContextIdentity() {
    if (!this.context) return "";
    const contextName = this.context.type === "user" ? (this.context.name || this.user?.username || "Account personale") : this.context.name;
    return `<div class="context-identity"><span class="context-identity__icon">${icon(this.context.type === "organization" ? "building" : "user", { size: 16 })}</span><span><small>${escapeHtml(contextKindLabel(this.context))}</small><strong>${escapeHtml(contextName)}</strong></span><button type="button" data-change-context aria-label="Cambia area di lavoro">Cambia</button></div>`;
  }

  renderNavigation(route) {
    const creation = authoringIsCreation(route);
    const organizationContext = this.context?.type === "organization";
    const editorialLibraryRoutes = ["/workspace/editorial-spaces", "/workspace/editorial-space", "/workspace/editorial-studio"];
    const libraryActive = ["/workspace", "/workspace/resource", ...editorialLibraryRoutes].includes(route)
      || (!organizationContext && route === "/physical-vocabularies/editor")
      || (["/workspace/item-authoring", "/workspace/visit-authoring"].includes(route) && !creation);
    const exploreActive = ["/catalog", "/catalog/detail", "/organizations", "/organizations/public", "/venues", "/venues/public"].includes(route);
    const managementHref = organizationContext ? organizationManagementHref(this.context) : "/profile";
    const managementLabel = organizationContext ? "Gestisci" : "Account";
    const managementIcon = organizationContext ? "building" : "user";
    const managementActive = organizationContext
      ? ["/organizations/detail", "/venues/editor", "/namespaces/editor", "/physical-vocabularies/editor"].includes(route)
      : route === "/profile";
    const managementLink = organizationContext
      ? `<a class="nav-profile" data-route href="${escapeHtml(managementHref)}" aria-current="${managementActive ? "page" : "false"}" title="${escapeHtml(managementLabel)}">${icon(managementIcon)}<span>Gestisci</span></a>`
      : `<a class="nav-profile" data-route href="${escapeHtml(managementHref)}" aria-current="${managementActive ? "page" : "false"}" title="${escapeHtml(managementLabel)}">${icon(managementIcon)}<span>Account</span></a>`;
    return `${this.renderContextIdentity()}<button class="menu-toggle" type="button" data-menu-toggle aria-expanded="${this.menuOpen}" aria-label="Apri navigazione">${icon("menu")}</button><nav class="market-nav" data-open="${this.menuOpen}" aria-label="Navigazione principale"><a data-route href="/home" aria-current="${current(route, ["/", "/home"])}">${icon("home")}<span>Home</span></a><a data-route href="/catalog" aria-current="${exploreActive ? "page" : "false"}">${icon("search")}<span>Esplora</span></a><a data-route href="/workspace" aria-current="${libraryActive ? "page" : "false"}">${icon("workspace")}<span>Libreria</span></a><a class="nav-create" data-route href="/create" aria-current="${creation ? "page" : "false"}">${icon("plus")}<span>Crea</span></a><a data-route href="/acquisitions" aria-current="${current(route, ["/acquisitions", "/workspace/commerce"])}">${icon("store")}<span>Attività</span></a>${managementLink}<button type="button" data-logout title="Esci">${icon("logout")}<span>Esci</span></button></nav>`;
  }

  renderContextMismatch(route) {
    const personalRequested = route === "/profile";
    const title = personalRequested ? "Passa alla tua area personale" : "Passa all'organizzazione corretta";
    const detail = personalRequested
      ? "Le impostazioni personali si modificano soltanto nell'area personale."
      : "Gli strumenti di gestione di un'organizzazione si usano soltanto mentre stai operando per quella stessa organizzazione.";
    return `<main class="page"><section class="empty-state"><span>${icon("lock", { size: 28 })}</span><h1>${title}</h1><p>${detail}</p><button type="button" data-change-context>Cambia o crea area</button></section></main>`;
  }

  renderRoute(route) {
    if (route === "/context") return "<artaround-context-hub-view></artaround-context-hub-view>";
    if (!routeMatchesOperatingContext(route, this.context)) return this.renderContextMismatch(route);
    if (["/", "/home"].includes(route)) return "<artaround-home-view></artaround-home-view>";
    if (route === "/catalog") return "<artaround-catalog-view></artaround-catalog-view>";
    if (route === "/catalog/detail") return "<artaround-listing-detail-view></artaround-listing-detail-view>";
    if (route === "/organizations") return "<artaround-discovery-organizations-view></artaround-discovery-organizations-view>";
    if (route === "/organizations/public") return "<artaround-public-organization-view></artaround-public-organization-view>";
    if (route === "/venues") return "<artaround-discovery-venues-view></artaround-discovery-venues-view>";
    if (route === "/venues/public") return "<artaround-public-venue-view></artaround-public-venue-view>";
    if (route === "/acquisitions") return "<artaround-acquisition-history-view></artaround-acquisition-history-view>";
    if (route === "/create") return "<artaround-create-hub-view></artaround-create-hub-view>";
    if (route === "/workspace/commerce") return "<artaround-commerce-management-view></artaround-commerce-management-view>";
    if (route === "/workspace/item-authoring") return "<artaround-item-authoring-view></artaround-item-authoring-view>";
    if (route === "/workspace/visit-authoring") return "<artaround-visit-authoring-view></artaround-visit-authoring-view>";
    if (route === "/workspace/editorial-spaces") return "<artaround-editorial-spaces-view></artaround-editorial-spaces-view>";
    if (route === "/workspace/editorial-space") return "<artaround-editorial-space-view></artaround-editorial-space-view>";
    if (route === "/workspace/editorial-collection-new") return "<artaround-editorial-collection-create-view></artaround-editorial-collection-create-view>";
    if (route === "/workspace/editorial-studio") return "<artaround-editorial-studio-view></artaround-editorial-studio-view>";
    if (route === "/profile") return "<artaround-profile-view></artaround-profile-view>";
    if (route === "/organizations/detail") return "<artaround-organization-view></artaround-organization-view>";
    if (route === "/namespaces/editor") return "<artaround-namespace-editor-view></artaround-namespace-editor-view>";
    if (route === "/physical-vocabularies/editor") return "<artaround-physical-vocabulary-editor-view></artaround-physical-vocabulary-editor-view>";
    if (route === "/venues/editor") return "<artaround-venue-editor-view></artaround-venue-editor-view>";
    if (route === "/workspace") return "<artaround-workspace-browser-view></artaround-workspace-browser-view>";
    if (route === "/workspace/resource") return "<artaround-workspace-view></artaround-workspace-view>";
    return `<main><div class="empty-state"><h1>Pagina non trovata</h1><a data-route href="/home">Torna alla home</a></div></main>`;
  }

  render() {
    const route = currentRoute();
    const needsContext = this.user && route !== "/context";
    const content = !this.authChecked
      ? `<main><div class="empty-state"><div class="skeleton skeleton-line" style="width:12rem"></div><p>Preparazione del Marketplace…</p></div></main>`
      : !this.user
        ? this.renderLogin()
        : needsContext && !this.context
          ? "<artaround-context-hub-view></artaround-context-hub-view>"
          : this.renderRoute(route);
    const showNavigation = Boolean(this.user && this.context && route !== "/context");
    this.innerHTML = `<div class="market-shell">${this.busy ? `<div class="route-progress" role="progressbar" aria-label="Operazione in corso"></div>` : ""}<header class="market-header"><a class="market-brand" data-route href="${this.context ? "/home" : "/context"}"><span class="brand-mark" aria-hidden="true"></span><span class="brand-copy">ArtAround<small>Marketplace</small></span></a>${showNavigation ? this.renderNavigation(route) : this.user ? `<div class="context-hub-account"><span>${icon("user", { size: 16 })} ${escapeHtml(this.user.username)}</span><button class="button-secondary small" type="button" data-logout>Esci</button></div>` : ""}</header>${content}${showNavigation ? `<footer class="market-footer"><span>ArtAround Marketplace</span><span>${escapeHtml(this.context.type === "organization" ? this.context.name : "Area personale")}</span></footer>` : ""}</div>`;
    document.title = this.user
      ? `${TITLES[route] || "ArtAround"} · ArtAround`
      : this.authMode === "register"
        ? "Registrati · ArtAround"
        : "Accedi · ArtAround";
  }
}

customElements.define("artaround-marketplace-app", MarketplaceAppShell);
