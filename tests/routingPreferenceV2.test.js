const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeCanonicalRoutingRequirements,
} = require("../services/routingPreferenceV2.service");

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
