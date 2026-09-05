const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const main = read("clients/marketplace/src/main.js");
const index = read("clients/marketplace/index.html");
const stepper = read("clients/marketplace/src/ui/authoring-stepper.js");
const stepperAdapter = read("clients/marketplace/src/ui/authoring-stepper-adapter.js");
const actionMenu = read("clients/marketplace/src/ui/action-menu.js");
const layerManager = read("clients/marketplace/src/application/layer-manager.js");
const interactionCss = read("clients/marketplace/src/styles/interaction-primitives.css");
const feedbackCss = read("clients/marketplace/src/styles/feedback-primitives.css");
const queryState = read("clients/marketplace/src/application/query-state.js");
const searchController = read("clients/marketplace/src/application/search-controller.js");
const resourceBrowser = read("clients/marketplace/src/application/resource-browser-controller.js");
const catalog = read("clients/marketplace/src/ui/catalog-view.js");
const workspaceBrowser = read("clients/marketplace/src/ui/workspace-browser-view.js");
const discoveryOrganizations = read("clients/marketplace/src/ui/discovery-organizations-view.js");
const reorderable = read("clients/marketplace/src/ui/reorderable-list.js");
const mediaViewer = read("clients/marketplace/src/ui/media-viewer.js");
const formField = read("clients/marketplace/src/ui/form-field.js");
const navigatorQueryState = read("clients/navigator/src/application/queryState.ts");
const navigatorSearchController = read("clients/navigator/src/application/searchController.ts");

function cssNumber(source, name) {
  const match = source.match(new RegExp(`${name}\\s*:\\s*(\\d+)`));
  return match ? Number(match[1]) : NaN;
}

test("Marketplace carica le interaction primitives prima dell'app shell", () => {
  assert.match(index, /interaction-primitives\.css/);
  for (const module of ["form-field", "action-menu", "media-field", "revision-workflow-controls", "authoring-stepper-adapter"]) {
    assert.match(main, new RegExp(`${module.replaceAll("-", "\\-")}\\.js`));
  }
  assert.ok(main.indexOf("authoring-stepper-adapter.js") < main.indexOf("app-shell.js"));
});

test("AuthoringStepper proietta solo Item e Visit mantenendo l'handler legacy", () => {
  assert.match(stepperAdapter, /artaround-item-authoring-view/);
  assert.match(stepperAdapter, /artaround-visit-authoring-view/);
  assert.doesNotMatch(stepperAdapter, /namespace-editor|physical-vocabulary-editor|venue-editor/);
  assert.match(stepper, /data-authoring-step/);
  assert.match(stepper, /data-step=/);
  assert.match(stepper, /aria-current="step"/);
  assert.match(stepper, /aria-disabled="true" disabled/);
  assert.match(stepperAdapter, /button\[data-step\]/);
  assert.match(stepperAdapter, /dataset\.artaroundLegacyProjection\s*=\s*"authoring-progress"/);
});

test("i layer applicativi restano ordinati sotto dialog e toast", () => {
  const floating = cssNumber(interactionCss, "--artaround-layer-floating");
  const popover = cssNumber(interactionCss, "--artaround-layer-popover");
  const drawer = cssNumber(interactionCss, "--artaround-layer-drawer");
  const modal = cssNumber(interactionCss, "--artaround-layer-modal");
  const dialog = cssNumber(feedbackCss, "--artaround-layer-dialog");
  const toast = cssNumber(feedbackCss, "--artaround-layer-toast");
  assert.ok(floating < popover && popover < drawer && drawer < modal && modal < dialog && dialog < toast);
  assert.match(layerManager, /document\.body\.append\(element\)/);
  assert.match(layerManager, /topEscapableLayer/);
  assert.doesNotMatch(layerManager, /showModal|showPopover|popover=/);
  assert.match(actionMenu, /kind: "popover"/);
  assert.match(mediaViewer, /kind: "modal"/);
});

test("QueryState non inventa uno store globale e resetta la pagina sui criteri", () => {
  assert.match(queryState, /class QueryState/);
  assert.match(queryState, /setQuery\(query\).*this\.page = 1/s);
  assert.match(queryState, /setFilter\(key, value\).*this\.page = 1/s);
  assert.match(queryState, /setSort\(sort\).*this\.page = 1/s);
  assert.doesNotMatch(queryState, /window\.|localStorage|sessionStorage/);
  assert.match(resourceBrowser, /new QueryState\(\)/);
  assert.match(navigatorQueryState, /export class QueryState/);
});

test("Catalog usa QueryState e ResourceBrowserController senza cambiare il contratto repository", () => {
  assert.match(catalog, /import \{ QueryState \}/);
  assert.match(catalog, /import \{ ResourceBrowserController \}/);
  assert.match(catalog, /class CatalogQueryState extends QueryState/);
  assert.match(catalog, /new ResourceBrowserController/);
  assert.match(catalog, /marketplaceRepository\.catalog\(\{/);
  for (const field of ["selectedVenueIds", "page", "q", "resourceTypes"]) assert.match(catalog, new RegExp(`${field}:`));
  assert.match(catalog, /this\.state\.setQuery/);
  assert.match(catalog, /this\.state\.setFilter\("type"/);
  assert.match(catalog, /this\.state\.setFilter\("selectedVenueIds"/);
  assert.match(catalog, /this\.state\.setPage/);
  assert.doesNotMatch(catalog, /this\.state\s*=\s*\{\s*q:/);
  assert.match(resourceBrowser, /result: null/);
  assert.match(resourceBrowser, /this\.state\.result = result/);
});

test("Workspace browser mantiene query e paginazioni indipendenti nei due domini della Libreria", () => {
  assert.match(workspaceBrowser, /marketplaceRepository\.workspaceContext\(principal\)/);
  assert.match(workspaceBrowser, /marketplaceRepository\.workspaceResources\(principal, \{/);
  assert.match(workspaceBrowser, /editorialRepository\.listSpaceItems\(/);
  for (const field of ["resourceQuery", "resourcePage", "contentQuery", "contentPage"]) assert.match(workspaceBrowser, new RegExp(`${field} =`));
  assert.match(workspaceBrowser, /navigationUrl\(\{/);
  assert.match(workspaceBrowser, /data-resource-page/);
  assert.match(workspaceBrowser, /data-content-page/);
});

test("Organization discovery usa lo stesso query lifecycle e preserva q/page", () => {
  assert.match(discoveryOrganizations, /import \{ QueryState \}/);
  assert.match(discoveryOrganizations, /import \{ ResourceBrowserController \}/);
  assert.match(discoveryOrganizations, /class DiscoveryQueryState extends QueryState/);
  assert.match(discoveryOrganizations, /new ResourceBrowserController/);
  assert.match(discoveryOrganizations, /discoveryRepository\.organizations\(\{ q: query, page \}\)/);
  assert.match(discoveryOrganizations, /navigate\(`\/organizations\$\{p\.toString\(\)/);
  assert.match(discoveryOrganizations, /this\.browser\.dispose\(\)/);
  assert.doesNotMatch(discoveryOrganizations, /this\.busy = true;\s*this\.error = null;\s*this\.render\(\);\s*try/s);
});

test("SearchController cancella richieste superseded e non lascia Promise debounce pendenti", () => {
  for (const source of [searchController, navigatorSearchController]) {
    assert.match(source, /AbortController/);
    assert.match(source, /sequence/);
    assert.match(source, /abort\(\)/);
  }
  assert.match(searchController, /void this\.run\(\)/);
  assert.match(navigatorSearchController, /void this\.run\(\)/);
});

test("reorder e form field includono i fallback accessibili nel contratto", () => {
  assert.match(reorderable, /data-reorder-move/);
  assert.match(reorderable, /event\.altKey/);
  assert.match(reorderable, /aria-live/);
  assert.match(reorderable, /draggable/);
  assert.match(formField, /aria-describedby/);
  assert.match(formField, /aria-invalid/);
  assert.match(formField, /artaround-field-feedback/);
});

test("MediaViewer è modale applicativo senza autoplay e con focus trap", () => {
  assert.match(mediaViewer, /aria-modal="true"/);
  assert.match(mediaViewer, /event\.key !== "Tab"/);
  assert.match(mediaViewer, /restoreFocus/);
  assert.doesNotMatch(mediaViewer, /autoplay/);
});
