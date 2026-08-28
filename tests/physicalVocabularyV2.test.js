const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("crypto");
const mongoose = require("mongoose");

const {
  ensureDefinitionIds,
  regenerateDefinitionIdsForFork,
} = require("../services/physicalVocabularyDefinitionIdentity.service");
const { applyPhysicalStarter } = require("../services/physicalVocabularyStarter.service");
const {
  normalizePhysicalVocabularyRevisionPayload,
  validatePhysicalVocabularyRevisionUnknownFields,
  validatePhysicalVocabularyRevisionSnapshot,
  normalizePhysicalFeatureRef,
  validatePhysicalFeatureRef,
} = require("../services/validation/physicalVocabulary.validation");
const { CAPABILITY_DEFINITIONS } = require("../config/marketplaceCapabilities");
const { permissionClosure, STARTER_ROLES } = require("../services/organizationPermissionRegistry.service");

function attribute(overrides = {}) {
  return {
    definitionId: randomUUID(),
    key: "step_free",
    label: "Senza gradini",
    description: null,
    localizations: [{ locale: "it-IT", aliases: ["accesso a raso"] }],
    semanticRefs: [{ scheme: "openstreetmap-tag", id: "wheelchair=yes", matchType: "close" }],
    metadata: {},
    dataType: "boolean",
    unit: null,
    options: [],
    appliesTo: "both",
    ...overrides,
  };
}

test("lo starter fisico e ricco, valido, idempotente e non distruttivo", () => {
  const first = applyPhysicalStarter({});
  assert.deepEqual(Object.fromEntries(Object.entries(first.snapshot).map(([field, values]) => [field, values.length])), {
    placeTypes: 13,
    connectionTypes: 8,
    physicalAttributes: 9,
    routingProfiles: 4,
  });
  assert.deepEqual(first.conflicts, []);
  assert.deepEqual(validatePhysicalVocabularyRevisionSnapshot(first.snapshot), []);
  const toilets = first.snapshot.placeTypes.find((entry) => entry.key === "toilets");
  toilets.label = "Bagni del museo";
  toilets.semanticRefs = [];
  first.snapshot.placeTypes.push({
    definitionId: randomUUID(), key: "gallery_balcony", label: "Balconata", description: null,
    localizations: [], semanticRefs: [], metadata: {},
  });

  const second = applyPhysicalStarter(first.snapshot);
  assert.equal(second.applied.placeTypesAdded, 0);
  assert.equal(second.applied.connectionTypesAdded, 0);
  assert.equal(second.applied.physicalAttributesAdded, 0);
  assert.equal(second.applied.routingProfilesAdded, 0);
  assert.deepEqual(second.conflicts, []);
  assert.equal(second.snapshot.placeTypes.find((entry) => entry.key === "toilets").label, "Bagni del museo");
  assert.deepEqual(second.snapshot.placeTypes.find((entry) => entry.key === "toilets").semanticRefs, []);
  assert.ok(second.snapshot.placeTypes.some((entry) => entry.key === "gallery_balcony"));
});

test("lo starter segnala una corrispondenza semantica con key differente senza sovrascriverla", () => {
  const custom = applyPhysicalStarter({
    placeTypes: [{
      definitionId: randomUUID(),
      key: "servizi_visitatori",
      label: "Servizi visitatori",
      description: "Definizione locale",
      localizations: [],
      semanticRefs: [{ scheme: "openstreetmap-tag", id: "amenity=toilets", matchType: "exact" }],
      metadata: {},
    }],
  });
  assert.equal(custom.applied.placeTypesAdded, 12);
  assert.equal(custom.snapshot.placeTypes.some((entry) => entry.key === "toilets"), false);
  assert.deepEqual(custom.conflicts.map((entry) => ({ field: entry.field, code: entry.code, starterKey: entry.starterKey })), [{
    field: "placeTypes",
    code: "STARTER_SEMANTIC_MATCH_DIFFERENT_KEY",
    starterKey: "toilets",
  }]);
});

test("le identity del fork vengono rigenerate e i requirement sono rimappati", () => {
  const source = applyPhysicalStarter({}).snapshot;
  const sourceAttributeId = source.physicalAttributes.find((entry) => entry.key === "step_free").definitionId;
  const { snapshot: forked } = regenerateDefinitionIdsForFork(source);
  const forkedAttributeId = forked.physicalAttributes.find((entry) => entry.key === "step_free").definitionId;
  assert.notEqual(forkedAttributeId, sourceAttributeId);
  const accessible = forked.routingProfiles.find((entry) => entry.key === "accessible");
  assert.ok(accessible.requirements.some((requirement) => requirement.physicalAttributeDefinitionId === forkedAttributeId));
  assert.equal(accessible.requirements.some((requirement) => requirement.physicalAttributeDefinitionId === sourceAttributeId), false);
  assert.deepEqual(validatePhysicalVocabularyRevisionSnapshot(forked), []);
});

test("definitionId viene generato solo quando manca", () => {
  const existingId = randomUUID();
  const prepared = ensureDefinitionIds({
    placeTypes: [
      { definitionId: existingId, key: "room", label: "Sala" },
      { key: "entrance", label: "Ingresso" },
    ],
  });
  assert.equal(prepared.placeTypes[0].definitionId, existingId);
  assert.match(prepared.placeTypes[1].definitionId, /^[0-9a-f-]{36}$/i);
});

test("integrity rileva identity duplicate, riferimenti dangling e valori incompatibili", () => {
  const sharedId = randomUUID();
  const stepFree = attribute({ definitionId: sharedId });
  const snapshot = {
    placeTypes: [{ definitionId: sharedId, key: "room", label: "Sala", description: null, localizations: [], semanticRefs: [], metadata: {} }],
    connectionTypes: [],
    physicalAttributes: [stepFree],
    routingProfiles: [{
      definitionId: randomUUID(), key: "invalid", label: "Non valido", description: null,
      localizations: [], semanticRefs: [], metadata: {}, requirements: [{
        physicalAttributeDefinitionId: randomUUID(), operator: "gte", value: 5,
        priority: "required", weight: 1,
      }],
    }],
  };
  const issues = validatePhysicalVocabularyRevisionSnapshot(snapshot);
  assert.ok(issues.some((issue) => issue.code === "DUPLICATE_DEFINITION_ID"));
  assert.ok(issues.some((issue) => issue.code === "UNKNOWN_PHYSICAL_ATTRIBUTE"));

  snapshot.routingProfiles[0].requirements[0].physicalAttributeDefinitionId = sharedId;
  const typedIssues = validatePhysicalVocabularyRevisionSnapshot(snapshot);
  assert.ok(typedIssues.some((issue) => issue.code === "INCOMPATIBLE_VALUE"));
});

test("normalizzazione e unknown-field validation mantengono il contratto chiuso", () => {
  const normalized = normalizePhysicalVocabularyRevisionPayload({
    physicalAttributes: [{ key: " WIDTH ", label: " Larghezza ", dataType: " NUMBER ", unit: " cm ", appliesTo: " CONNECTION " }],
  });
  assert.deepEqual(normalized.physicalAttributes[0].options, []);
  assert.equal(normalized.physicalAttributes[0].key, "width");
  assert.equal(normalized.physicalAttributes[0].dataType, "number");
  const issues = validatePhysicalVocabularyRevisionUnknownFields({ placeTypes: [{ label: "Sala", userIntents: ["FIND_ROOM"] }] });
  assert.ok(issues.some((issue) => issue.code === "UNKNOWN_FIELD" && issue.field.endsWith("userIntents")));
});

test("PhysicalFeatureRef distingue riferimenti locali e semantici", () => {
  const local = normalizePhysicalFeatureRef({ kind: " LOCAL ", physicalVocabularyId: new mongoose.Types.ObjectId(), definitionId: randomUUID() });
  assert.deepEqual(validatePhysicalFeatureRef(local), []);
  const semantic = normalizePhysicalFeatureRef({ kind: "semantic", semanticRefs: [{ scheme: " WIKIDATA ", id: " Q12511 ", matchType: " exact " }] });
  assert.deepEqual(validatePhysicalFeatureRef(semantic), []);
  assert.equal(semantic.semanticRefs[0].scheme, "wikidata");
  const invalid = validatePhysicalFeatureRef({ kind: "semantic", semanticRefs: [] });
  assert.ok(invalid.some((issue) => issue.code === "EMPTY_ARRAY"));
});

test("RBAC e capability Marketplace includono il Physical Vocabulary senza un sistema parallelo", () => {
  assert.deepEqual(permissionClosure(["physical_vocabulary.publish"]), ["physical_vocabulary.publish", "physical_vocabulary.view"]);
  const venueManager = STARTER_ROLES.find((role) => role.key === "venue_manager");
  assert.ok(venueManager.permissionCodes.includes("physical_vocabulary.edit"));
  assert.deepEqual(CAPABILITY_DEFINITIONS["physical_vocabulary.fork"], ["physical_vocabulary", "physical_vocabulary_revision"]);
});
