const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const venueView = source("clients/marketplace/src/ui/venue-editor-view.js");
const userFacingErrors = source("clients/marketplace/src/application/user-facing-errors.js");
const managementService = source("services/marketplaceManagementV2.service.js");
const integrityService = source("services/venueReleaseIntegrity.service.js");

test("Venue editor usa l'integrità live e non lascia errori operativi persistenti", () => {
  assert.match(managementService, /liveIntegrity:/);
  assert.match(venueView, /release\?\.liveIntegrity/);
  assert.match(venueView, /this\.data\.release\.integrity = this\.data\.release\.liveIntegrity/);
  assert.match(venueView, /await this\.refreshServerState\(\)\.catch\(\(\) => \{\}\)/);
  assert.match(venueView, /notify\.danger\(failureMessage, \{ duration: 6000 \}\)/);
  assert.doesNotMatch(venueView, /catch \(error\) \{\s*this\.error = error instanceof Error \? error\.message : "Operazione non riuscita"/);
});

test("il blocker del vocabolario fisico è user-facing e indica il percorso di risoluzione", () => {
  assert.match(userFacingErrors, /layout: "Configurazione degli spazi"/);
  assert.match(userFacingErrors, /authoredAgainstPhysicalVocabularyRevisionId: "Vocabolario fisico"/);
  assert.match(userFacingErrors, /PHYSICAL_VOCABULARY_REVISION_NOT_PUBLISHABLE:/);
  assert.match(userFacingErrors, /Spazi e mappa/);
  assert.match(userFacingErrors, /Gestisci vocabolario/);
  assert.match(userFacingErrors, /La sede non è ancora pronta per la pubblicazione/);
});

test("la correzione preserva il vincolo di snapshot fisico pubblicato e integro", () => {
  assert.match(integrityService, /PHYSICAL_VOCABULARY_REVISION_NOT_PUBLISHABLE/);
  assert.match(integrityService, /\["published", "superseded"\]\.includes\(revision\.status\)/);
  assert.match(integrityService, /revision\.integrity\?\.status !== "valid"/);
});
