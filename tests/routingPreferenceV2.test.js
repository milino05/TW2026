const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { applyPhysicalStarter } = require("../services/physicalVocabularyStarter.service");
const { normalizeRoutingRequirements } = require("../services/routingPreferenceV2.service");
const { translateRequirements } = require("../services/physicalExecutionV2.service");

test("routing preferences persist provider-neutral PhysicalFeatureRef semantics", () => {
  const normalized = normalizeRoutingRequirements([{
    physicalFeatureRef: {
      kind: " SEMANTIC ",
      semanticRefs: [{ scheme: " OPENSTREETMAP-TAG ", id: "step_count=*", matchType: " EXACT " }],
    },
    operator: "eq",
    value: false,
    priority: "avoid",
    weight: 2,
  }], { semanticOnly: true });
  assert.deepEqual(normalized, [{
    physicalFeatureRef: {
      kind: "semantic",
      semanticRefs: [{ scheme: "openstreetmap-tag", id: "step_count=*", matchType: "exact" }],
    },
    operator: "eq",
    value: false,
    priority: "avoid",
    weight: 2,
  }]);
});

test("persistent cross-Venue preferences reject a local definition identity", () => {
  const snapshot = applyPhysicalStarter({}).snapshot;
  assert.throws(
    () => normalizeRoutingRequirements([{
      physicalFeatureRef: {
        kind: "local",
        physicalVocabularyId: new mongoose.Types.ObjectId(),
        definitionId: snapshot.physicalAttributes[0].definitionId,
      },
      value: true,
    }], { semanticOnly: true }),
    (error) => error?.status === 400 && error?.details?.[0]?.code === "SEMANTIC_PHYSICAL_FEATURE_REQUIRED",
  );
});

test("routing preferences validate structural operators and values", () => {
  const semanticRef = { kind: "semantic", semanticRefs: [{ scheme: "openstreetmap-tag", id: "step_count=*", matchType: "exact" }] };
  assert.throws(
    () => normalizeRoutingRequirements([{ physicalFeatureRef: semanticRef, operator: "contains", value: true }]),
    (error) => error?.status === 400 && error?.details?.[0]?.code === "INVALID_ROUTING_OPERATOR",
  );
  assert.throws(
    () => normalizeRoutingRequirements([{ physicalFeatureRef: semanticRef, operator: "in", value: [] }]),
    (error) => error?.status === 400 && error?.details?.[0]?.code === "INVALID_ROUTING_VALUE",
  );
});

test("a semantic requirement resolves to different local definitionIds without a global canonical key", () => {
  const source = applyPhysicalStarter({}).snapshot;
  const target = applyPhysicalStarter({}).snapshot;
  const sourceDefinition = source.physicalAttributes.find((definition) => definition.key === "has_steps");
  const targetDefinition = target.physicalAttributes.find((definition) => definition.key === "has_steps");
  assert.notEqual(sourceDefinition.definitionId, targetDefinition.definitionId);
  const requirement = normalizeRoutingRequirements([{
    physicalFeatureRef: { kind: "semantic", semanticRefs: sourceDefinition.semanticRefs },
    operator: "eq",
    value: false,
    priority: "required",
    weight: 1,
  }]);
  const translated = translateRequirements(target, { _id: new mongoose.Types.ObjectId() }, requirement);
  assert.equal(translated.requirements[0].physicalAttributeDefinitionId, targetDefinition.definitionId);
  assert.deepEqual(translated.unsupportedRequired, []);
});

test("a resolved but type-incompatible required feature remains a blocker", () => {
  const target = applyPhysicalStarter({}).snapshot;
  const definition = target.physicalAttributes.find((entry) => entry.key === "has_steps");
  const physicalFeatureRef = { kind: "semantic", semanticRefs: definition.semanticRefs };
  const translated = translateRequirements(target, { _id: new mongoose.Types.ObjectId() }, [{
    physicalFeatureRef,
    operator: "gte",
    value: 1,
    priority: "required",
  }]);
  assert.deepEqual(translated.requirements, []);
  assert.deepEqual(translated.unsupportedRequired, [physicalFeatureRef]);
});
