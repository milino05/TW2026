const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeCanonicalRoutingRequirements,
} = require("../services/routingPreferenceV2.service");
const { translateRequirements } = require("../services/physicalExecutionV2.service");

test("routing preferences accept only canonical global attributes", () => {
  const normalized = normalizeCanonicalRoutingRequirements([
    {
      attributeKey: "STEP_FREE",
      operator: "eq",
      value: true,
      priority: "required",
      weight: 2,
    },
  ]);
  assert.deepEqual(normalized, [{
    attributeKey: "step_free",
    operator: "eq",
    value: true,
    priority: "required",
    weight: 2,
  }]);
});

test("routing preferences reject LayoutRevision-local keys", () => {
  assert.throws(
    () => normalizeCanonicalRoutingRequirements([{ attributeKey: "no_marble_floor", value: true }]),
    (error) => error?.status === 400 && error?.details?.[0]?.code === "UNKNOWN_GLOBAL_ROUTING_ATTRIBUTE",
  );
});

test("routing preferences validate value and operator against canonical data type", () => {
  assert.throws(
    () => normalizeCanonicalRoutingRequirements([{ attributeKey: "step_free", operator: "gte", value: true }]),
    (error) => error?.status === 400 && error?.details?.[0]?.code === "INVALID_ROUTING_OPERATOR",
  );
  assert.throws(
    () => normalizeCanonicalRoutingRequirements([{ attributeKey: "stairs", operator: "eq", value: "yes" }]),
    (error) => error?.status === 400 && error?.details?.[0]?.code === "INVALID_ROUTING_VALUE",
  );
});

test("a global requirement is mapped only through explicit canonicalKey", () => {
  const requirement = [{ attributeKey: "step_free", operator: "eq", value: true, priority: "required", weight: 1 }];
  const sameLocalKeyWithoutMapping = translateRequirements({
    routingAttributes: [{ key: "step_free", label: "Nome locale coincidente", dataType: "boolean", appliesTo: "connection" }],
  }, requirement);
  assert.deepEqual(sameLocalKeyWithoutMapping.requirements, []);
  assert.deepEqual(sameLocalKeyWithoutMapping.unsupportedRequired, ["step_free"]);

  const explicitlyMapped = translateRequirements({
    routingAttributes: [{ key: "senza_gradini_locale", label: "Senza gradini", dataType: "boolean", appliesTo: "connection", canonicalKey: "step_free" }],
  }, requirement);
  assert.equal(explicitlyMapped.requirements[0].attributeKey, "senza_gradini_locale");
  assert.deepEqual(explicitlyMapped.unsupportedRequired, []);
});
