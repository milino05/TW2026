const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("execution preparation start returns the physically gated Navigator runtime projection", () => {
  const controller = source("controllers/executionPreparationsV2.controller.js");
  assert.match(controller, /require\("\.\.\/services\/navigatorRuntimeV2\.service"\)/);
  assert.match(controller, /currentNavigatorRuntimeProjection\(\{[\s\S]*?sessionId:\s*result\.session\._id[\s\S]*?userId:\s*req\.user\._id[\s\S]*?\}\)/);
  assert.match(controller, /json\(\{\s*\.\.\.result,\s*current,\s*alreadyStarted\s*\}\)/);
});

test("Navigator MapProjection exposes only the canonical narrative/planned/live runtime contract", () => {
  const repository = source("clients/navigator/src/infrastructure/http/navigationRepository.ts");
  const runtimeMap = source("services/navigatorMapProjectionV2.service.js");
  const selfGuidedView = source("clients/navigator/src/ui/SessionView.vue");

  assert.doesNotMatch(repository, /logicalCurrentStop/);
  assert.doesNotMatch(selfGuidedView, /logicalCurrentStop/);
  assert.match(repository, /narrativeContextStop:/);
  assert.match(repository, /plannedVisitRoute:\s*\{/);
  assert.match(repository, /activeNavigation:\s*ActiveNavigationProjection \| null/);
  assert.equal((repository.match(/\bplannedLegs:/g) || []).length, 1);
  assert.equal((repository.match(/\binterVenueTransitions:/g) || []).length, 1);
  assert.match(runtimeMap, /return \{\s*venues,\s*knownLocation,\s*narrativeContextStop,\s*selectableLocations,\s*plannedVisitRoute:/);
  assert.doesNotMatch(runtimeMap, /\.\.\.projectedBaseMap/);
});

test("physical facilities on the map reuse authorized navigation actions in self-guided and synchronized views", () => {
  const map = source("clients/navigator/src/ui/SessionMap.vue");
  const selfGuidedView = source("clients/navigator/src/ui/SessionView.vue");
  const synchronizedView = source("clients/navigator/src/ui/SynchronizedSessionView.vue");

  assert.match(map, /action\.actionId === `navigation\.destination\.\$\{location\.placeId\}`/);
  assert.match(map, /visiblePlaces = computed\(\(\) => selectableLocations\.value\.filter/);
  assert.match(map, /v-for="location in visiblePlaces"/);
  assert.match(map, /emit\('selectAction', placeAction\(location\)!\)/);

  assert.match(selfGuidedView, /:available-actions="snapshot\.availableActions"/);
  assert.match(selfGuidedView, /@select-action="requestAction"/);

  assert.match(synchronizedView, /:available-actions="runtime\.availableActions"/);
  assert.match(synchronizedView, /@select-action="requestPersonalAction"/);
  assert.match(synchronizedView, /const personalActions = computed\([\s\S]*?runtimeScope !== "synchronized_visit_session"/);
});

test("le azioni della mappa separano luoghi utili, marcatori e comandi primari", () => {
  const map = source("clients/navigator/src/ui/SessionMap.vue");
  const sheet = source("clients/navigator/src/ui/SessionActionSheet.vue");
  const selfGuidedView = source("clients/navigator/src/ui/SessionView.vue");
  const synchronizedView = source("clients/navigator/src/ui/SynchronizedSessionView.vue");

  assert.match(sheet, /action\.type === "NAVIGATE_TO_PHYSICAL_FEATURE"/);
  for (const view of [selfGuidedView, synchronizedView]) {
    assert.match(view, /usefulPlaceActions = computed\([\s\S]*?action\.type === "NAVIGATE_TO_PHYSICAL_FEATURE"/);
  }
  assert.match(map, /v-if="physicalProgressAction"/);
  assert.match(map, /v-if="correctLocationAction"/);
  assert.doesNotMatch(map, /otherNavigationActions/);
  assert.doesNotMatch(map, /returnAction/);
});

test("la mappa espone zoom utente e marcatori circolari semitrasparenti per tutti i luoghi", () => {
  const map = source("clients/navigator/src/ui/SessionMap.vue");
  const runtime = source("services/navigatorRuntimeV2.service.js");
  const dispatcher = source("services/actionDispatcherV2.service.js");

  assert.match(map, /const zoom = ref\(1\)/);
  assert.match(map, /Math\.min\(3, Math\.max\(1/);
  assert.match(map, /aria-label="Riduci la mappa"/);
  assert.match(map, /aria-label="Ingrandisci la mappa"/);
  assert.match(map, /@wheel\.ctrl\.prevent="zoomWithWheel"/);
  assert.match(map, /class="map-viewport"/);
  assert.match(map, /\.map-viewport \{[^}]*overflow:hidden[^}]*touch-action:none/);
  assert.match(map, /transform: `translate3d\(\$\{pan\.x\}px, \$\{pan\.y\}px, 0\) scale\(\$\{zoom\}\)`/);
  assert.match(map, /@pointerdown="startMapGesture"/);
  assert.match(map, /@pointermove="moveMapGesture"/);
  assert.match(map, /previousPinchDistance/);
  assert.match(map, /interactiveTarget.*closest\("button, a, input, select"\)/);
  assert.match(map, /gestureTravel > 5/);
  assert.match(map, /draggable="false"/);
  assert.match(map, /\.place-marker \{[^}]*border-radius:50%[^}]*opacity:\.72/);
  assert.match(runtime, /async function physicalPlaceActions/);
  assert.match(runtime, /placeNavigationActionDefinition\(\{ placeId: place\._id, label, aliases \}\)/);
  assert.match(runtime, /serverInput: \{ venueId: knownLocation\.venueId, destinationPlaceId: place\._id \}/);
  assert.match(dispatcher, /case "NAVIGATE_TO_PLACE"/);
  assert.match(dispatcher, /startNavigatorPlaceDetourV2/);
  const mapProjection = source("services/navigatorMapProjectionV2.service.js");
  assert.match(mapProjection, /label: place\.label \|\| type\?\.label \|\| "Luogo"/);
});

test("l'ultimo contenuto della visita sostituisce Prossimo con Termina visita", () => {
  const runtime = source("services/visitSessionV2.service.js");
  const view = source("clients/navigator/src/ui/SessionView.vue");

  assert.match(runtime, /if \(index < entries\.length - 1\) actions\.push\(personalAction\(ACTION_DEFINITIONS\.PROGRESS_NEXT/);
  assert.match(view, /const completeAction = computed\(\(\) => actionOfType\([^\n]+"COMPLETE"\)\)/);
  assert.match(view, /snapshot\.value\?\.experience\?\.phase === "presenting_visit_content"/);
  assert.match(view, /progress\.currentEntryIndex === progress\.contentEntryCount - 1/);
  assert.match(view, /const primaryProgressAction = computed\(\(\) => isFinalVisitContent\.value \? completeAction\.value : nextAction\.value\)/);
  assert.match(view, /primaryProgressAction\.type === "COMPLETE" \? "Termina visita" : primaryProgressAction\.label \+ " →"/);
});
