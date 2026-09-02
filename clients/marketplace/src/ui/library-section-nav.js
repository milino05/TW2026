function linkClass(active, key) {
  return active === key ? "button-link" : "button-link secondary";
}

export function renderLibrarySectionNav(active = "resources") {
  return `<nav class="button-row" aria-label="Sezioni della Libreria"><a class="${linkClass(active, "resources")}" data-route href="/workspace" aria-current="${active === "resources" ? "page" : "false"}">Risorse</a><a class="${linkClass(active, "spaces")}" data-route href="/workspace/editorial-spaces" aria-current="${active === "spaces" ? "page" : "false"}">Spazi editoriali</a></nav>`;
}
