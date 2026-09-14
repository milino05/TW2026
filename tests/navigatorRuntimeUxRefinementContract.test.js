const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ACTION_DEFINITIONS, publicAction } = require("../config/runtimeActions");
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

test("public progress keeps one actionId while exposing physical and narrative UI roles", () => {
  const narrative = publicAction({ ...ACTION_DEFINITIONS.PROGRESS_NEXT, runtimeScope: "visit_session", runtimeVersion: 2 });
  const physical = publicAction({
    ...ACTION_DEFINITIONS.PROGRESS_NEXT,
    serverInput: { executionMode: "physical" },
    runtimeScope: "visit_session",
    runtimeVersion: 2,
  });
  assert.equal(narrative.actionId, "progress.next");
  assert.equal(narrative.type, "PROGRESS_NEXT");
  assert.equal(physical.actionId, "progress.next");
  assert.equal(physical.type, "PHYSICAL_PROGRESS_NEXT");
  assert.equal(physical.label, "Indicazione completata");
});

test("physical progress remains server-dispatched through the canonical progress.next descriptor", () => {
  const runtime = read("services/navigatorRuntimeV2.service.js");
  const dispatcher = read("services/actionDispatcherV2.service.js");
  assert.match(runtime, /ACTION_DEFINITIONS\.PROGRESS_NEXT[\s\S]*serverInput:\s*\{\s*executionMode:\s*"physical"\s*\}/);
  assert.match(dispatcher, /derived\.actions\.find\(\(entry\)\s*=>\s*entry\.actionId\s*===\s*actionId\)/);
  assert.match(dispatcher, /case\s+"PROGRESS_NEXT"[\s\S]*descriptor\.serverInput\?\.executionMode\s*===\s*"physical"/);
});

test("approach recognition prefers VenueTarget media and falls back to Item media", () => {
  const source = read("services/navigatorMapProjectionV2.service.js");
  assert.match(source, /targetBindings/);
  assert.match(source, /recognitionMedia/);
  assert.match(source, /ItemV2/);
  assert.match(source, /source:\s*"venue_target"/);
  assert.match(source, /source:\s*"item"/);
  assert.doesNotMatch(source, /illustrativeMedia/);
});

test("Navigator keeps physical actions on the map and content actions out of the physical surface", () => {
  const session = read("clients/navigator/src/ui/SessionView.vue");
  const synchronized = read("clients/navigator/src/ui/SynchronizedSessionView.vue");
  const sheet = read("clients/navigator/src/ui/SessionActionSheet.vue");
  const map = read("clients/navigator/src/ui/SessionMap.vue");

  assert.match(session, /:available-actions="snapshot\.availableActions"/);
  assert.match(synchronized, /:available-actions="runtime\.availableActions"/);
  assert.match(map, /PHYSICAL_PROGRESS_NEXT/);
  assert.match(map, /navigation\.place\./);
  assert.match(map, /Torna alla visita/);
  assert.doesNotMatch(map, /plannedOverlays/);
  assert.doesNotMatch(map, /v-for="stop in stops"/);
  assert.match(map, /navigation-route/);
  assert.doesNotMatch(sheet, /Muoviti nel museo/);
  assert.doesNotMatch(sheet, /actions:\s*props\.groups\.navigation/);
  assert.match(sheet, /mapOnlyMode/);
  assert.match(sheet, /Azioni sulla mappa/);
  assert.match(sheet, /azioni disponibili riguardano orientamento o avanzamento fisico/);
});

test("approach UI exposes recognition media and contextual physical confirmation", () => {
  const source = read("clients/navigator/src/ui/SessionRuntimeState.vue");
  assert.match(source, /recognitionMedia/);
  assert.match(source, /PHYSICAL_PROGRESS_NEXT/);
  assert.match(source, /Trovata!/);
});

test("preparation controls remain complete, theme-aware and estimates are precise/reactive", () => {
  const choices = read("clients/navigator/src/ui/ChoiceCard.vue");
  const preferences = read("clients/navigator/src/ui/NavigationPreferencesPanel.vue");
  const visit = read("clients/navigator/src/ui/VisitDetailView.vue");
  assert.match(choices, /var\(--navigator-surface-raised\)/);
  assert.match(preferences, /var\(--navigator-surface-raised\)/);
  assert.match(preferences, /personalNeeds\.catalog/);
  assert.match(preferences, /routingProfileSelections/);
  assert.match(preferences, /venueControlSelections/);
  assert.match(preferences, /scheduleApply/);
  assert.match(visit, /schedulePresentationUpdate/);
  assert.match(visit, /detailedDuration\(preparation\.logisticsPreview\.estimatedTotalSeconds\)/);
});

test("previsit refinement preserves physical scope, information state and synchronized quiz context", () => {
  const visit = read("clients/navigator/src/ui/VisitDetailView.vue");
  assert.match(visit, /detail\.visit\.physicalScope/);
  assert.match(visit, /empty-information/);
  assert.match(visit, /quizQuestionCount/);
  assert.match(visit, /collisione il backend assegnerà una variante leggibile/);
});

test("Marketplace keeps recognition and illustrative media distinct and editable", () => {
  const routes = read("routes/itemsV2.routes.js");
  const detail = read("clients/marketplace/src/ui/item-detail-dialog.js");
  const authoring = read("clients/marketplace/src/ui/item-authoring-view.js");
  assert.match(routes, /recognition-media/);
  assert.match(detail, /Immagine di riconoscimento dell'oggetto/);
  assert.match(authoring, /Immagine del contenuto · facoltativa/);
  assert.match(authoring, /illustrativa del contenuto, non una foto di riconoscimento fisico/);
  assert.doesNotMatch(authoring, /Immagine di riconoscimento dell'Item proposta come base per questa Edition/);
  const prepareNewEdition = authoring.match(/async prepareNewEdition\(\)[\s\S]*?\n  async selectNamespace/)?.[0] || "";
  assert.doesNotMatch(prepareNewEdition, /lineage\?\.recognitionMedia/);
});
