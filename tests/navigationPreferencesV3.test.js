const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("crypto");
const mongoose = require("mongoose");

const {
  canonicalPhysicalFeatureRef,
  projectNavigationNeedCatalog,
} = require("../config/navigationNeedCatalog");
const {
  normalizePersonalNavigationRequirements,
  projectPersonalNavigationRequirements,
} = require("../services/navigationNeedPreference.service");
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
} = require("../services/routingProfileV2.service");

test("il catalogo personale espone esigenze atomiche canoniche e non profili locali", () => {
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
    assert.equal(need.physicalFeatureRef.kind, "semantic");
    assert.deepEqual(need.allowedPriorities, ["preferred", "required"]);
    assert.equal(need.physicalFeatureRef.semanticRefs[0].scheme, "artaround-physical");
    assert.equal(need.physicalFeatureRef.semanticRefs[0].matchType, "exact");
  }
});

test("le preferenze persistenti accettano solo esigenze ArtAround canoniche", () => {
  const requirement = {
    physicalFeatureRef: canonicalPhysicalFeatureRef("step_free"),
    operator: "eq",
    value: true,
    priority: "required",
    weight: 1,
  };
  const normalized = normalizePersonalNavigationRequirements([requirement]);
  assert.equal(normalized.length, 1);
  assert.equal(projectPersonalNavigationRequirements(normalized)[0].id, "step_free");

  assert.throws(
    () => normalizePersonalNavigationRequirements([{ ...requirement, priority: "avoid" }]),
    (error) => error?.status === 400 && error?.details?.[0]?.code === "PERSONAL_NAVIGATION_PRIORITY_NOT_ALLOWED",
  );
  assert.throws(
    () => normalizePersonalNavigationRequirements([{ ...requirement, weight: 2 }]),
    (error) => error?.status === 400 && error?.details?.[0]?.code === "PERSONAL_NAVIGATION_WEIGHT_NOT_ALLOWED",
  );
  assert.throws(
    () => normalizePersonalNavigationRequirements([{ ...requirement, value: false }]),
    (error) => error?.status === 400 && error?.details?.[0]?.code === "PERSONAL_NAVIGATION_VALUE_MISMATCH",
  );
  assert.throws(
    () => normalizePersonalNavigationRequirements([{
      ...requirement,
      physicalFeatureRef: {
        kind: "semantic",
        semanticRefs: [{ scheme: "openstreetmap-tag", id: "wheelchair=yes", matchType: "exact" }],
      },
    }]),
    (error) => error?.status === 400 && error?.details?.[0]?.code === "UNKNOWN_PERSONAL_NAVIGATION_NEED",
  );
  assert.throws(
    () => normalizePersonalNavigationRequirements([requirement, requirement]),
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

test("il supporto canonico richiede semantic ref, tipo, unita e scope esattamente compatibili", () => {
  const exact = {
    definitionId: randomUUID(),
    dataType: "boolean",
    unit: null,
    options: [],
    appliesTo: "both",
    semanticRefs: [{ scheme: "artaround-physical", id: "step_free", matchType: "exact" }],
  };
  const wrongScope = { ...exact, definitionId: randomUUID(), appliesTo: "connection" };
  assert.equal(definitionsCompatible(exact, { dataType: "boolean", unit: null, options: [], appliesTo: "both" }), true);
  assert.equal(definitionsCompatible(wrongScope, { dataType: "boolean", unit: null, options: [], appliesTo: "both" }), false);
  const support = canonicalNeedSupportProjection({ physicalAttributes: [wrongScope] });
  assert.equal(support.find((entry) => entry.id === "step_free").supported, false);
});
