const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const contentManager = read("clients/marketplace/src/ui/editorial-collection-content-manager.js");
const picker = read("clients/marketplace/src/ui/collection-item-add-dialog.js");
const quickAdd = read("clients/marketplace/src/ui/content-space-item-add-dialog.js");
const itemDetail = read("clients/marketplace/src/ui/item-detail-dialog.js");
const graphView = read("clients/marketplace/src/ui/semantic-graph-view.js");
const editorialRepository = read("clients/marketplace/src/infrastructure/http/editorial-repository.js");
const marketplaceRoutes = read("routes/marketplaceV2.routes.js");
const authoringController = read("controllers/marketplaceAuthoringV2.controller.js");
const graphNeighborhoodService = read("services/editorialCollectionGraphNeighborhood.service.js");
const availableItemsService = read("services/editorialCollectionAvailableItems.service.js");

test("Aggiungi contenuti apre un modal con ricerca e card dei soli Item ancora disponibili", () => {
  assert.match(contentManager, /artaround-collection-item-add-dialog/);
  assert.match(contentManager, /data-add-collection-content/);
  assert.doesNotMatch(contentManager, /mode = "external"/);
  assert.doesNotMatch(contentManager, /externalCandidates/);
  assert.match(picker, /role="dialog" aria-modal="true" aria-label="Aggiungi contenuti alla raccolta"/);
  assert.match(picker, /data-collection-item-search/);
  assert.match(picker, /data-add-collection-item/);
  assert.match(picker, /editorialRepository\.candidates/);
  assert.match(availableItemsService, /existingItemIds/);
  assert.match(availableItemsService, /candidateItemIds = spaceItemIds\.filter/);
  assert.match(availableItemsService, /candidateSubjectIds/);
  assert.match(availableItemsService, /itemEditionId:\s*\{\s*\$in:\s*candidateEditionIds\s*\}/);
  assert.doesNotMatch(availableItemsService, /\.limit\(500\)/);
  assert.doesNotMatch(availableItemsService, /inCollection:/);
});

test("l'escalation fuori dallo spazio riusa il quick-add canonico e rimuove il browser parallelo", () => {
  assert.match(picker, /import "\.\/content-space-item-add-dialog\.js"/);
  assert.match(picker, /document\.createElement\("artaround-content-space-item-add-dialog"\)/);
  assert.match(picker, /data-add-content-to-space/);
  assert.match(picker, /library-item-added/);
  assert.match(picker, /library-item-open/);
  assert.match(quickAdd, /marketplaceRepository\.acquire/);
  assert.match(quickAdd, /operationCode:\s*"content\.fork"/);
  assert.match(quickAdd, /data-confirm-new-item/);
  assert.doesNotMatch(picker, /externalCandidates|importExternalCandidate/);
  assert.doesNotMatch(editorialRepository, /externalCandidates|importExternalCandidate|external-candidates|import-entry/);
  assert.doesNotMatch(marketplaceRoutes, /external-candidates|import-entry|editorialExternalCandidates|importEditorialExternalCandidate/);
  assert.doesNotMatch(authoringController, /searchExternalEditorialCandidates|importExternalEditorialCandidate|editorialExternalCandidates|importEditorialExternalCandidate/);
});

test("il dettaglio Item apre il grafo nel contesto della raccolta e focalizza il Subject", () => {
  assert.match(itemDetail, /focusSubjectId:\s*id\(this\.data\?\.subject\)/);
  assert.match(itemDetail, /editorialContextId:\s*this\.focusedCollectionId/);
  assert.match(itemDetail, /Apri nel grafo/);
  assert.match(graphView, /this\.editorialContextId = params\.get\("editorialContextId"\)/);
  assert.match(graphView, /this\.focusSubjectId = params\.get\("focusSubjectId"\)/);
  assert.match(graphView, /editorialContextId:\s*this\.editorialContextId/);
  assert.match(graphView, /initialFocusSubjectId:\s*this\.focusSubjectId/);
  assert.match(graphView, /<h2>Collegamenti<\/h2>/);
  assert.match(graphView, /<artaround-semantic-graph-editor>/);
  assert.doesNotMatch(graphView, /I Subject dei contenuti della raccolta sono disponibili automaticamente/);
});

test("un Subject implicito della raccolta è focalizzabile senza creare un GraphSubjectBinding", () => {
  assert.match(graphNeighborhoodService, /implicitFromCollection:\s*true/);
  assert.match(graphNeighborhoodService, /relationCount:\s*0/);
  assert.match(graphNeighborhoodService, /implicitFocus:\s*true/);
  assert.match(graphNeighborhoodService, /CollectionItemMembership/);
  assert.doesNotMatch(graphNeighborhoodService, /GraphSubjectBinding\.(?:create|insertMany|findOneAndUpdate)/);
});
