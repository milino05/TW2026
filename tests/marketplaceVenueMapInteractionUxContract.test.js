const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const facade = source("clients/marketplace/src/ui/venue-editor-map-refinement-mixin.js");
const interaction = source("clients/marketplace/src/ui/venue-editor-map-interaction-refinement-mixin.js");
const refinementCss = source("clients/marketplace/src/styles/venue-map-refinement.css");

test("Il refinement della mappa compone il comportamento storico con il polish interattivo", () => {
  assert.match(facade, /venue-editor-map-refinement-base\.js/);
  assert.match(facade, /extendVenueMapRefinementMixin/);
});

test("La mappa sostituisce i numeri dei luoghi con label contestuali e nomina anche i collegamenti", () => {
  assert.match(interaction, /numericMarker\?\.remove\(\)/);
  assert.match(interaction, /map-place-label/);
  assert.match(interaction, /connectionDisplayLabel/);
  assert.match(interaction, /typeLabel \? `\$\{typeLabel\} · \$\{route\}` : route/);
  assert.match(refinementCss, /map-connection-label\[data-visible=true\]/);
  assert.match(refinementCss, /map-place-node:hover \.map-place-label/);
});

test("Il drag dei luoghi persiste senza usare il ciclo globale execute/render", () => {
  const pointerUp = interaction.match(/async onMapPointerUp\(event\) \{[\s\S]*?\n    \},\n\n    async handleMapAuthoringClick/)?.[0] || "";
  assert.match(pointerUp, /managementRepository\.moveVenuePlace/);
  assert.match(pointerUp, /mapPositionSavePending/);
  assert.match(pointerUp, /connectionGeometryUpdates/);
  assert.doesNotMatch(pointerUp, /this\.execute\(/);
  assert.doesNotMatch(pointerUp, /this\.message\s*=/);
});

test("La distanza del collegamento è editabile solo in modalità manuale", () => {
  assert.match(interaction, /data-derived-connection-distance/);
  assert.match(interaction, /metricMode\.value === "geometry_derived"/);
  assert.match(interaction, /manualDistance\.hidden = derived/);
  assert.match(interaction, /manualInput\.disabled = derived/);
  assert.match(interaction, /geometryDistanceMeters\(connectionDraftPoints/);
});

test("Creare luoghi, collegamenti e slot non forza l'apertura del nuovo editor", () => {
  assert.match(interaction, /highlightCreatedMapObject\("place", placeId\)/);
  assert.match(interaction, /highlightCreatedMapObject\("connection", connectionId\)/);
  assert.match(interaction, /spatialEditor = \{ kind: "place", id: id\(slotPlaceId\), tab: "slots" \}/);
  assert.match(interaction, /spatialEditor = null/);
});
