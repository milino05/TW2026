import { currentRoute, navigate } from "../application/router.js";
import { clearOperatingContext, contextKindLabel, OPERATING_CONTEXT_CHANGED, readOperatingContext, validateOperatingContext } from "../application/operating-context.js";
import { authRepository } from "../infrastructure/http/auth-repository.js";
import { accountRepository } from "../infrastructure/http/account-repository.js";
import { icon } from "./icons.js";
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
import "./venue-target-chooser.js";
import "./context-release-composer.js";
import "./profile-view.js";
import "./organization-view.js";
import "./namespace-editor-view.js";
import "./venue-editor-view.js";
import "./listing-detail-view.js";
import "./acquisition-history-view.js";
import "./commerce-management-view.js";

const TITLES = {
  "/": "Home", "/context": "Scegli area", "/home": "Home", "/catalog": "Esplora", "/catalog/detail": "Dettaglio catalogo",
  "/organizations": "Organizzazioni", "/organizations/public": "Organizzazione", "/organizations/detail": "Gestione organizzazione",
  "/venues": "Musei e sedi", "/venues/public": "Sede", "/venues/editor": "Gestione sede",
  "/acquisitions": "Marketplace", "/create": "Crea", "/workspace": "Libreria", "/workspace/resource": "Dettaglio risorsa", "/workspace/commerce": "Vendite",
  "/workspace/item-authoring": "Modifica contenuto", "/workspace/visit-authoring": "Modifica visita", "/workspace/venue-targets": "Oggetti della sede",
  "/workspace/context-compose": "Pubblica una nuova versione", "/profile": "Account", "/namespaces/editor": "Regole editoriali", "/404": "Pagina non trovata",
};

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function current(route, paths) { return paths.includes(route) ? "page" : "false"; }
function authoringIsCreation(route) {
  const params = new URLSearchParams(window.location.search);
  if (route === "/create" || route === "/workspace/venue-targets") return true;
  if (route === "/workspace/item-authoring") return !params.get("itemId");
  if (route === "/workspace/visit-authoring") return !params.get("visitId");
  return false;
}

export class MarketplaceAppShell extends HTMLElement {
  user = null;
  accountWorkspace = null;
  context = null;
  authChecked = false;
  busy = false;
  error = null;
  menuOpen = false;

  connectedCallback() {
    this.addEventListener("click", this.onClick);
    this.addEventListener("submit", this.onSubmit);
    window.addEventListener("popstate", this.onRouteChanged);
    window.addEventListener(OPERATING_CONTEXT_CHANGED, this.onContextChanged);
    this.bootstrap();
  }

  disconnectedCallback() {
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
    if (!form?.matches("form[data-login]")) return;
    event.preventDefault();
    const data = new FormData(form);
    this.busy = true;
    this.error = null;
    this.render();
    try {
      const response = await authRepository.login(String(data.get("username") || ""), String(data.get("password") || ""));
      this.user = response.user;
      clearOperatingContext({ silent: true });
      await this.loadAccountWorkspace();
      navigate("/context");
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Accesso non riuscito";
    } finally {
      this.busy = false;
      this.render();
    }
  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
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
      this.menuOpen = false;
      navigate("/");
      this.render();
    }
  };

  renderLogin() {
    return `<main class="login-page"><section class="login-visual"><span class="eyebrow">ArtAround Marketplace</span><h1>Crea contenuti.<br>Progetta visite.</h1><p>Pubblica e condividi esperienze culturali come autore oppure insieme a un'organizzazione.</p><div class="login-features"><span>${icon("book")} Crea contenuti</span><span>${icon("route")} Progetta visite</span><span>${icon("store")} Pubblica e condividi</span></div></section><section class="login-card"><span class="brand-mark" aria-hidden="true"></span><div><span class="eyebrow">Bentornato</span><h2>Accedi ad ArtAround</h2><p>Usa le credenziali del tuo account.</p></div><form data-login><label>Username <input name="username" autocomplete="username" placeholder="Il tuo username" required></label><label>Password <input name="password" type="password" autocomplete="current-password" placeholder="••••••••" required></label><button type="submit" ${this.busy ? "disabled" : ""}>${this.busy ? "Accesso in corso…" : "Accedi"}</button></form>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}</section></main>`;
  }

  renderContextIdentity() {
    if (!this.context) return "";
    return `<div class="context-identity"><span class="context-identity__icon">${icon(this.context.type === "organization" ? "building" : "user", { size: 16 })}</span><span><small>${escapeHtml(contextKindLabel(this.context))}</small><strong>${escapeHtml(this.context.type === "user" ? "Area personale" : this.context.name)}</strong></span><button type="button" data-change-context aria-label="Cambia area di lavoro">Cambia</button></div>`;
  }

  renderNavigation(route) {
    const creation = authoringIsCreation(route);
    const libraryActive = ["/workspace", "/workspace/resource", "/workspace/context-compose"].includes(route) || (["/workspace/item-authoring", "/workspace/visit-authoring"].includes(route) && !creation);
    const exploreActive = ["/catalog", "/catalog/detail", "/organizations", "/organizations/public", "/venues", "/venues/public"].includes(route);
    return `${this.renderContextIdentity()}<button class="menu-toggle" type="button" data-menu-toggle aria-expanded="${this.menuOpen}" aria-label="Apri navigazione">${icon("menu")}</button><nav class="market-nav" data-open="${this.menuOpen}" aria-label="Navigazione principale"><a data-route href="/home" aria-current="${current(route, ["/", "/home"])}">${icon("home")}<span>Home</span></a><a data-route href="/catalog" aria-current="${exploreActive ? "page" : "false"}">${icon("search")}<span>Esplora</span></a><a data-route href="/workspace" aria-current="${libraryActive ? "page" : "false"}">${icon("workspace")}<span>Libreria</span></a><a class="nav-create" data-route href="/create" aria-current="${creation ? "page" : "false"}">${icon("plus")}<span>Crea</span></a><a data-route href="/acquisitions" aria-current="${current(route, ["/acquisitions", "/workspace/commerce"])}">${icon("store")}<span>Marketplace</span></a><a class="nav-profile" data-route href="/profile" aria-current="${current(route, ["/profile"])}" title="${escapeHtml(this.user.username)}">${icon("user")}<span>Account</span></a><button type="button" data-logout title="Esci">${icon("logout")}<span>Esci</span></button></nav>`;
  }

  renderRoute(route) {
    if (route === "/context") return "<artaround-context-hub-view></artaround-context-hub-view>";
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
    if (route === "/workspace/venue-targets") return "<artaround-venue-target-chooser></artaround-venue-target-chooser>";
    if (route === "/workspace/context-compose") return "<artaround-context-release-composer></artaround-context-release-composer>";
    if (route === "/profile") return "<artaround-profile-view></artaround-profile-view>";
    if (route === "/organizations/detail") return "<artaround-organization-view></artaround-organization-view>";
    if (route === "/namespaces/editor") return "<artaround-namespace-editor-view></artaround-namespace-editor-view>";
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
    document.title = this.user ? `${TITLES[route] || "ArtAround"} · ArtAround` : "Accedi · ArtAround";
  }
}

customElements.define("artaround-marketplace-app", MarketplaceAppShell);
