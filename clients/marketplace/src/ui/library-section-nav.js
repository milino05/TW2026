function linkClass(active, key) {
  return active === key ? "button-link" : "button-link secondary";
}

export function renderLibrarySectionNav(active = "editorial") {
  const normalized = active === "resources" ? "resources" : "editorial";
  return `<nav class="button-row" aria-label="Sezioni della Libreria"><a class="${linkClass(normalized, "editorial")}" data-route href="/workspace" aria-current="${normalized === "editorial" ? "page" : "false"}">Editoriale</a><a class="${linkClass(normalized, "resources")}" data-route href="/workspace?section=resources" aria-current="${normalized === "resources" ? "page" : "false"}">Tutte le risorse</a></nav>`;
}
