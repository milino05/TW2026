const SECTIONS = [
  ["catalog", "/catalog", "Catalogo"],
  ["organizations", "/organizations", "Organizzazioni"],
  ["venues", "/venues", "Sedi"],
];

export function renderExploreNavigation(active) {
  return `<nav class="explore-links" aria-label="Esplora ArtAround">${SECTIONS.map(([key, href, label]) => `<a data-route href="${href}" aria-current="${active === key ? "page" : "false"}">${label}</a>`).join("")}</nav>`;
}
