import { currentRoute, navigate } from "../application/router.js";
import { authRepository } from "../infrastructure/http/auth-repository.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";

const TITLES = {
  "/": "Catalogo",
  "/catalog": "Catalogo",
  "/workspace": "Workspace",
  "/404": "Pagina non trovata",
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initialVenueId() {
  const params = new URLSearchParams(window.location.search);
  const selected = params.get("selectedVenueIds");
  return selected?.split(",").map((value) => value.trim()).find(Boolean) || params.get("venueId") || null;
}

export class MarketplaceAppShell extends HTMLElement {
  user = null;
  authChecked = false;
  catalog = null;
  busy = false;
  error = null;
  venueId = initialVenueId();

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
      await this.loadCatalogIfNeeded();
    } catch {
      this.user = null;
    } finally {
      this.authChecked = true;
      this.render();
    }
  }

  onRouteChanged = async () => {
    await this.loadCatalogIfNeeded();
    this.render();
  };

  async loadCatalogIfNeeded() {
    const route = currentRoute();
    if (!this.user || !["/", "/catalog"].includes(route)) return;
    this.catalog = await marketplaceRepository.catalog({ venueId: this.venueId });
  }

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
      await this.loadCatalogIfNeeded();
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Accesso non riuscito";
    } finally {
      this.busy = false;
      this.render();
    }
  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const routeLink = target?.closest("a[data-route]");
    if (routeLink) {
      event.preventDefault();
      navigate(routeLink.getAttribute("href"));
      return;
    }
    const acquireButton = target?.closest("button[data-acquire]");
    if (acquireButton) {
      this.busy = true;
      this.error = null;
      this.render();
      try {
        await marketplaceRepository.acquire(acquireButton.dataset.acquire);
        await this.loadCatalogIfNeeded();
      } catch (error) {
        this.error = error instanceof Error ? error.message : "Acquisizione non riuscita";
      } finally {
        this.busy = false;
        this.render();
      }
      return;
    }
    const logoutButton = target?.closest("button[data-logout]");
    if (logoutButton) {
      await authRepository.logout().catch(() => {});
      this.user = null;
      this.catalog = null;
      this.render();
    }
  };

  renderLogin() {
    return `
      <main>
        <h1>Accedi al Marketplace</h1>
        <form data-login>
          <label>Username <input name="username" autocomplete="username" required></label>
          <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
          <button type="submit" ${this.busy ? "disabled" : ""}>${this.busy ? "Accesso…" : "Accedi"}</button>
        </form>
        ${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}
      </main>`;
  }

  renderCatalog() {
    const results = this.catalog?.results || [];
    const cards = results.map((entry) => {
      const venues = (entry.asset.physicalScope || []).map((venue) => venue.name).join(" · ");
      const offer = entry.offers?.[0];
      const price = offer?.pricing?.type === "free" ? "Gratis" : `${offer?.pricing?.amountMinor ?? ""} ${offer?.pricing?.currency ?? ""}`;
      return `
        <article class="card">
          <h2>${escapeHtml(entry.asset.title)}</h2>
          <p>${escapeHtml(entry.asset.summary)}</p>
          <p>${entry.asset.stopCount} tappe${venues ? ` · ${escapeHtml(venues)}` : ""}</p>
          <p>Pubblicato da ${escapeHtml(entry.asset.publisher?.name || "")}</p>
          ${entry.viewerState?.alreadyUsable
            ? "<p><strong>Già utilizzabile</strong></p>"
            : offer
              ? `<button type="button" data-acquire="${escapeHtml(offer.id)}" ${this.busy ? "disabled" : ""}>${escapeHtml(offer.label)} · ${escapeHtml(price)}</button>`
              : "<p>Nessuna offerta disponibile.</p>"}
        </article>`;
    }).join("");
    return `
      <main>
        <h1>Catalogo</h1>
        ${this.venueId ? `<p>Filtro sede iniziale: <code>${escapeHtml(this.venueId)}</code></p>` : ""}
        ${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}
        ${cards || "<p>Nessuna visita disponibile nel catalogo corrente.</p>"}
      </main>`;
  }

  render() {
    const route = currentRoute();
    const content = !this.authChecked
      ? "<main><p>Caricamento…</p></main>"
      : !this.user
        ? this.renderLogin()
        : route === "/workspace"
          ? "<main><h1>Workspace</h1><p>Le funzioni creator entrano nei vertical slice successivi.</p></main>"
          : route === "/404"
            ? "<main><h1>Pagina non trovata</h1></main>"
            : this.renderCatalog();

    this.innerHTML = `
      <style>
        :host { display: block; font-family: system-ui, sans-serif; }
        header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 1rem; border-bottom: 1px solid currentColor; }
        nav { display: flex; gap: 1rem; align-items: center; }
        main { max-width: 60rem; margin: 0 auto; padding: 2rem 1rem; }
        form { display: grid; gap: 1rem; max-width: 24rem; }
        label { display: grid; gap: .35rem; }
        .card { padding: 1rem 0; border-bottom: 1px solid currentColor; }
        button { font: inherit; padding: .6rem .9rem; }
      </style>
      <header>
        <strong>ArtAround Marketplace</strong>
        ${this.user ? `<nav aria-label="Navigazione principale">
          <a data-route href="/catalog">Catalogo</a>
          <a data-route href="/workspace">Workspace</a>
          <span>${escapeHtml(this.user.username)}</span>
          <button type="button" data-logout>Esci</button>
        </nav>` : ""}
      </header>
      ${content}
    `;
    document.title = `${TITLES[route]} · ArtAround`;
  }
}

customElements.define("artaround-marketplace-app", MarketplaceAppShell);
