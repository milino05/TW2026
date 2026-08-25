import { currentRoute, navigate } from "../application/router.js";
import { authRepository } from "../infrastructure/http/auth-repository.js";
import { icon } from "./icons.js";
import "./catalog-view.js";
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
  "/": "Catalogo", "/catalog": "Catalogo", "/catalog/detail": "Dettaglio catalogo", "/acquisitions": "Licenze e vendite", "/create": "Crea", "/workspace": "Le mie risorse", "/workspace/resource": "Dettaglio risorsa", "/workspace/commerce": "Licenze e vendite",
  "/workspace/item-authoring": "Modifica contenuto", "/workspace/visit-authoring": "Modifica visita", "/workspace/venue-targets": "Oggetti della sede",
  "/workspace/context-compose": "Pubblica una nuova versione", "/profile": "Account e organizzazioni", "/organizations/detail": "Organizzazione",
  "/namespaces/editor": "Regole editoriali", "/venues/editor": "Sede e spazi fisici", "/404": "Pagina non trovata",
};

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function current(route, paths) { return paths.includes(route) ? "page" : "false"; }

export class MarketplaceAppShell extends HTMLElement {
  user = null;
  authChecked = false;
  busy = false;
  error = null;
  menuOpen = false;

  connectedCallback() {
    this.addEventListener("click", this.onClick);
    this.addEventListener("submit", this.onSubmit);
    window.addEventListener("popstate", this.onRouteChanged);
    this.bootstrap();
  }

  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("submit", this.onSubmit);
    window.removeEventListener("popstate", this.onRouteChanged);
  }

  async bootstrap() {
    try {
      const response = await authRepository.me();
      this.user = response.user;
    } catch {
      this.user = null;
    } finally {
      this.authChecked = true;
      this.render();
    }
  }

  onRouteChanged = () => {
    this.menuOpen = false;
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
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Accesso non riuscito";
    } finally {
      this.busy = false;
      this.render();
    }
  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button[data-menu-toggle]")) {
      this.menuOpen = !this.menuOpen;
      this.render();
      return;
    }
    const routeLink = target?.closest("a[data-route]");
    if (routeLink) {
      event.preventDefault();
      this.menuOpen = false;
      navigate(routeLink.getAttribute("href"));
      return;
    }
    if (target?.closest("button[data-logout]")) {
      await authRepository.logout().catch(() => {});
      this.user = null;
      this.menuOpen = false;
      this.render();
    }
  };

  renderLogin() {
    return `<main class="login-page"><section class="login-visual"><span class="eyebrow">ArtAround creator tools</span><h1>Condividi cultura.<br>Costruisci esperienze.</h1><p>Un unico spazio per curare contenuti, progettare visite e gestire le sedi della tua organizzazione.</p><div class="login-features"><span>${icon("book")} Contenuti versionati</span><span>${icon("route")} Visite multi-sede</span><span>${icon("building")} Gestione organizzativa</span></div></section><section class="login-card"><span class="brand-mark" aria-hidden="true"></span><div><span class="eyebrow">Bentornato</span><h2>Accedi al Marketplace</h2><p>Usa le credenziali del tuo account ArtAround.</p></div><form data-login><label>Username <input name="username" autocomplete="username" placeholder="Il tuo username" required></label><label>Password <input name="password" type="password" autocomplete="current-password" placeholder="••••••••" required></label><button type="submit" ${this.busy ? "disabled" : ""}>${this.busy ? "Accesso in corso…" : "Accedi"}</button></form>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}</section></main>`;
  }

  renderNavigation(route) {
    return `<button class="menu-toggle" type="button" data-menu-toggle aria-expanded="${this.menuOpen}" aria-label="Apri navigazione">${icon("menu")}</button><nav class="market-nav" data-open="${this.menuOpen}" aria-label="Navigazione principale"><a data-route href="/catalog" aria-current="${current(route, ["/", "/catalog", "/catalog/detail"])}">${icon("catalog")}<span>Catalogo</span></a><a data-route href="/workspace" aria-current="${current(route, ["/workspace", "/workspace/resource"])}">${icon("workspace")}<span>Le mie risorse</span></a><a class="nav-create" data-route href="/create" aria-current="${current(route, ["/create", "/workspace/item-authoring", "/workspace/visit-authoring", "/workspace/venue-targets", "/workspace/context-compose"])}">${icon("plus")}<span>Crea</span></a><a data-route href="/acquisitions" aria-current="${current(route, ["/acquisitions", "/workspace/commerce"])}">${icon("history")}<span>Licenze e vendite</span></a><a class="nav-profile" data-route href="/profile" aria-current="${current(route, ["/profile", "/organizations/detail", "/namespaces/editor", "/venues/editor"])}" title="${escapeHtml(this.user.username)}">${icon("user")}<span>Account e organizzazioni</span></a><button type="button" data-logout title="Esci">${icon("logout")}<span>Esci</span></button></nav>`;
  }

  renderRoute(route) {
    if (["/", "/catalog"].includes(route)) return "<artaround-catalog-view></artaround-catalog-view>";
    if (route === "/catalog/detail") return "<artaround-listing-detail-view></artaround-listing-detail-view>";
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
    return `<main><div class="empty-state"><h1>Pagina non trovata</h1><a data-route href="/catalog">Torna al catalogo</a></div></main>`;
  }

  render() {
    const route = currentRoute();
    const content = !this.authChecked
      ? `<main><div class="empty-state"><div class="skeleton skeleton-line" style="width:12rem"></div><p>Preparazione del Marketplace…</p></div></main>`
      : !this.user
        ? this.renderLogin()
        : this.renderRoute(route);
    this.innerHTML = `<div class="market-shell">${this.busy ? `<div class="route-progress" role="progressbar" aria-label="Operazione in corso"></div>` : ""}<header class="market-header"><a class="market-brand" data-route href="/catalog"><span class="brand-mark" aria-hidden="true"></span><span class="brand-copy">ArtAround<small>Marketplace</small></span></a>${this.user ? this.renderNavigation(route) : ""}</header>${content}${this.user ? `<footer class="market-footer"><span>ArtAround Marketplace · strumenti per autori e organizzazioni</span><span>Dominio editoriale e fisico rimangono indipendenti.</span></footer>` : ""}</div>`;
    document.title = this.user ? `${TITLES[route] || "ArtAround"} · ArtAround` : "Accedi · ArtAround";
  }
}

customElements.define("artaround-marketplace-app", MarketplaceAppShell);
