import { currentRoute, navigate } from "../application/router.js";

const TITLES = {
  "/": "ArtAround Marketplace",
  "/catalog": "Catalogo",
  "/workspace": "Workspace",
  "/404": "Pagina non trovata",
};

export class MarketplaceAppShell extends HTMLElement {
  connectedCallback() {
    this.addEventListener("click", this.onClick);
    window.addEventListener("popstate", this.render);
    this.render();
  }

  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    window.removeEventListener("popstate", this.render);
  }

  onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const link = target?.closest("a[data-route]");
    if (!link) return;
    event.preventDefault();
    navigate(link.getAttribute("href"));
  };

  render = () => {
    const route = currentRoute();
    this.innerHTML = `
      <style>
        :host { display: block; font-family: system-ui, sans-serif; }
        header { display: flex; justify-content: space-between; gap: 1rem; padding: 1rem; border-bottom: 1px solid currentColor; }
        nav { display: flex; gap: 1rem; }
        main { max-width: 60rem; margin: 0 auto; padding: 2rem 1rem; }
      </style>
      <header>
        <strong>ArtAround Marketplace</strong>
        <nav aria-label="Navigazione principale">
          <a data-route href="/catalog">Catalogo</a>
          <a data-route href="/workspace">Workspace</a>
        </nav>
      </header>
      <main>
        <h1>${TITLES[route]}</h1>
        <p>Slice 0: shell applicativa pronta. Catalogo e Workspace verranno alimentati da projection backend nei vertical slice successivi.</p>
      </main>
    `;
  };
}

customElements.define("artaround-marketplace-app", MarketplaceAppShell);
