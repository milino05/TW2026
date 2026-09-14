const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { resolveInitialPresentation } = require("../services/presentationRuntimeV2.service");
const { resolveMovementSpeed } = require("../services/physicalExecutionV2.service");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("presentation depth changes the selected duration and estimated content time", () => {
  const namespaceRevision = {
    durationTypes: [
      { definitionId: "short", targetSeconds: 60 },
      { definitionId: "long", targetSeconds: 210 },
    ],
    languageLevels: [{ definitionId: "standard" }],
  };
  const revision = {
    presentationVariants: [{
      _id: "variant",
      representations: [
        { _id: "short-representation", durationTypeDefinitionId: "short", languageLevelDefinitionId: "standard", locale: "it-IT", text: "Breve" },
        { _id: "long-representation", durationTypeDefinitionId: "long", languageLevelDefinitionId: "standard", locale: "it-IT", text: "Approfondita" },
      ],
    }],
    defaultPresentation: { variantId: "variant", representationId: "short-representation" },
  };
  const short = resolveInitialPresentation({ revision, namespaceRevision, explicitPreference: { depthPreference: 0 } });
  const long = resolveInitialPresentation({ revision, namespaceRevision, explicitPreference: { depthPreference: 1 } });
  assert.equal(short.estimatedContentSeconds, 60);
  assert.equal(long.estimatedContentSeconds, 210);
  assert.ok(long.estimatedContentSeconds > short.estimatedContentSeconds);
});

test("movement pace changes the physical speed used by route timing", () => {
  const relaxed = resolveMovementSpeed(0);
  const sustained = resolveMovementSpeed(1);
  assert.ok(sustained > relaxed);
  assert.ok((100 / sustained) < (100 / relaxed));
});

test("approach recognition prefers VenueTarget media and falls back to Item media", () => {
  const source = read("services/navigatorMapProjectionV2.service.js");
  assert.match(source, /targetBindings/);
  assert.match(source, /recognitionMedia/);
  assert.match(source, /ItemV2/);
  assert.match(source, /source:\s*"venue_target"/);
  assert.match(source, /source:\s*"item"/);
});

test("Navigator separates content and physical action surfaces", () => {
  const session = read("clients/navigator/src/ui/SessionView.vue");
  const synchronized = read("clients/navigator/src/ui/SynchronizedSessionView.vue");
  for (const source of [session, synchronized]) {
    assert.match(source, /contentActionGroups/);
    assert.match(source, /mapActions/);
  }
  const map = read("clients/navigator/src/ui/SessionMap.vue");
  assert.doesNotMatch(map, /plannedOverlays/);
  assert.doesNotMatch(map, /v-for="stop in stops"/);
  assert.match(map, /navigation-route/);
  assert.match(map, /Torna alla visita/);
});

test("approach UI exposes recognition media and contextual confirmation", () => {
  const source = read("clients/navigator/src/ui/SessionRuntimeState.vue");
  assert.match(source, /recognitionMedia/);
  assert.match(source, /Trovata!/);
});

test("preparation controls are theme-aware and estimates are precise/reactive", () => {
  const choices = read("clients/navigator/src/ui/ChoiceCard.vue");
  const preferences = read("clients/navigator/src/ui/NavigationPreferencesPanel.vue");
  const visit = read("clients/navigator/src/ui/VisitDetailView.vue");
  assert.match(choices, /var\(--navigator-surface-raised\)/);
  assert.match(preferences, /var\(--navigator-surface-raised\)/);
  assert.match(preferences, /scheduleApply/);
  assert.match(visit, /schedulePresentationUpdate/);
  assert.match(visit, /detailedDuration\(preparation\.logisticsPreview\.estimatedTotalSeconds\)/);
});

test("Marketplace keeps recognition and illustrative media distinct and editable", () => {
  const routes = read("routes/itemsV2.routes.js");
  const authoring = read("clients/marketplace/src/ui/item-authoring-view.js");
  assert.match(routes, /recognition-media/);
  assert.match(authoring, /Immagine di riconoscimento dell'oggetto/);
  assert.match(authoring, /Immagine del contenuto/);
});
