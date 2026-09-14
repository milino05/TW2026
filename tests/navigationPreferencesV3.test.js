const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("crypto");
const mongoose = require("mongoose");

const {
  canonicalPhysicalFeatureRef,
  projectNavigationNeedCatalog,
} = require("../config/navigationNeedCatalog");
const {
  normalizePersonalNavigationNeedSelections,
  compilePersonalNavigationNeedSelections,
  projectPersonalNavigationRequirements,
} = require("../services/navigationNeedPreference.service");
const { normalizeNavigationPreference } = require("../services/userPreference.service");
const {
  normalizeVenueControlSelections,
  compileVenueControlSelections,
} = require("../services/venueRoutingControlSelectionV2.service");
const {
  resolveVenueRoutingRequirements,
} = require("../services/routingProfileSelectionV2.service");
const {
  canonicalNeedSupportProjection,
  definitionsCompatible,
  canonicalDefinitionCompatible,
} = require("../services/routingProfileV2.service");

test("il catalogo personale espone controlli UX atomici senza requirement tecnici", () => {
  const catalog = projectNavigationNeedCatalog();
  assert.deepEqual(catalog.map((entry) => entry.id), [
    "step_free",
    "obstacles_present",
    "tactile_guidance",
    "narrow_passage",
    "minimum_width_cm",
    "slope_percent",
  ]);
  for (const need of catalog) {
    assert.deepEqual(need.allowedPriorities, ["preferred", "required"]);
    assert.equal(Object.hasOwn(need, "physicalFeatureRef"), false);
    assert.equal(Object.hasOwn(need, "operator"), false);
    assert.equal(Object.hasOwn(need, "appliesTo"), false);
  }
});

test("le preferenze persistenti restano semantic e provider-neutral", () => {
  const providerNeutralRequirement = {
    physicalFeatureRef: {
      kind: "semantic",
      semanticRefs: [{ scheme: "openstreetmap-tag", id: "wheelchair=yes", matchType: "exact" }],
    },
    operator: "eq",
    value: true,
    priority: "preferred",
    weight: 2,
  };
  const normalized = normalizeNavigationPreference({
    movementPacePreference: 0.4,
    requirements: [providerNeutralRequirement],
  });
  assert.equal(normalized.requirements.length, 1);
  assert.equal(normalized.requirements[0].physicalFeatureRef.semanticRefs[0].scheme, "openstreetmap-tag");
  assert.equal(normalized.requirements[0].weight, 2);

  assert.throws(
    () => normalizeNavigationPreference({
      requirements: [{
        ...providerNeutralRequirement,
        physicalFeatureRef: { kind: "local", physicalVocabularyId: new mongoose.Types.ObjectId(), definitionId: randomUUID() },
      }],
    }),
    (error) => error?.status === 400 && error?.details?.[0]?.code === "SEMANTIC_PHYSICAL_FEATURE_REQUIRED",
  );
});

test("le selezioni del catalogo vengono compilate backend-side preservando requirement semantic non canonici", () => {
  const genericRequirement = {
    physicalFeatureRef: {
      kind: "semantic",
      semanticRefs: [{ scheme: "example-provider", id: "covered-route", matchType: "exact" }],
    },
    operator: "eq",
    value: true,
    priority: "preferred",
    weight: 0.7,
  };
  const oldCanonical = {
    physicalFeatureRef: canonicalPhysicalFeatureRef("step_free"),
    operator: "eq",
    value: true,
    priority: "required",
    weight: 1,
  };
  const compiled = compilePersonalNavigationNeedSelections({
    selections: [{ id: "obstacles_present", priority: "preferred" }],
    existingRequirements: [genericRequirement, oldCanonical],
  });
  assert.equal(compiled.length, 2);
  assert.equal(compiled[0].physicalFeatureRef.semanticRefs[0].scheme, "example-provider");
  assert.equal(compiled[0].weight, 0.7);
  assert.equal(projectPersonalNavigationRequirements(compiled).length, 1);
  assert.equal(projectPersonalNavigationRequirements(compiled)[0].id, "obstacles_present");
  assert.equal(compiled.some((entry) => entry.physicalFeatureRef.semanticRefs?.some((ref) => ref.id === "step_free")), false);

  assert.throws(
    () => normalizePersonalNavigationNeedSelections([{ id: "step_free", priority: "avoid" }]),
    (error) => error?.status === 400 && error?.details?.[0]?.code === "PERSONAL_NAVIGATION_PRIORITY_NOT_ALLOWED",
  );
  assert.throws(
    () => normalizePersonalNavigationNeedSelections([{ id: "step_free", priority: "preferred", value: false }]),
    (error) => error?.status === 400 && error?.details?.[0]?.code === "PERSONAL_NAVIGATION_VALUE_MISMATCH",
  );
  assert.throws(
    () => normalizePersonalNavigationNeedSelections([
      { id: "step_free", priority: "preferred" },
      { id: "step_free", priority: "required" },
    ]),
    (error) => error?.status === 400 && error?.details?.[0]?.code === "DUPLICATE_PERSONAL_NAVIGATION_NEED",
  );
});

test("un controllo della sede viene compilato in un requirement locale scoped alla Venue", () => {
  const venueId = new mongoose.Types.ObjectId();
  const physicalVocabularyId = new mongoose.Types.ObjectId();
  const definitionId = randomUUID();
  const bundle = {
    physicalVocabulary: { _id: physicalVocabularyId },
    physicalVocabularyRevision: {
      physicalAttributes: [{
        definitionId,
        dataType: "boolean",
        appliesTo: "connection",
        options: [],
        visitorControl: {
          enabled: true,
          operator: "eq",
          valueMode: "fixed",
          value: false,
          priority: "required",
        },
      }],
    },
  };
  const selections = normalizeVenueControlSelections([{ venueId, physicalAttributeDefinitionId: definitionId }]);
  const compiled = compileVenueControlSelections({
    selections,
    bundleByVenueId: new Map([[String(venueId), bundle]]),
  });

  assert.equal(compiled.length, 1);
  assert.equal(compiled[0].venueId, String(venueId));
  assert.deepEqual(compiled[0].requirements, [{
    physicalFeatureRef: {
      kind: "local",
      physicalVocabularyId,
      definitionId,
    },
    operator: "eq",
    value: false,
    priority: "required",
    weight: 1,
  }]);
});

test("i controlli locali rifiutano duplicati, Venue fuori scope e valori non compatibili", () => {
  const venueId = new mongoose.Types.ObjectId();
  const otherVenueId = new mongoose.Types.ObjectId();
  const physicalVocabularyId = new mongoose.Types.ObjectId();
  const definitionId = randomUUID();
  const bundle = {
    physicalVocabulary: { _id: physicalVocabularyId },
    physicalVocabularyRevision: {
      physicalAttributes: [{
        definitionId,
        dataType: "number",
        appliesTo: "connection",
        options: [],
        visitorControl: {
          enabled: true,
          operator: "gte",
          valueMode: "user",
          priority: "preferred",
        },
      }],
    },
  };

  assert.throws(
    () => normalizeVenueControlSelections([
      { venueId, physicalAttributeDefinitionId: definitionId, value: 80 },
      { venueId, physicalAttributeDefinitionId: definitionId, value: 90 },
    ]),
    (error) => error?.details?.[0]?.code === "DUPLICATE_VENUE_CONTROL_SELECTION",
  );
  assert.throws(
    () => compileVenueControlSelections({
      selections: [{ venueId: otherVenueId, physicalAttributeDefinitionId: definitionId, value: 80 }],
      bundleByVenueId: new Map([[String(venueId), bundle]]),
    }),
    (error) => error?.details?.[0]?.code === "VENUE_CONTROL_OUTSIDE_PHYSICAL_SCOPE",
  );
  assert.throws(
    () => compileVenueControlSelections({
      selections: [{ venueId, physicalAttributeDefinitionId: definitionId, value: "ottanta" }],
      bundleByVenueId: new Map([[String(venueId), bundle]]),
    }),
    (error) => error?.details?.[0]?.code === "INCOMPATIBLE_VALUE",
  );
});

test("globali, opzioni locali e profili condividono lo stesso resolver e i conflitti hard bloccano", () => {
  const physicalVocabularyId = new mongoose.Types.ObjectId();
  const definitionId = randomUUID();
  const profileId = randomUUID();
  const physicalVocabulary = { _id: physicalVocabularyId };
  const revision = {
    physicalVocabularyId,
    physicalAttributes: [{
      definitionId,
      label: "Accessibile senza gradini",
      dataType: "boolean",
      unit: null,
      options: [],
      appliesTo: "both",
      semanticRefs: [{ scheme: "artaround-physical", id: "step_free", matchType: "exact" }],
    }],
    routingProfiles: [{
      definitionId: profileId,
      label: "Profilo incompatibile",
      requirements: [{
        physicalAttributeDefinitionId: definitionId,
        operator: "eq",
        value: false,
        priority: "required",
        weight: 1,
      }],
    }],
  };
  const globalRequirements = [{
    physicalFeatureRef: canonicalPhysicalFeatureRef("step_free"),
    operator: "eq",
    value: true,
    priority: "required",
    weight: 1,
  }];
  const localRequirements = [{
    physicalFeatureRef: {
      kind: "local",
      physicalVocabularyId,
      definitionId,
    },
    operator: "eq",
    value: true,
    priority: "preferred",
    weight: 1,
  }];

  const resolved = resolveVenueRoutingRequirements({
    globalRequirements,
    localRequirements,
    routingProfileSelection: { routingProfileDefinitionId: profileId },
    physicalVocabulary,
    revision,
  });
  assert.ok(resolved.requirements.some((entry) => entry.priority === "preferred" && entry.value === true));
  assert.ok(resolved.blockers.some((entry) => entry.code === "ROUTING_REQUIREMENT_CONFLICT"));
});

test("il supporto canonico usa la stessa compatibilita di scope della validation", () => {
  const connectionNeedOnBoth = {
    definitionId: randomUUID(),
    dataType: "number",
    unit: "cm",
    options: [],
    appliesTo: "both",
    semanticRefs: [{ scheme: "artaround-physical", id: "minimum_width_cm", matchType: "exact" }],
  };
  const connectionNeedOnPlaceOnly = { ...connectionNeedOnBoth, definitionId: randomUUID(), appliesTo: "place" };
  const bothNeedOnConnectionOnly = {
    definitionId: randomUUID(),
    dataType: "boolean",
    unit: null,
    options: [],
    appliesTo: "connection",
    semanticRefs: [{ scheme: "artaround-physical", id: "step_free", matchType: "exact" }],
  };

  assert.equal(definitionsCompatible(connectionNeedOnBoth, { dataType: "number", unit: "cm", options: [], appliesTo: "connection" }), false);
  assert.equal(canonicalDefinitionCompatible(connectionNeedOnBoth, { dataType: "number", unit: "cm", options: [], appliesTo: "connection" }), true);
  assert.equal(canonicalDefinitionCompatible(connectionNeedOnPlaceOnly, { dataType: "number", unit: "cm", options: [], appliesTo: "connection" }), false);
  assert.equal(canonicalDefinitionCompatible(bothNeedOnConnectionOnly, { dataType: "boolean", unit: null, options: [], appliesTo: "both" }), false);

  const support = canonicalNeedSupportProjection({ physicalAttributes: [connectionNeedOnBoth, bothNeedOnConnectionOnly] });
  assert.equal(support.find((entry) => entry.id === "minimum_width_cm").supported, true);
  assert.equal(support.find((entry) => entry.id === "step_free").supported, false);
});
