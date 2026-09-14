const test = require("node:test");
const assert = require("node:assert/strict");
const {
  bindingFromAccess,
  effectiveRevisionId,
  isValidationFresh,
  assertDependencyReady,
  buildValidation,
} = require("../services/versionedSchemaDependency.service");

function id(value) { return String(value); }

test("follow_current resolves the current published revision and does not persist an implicit pin", () => {
  const binding = bindingFromAccess({
    access: { basis: "ownership", resolvedSnapshotRef: { resourceType: "namespace_revision", resourceId: "n1" } },
    effectiveRevisionId: "n1",
  });
  assert.equal(binding.versionPolicy, "follow_current");
  assert.equal(binding.pinnedRevisionId, null);
  assert.equal(id(effectiveRevisionId({ binding, publishedRevisionId: "n2" })), "n2");
});

test("pinned entitlement preserves its authorized historical revision", () => {
  const binding = bindingFromAccess({
    access: {
      basis: "entitlement",
      entitlement: { versionPolicy: "pinned" },
      resolvedSnapshotRef: { resourceType: "namespace_revision", resourceId: "n1" },
    },
    effectiveRevisionId: "n2",
  });
  assert.equal(binding.versionPolicy, "pinned");
  assert.equal(id(binding.pinnedRevisionId), "n1");
  assert.equal(id(effectiveRevisionId({ binding, publishedRevisionId: "n3" })), "n1");
});

test("dependency validation is fresh only for the exact consumer snapshot and dependency revision", () => {
  const validation = buildValidation({ consumerSnapshotId: "item-r1", dependencyRevisionId: "namespace-r2", issues: [] });
  const binding = { versionPolicy: "follow_current", pinnedRevisionId: null, validation };
  assert.equal(isValidationFresh({ binding, consumerSnapshotId: "item-r1", dependencyRevisionId: "namespace-r2" }), true);
  assert.equal(isValidationFresh({ binding, consumerSnapshotId: "item-r1", dependencyRevisionId: "namespace-r3" }), false);
  assert.equal(isValidationFresh({ binding, consumerSnapshotId: "item-r2", dependencyRevisionId: "namespace-r2" }), false);
});

test("additive or otherwise compatible changes produce automatic compatible validation", () => {
  const validation = buildValidation({
    consumerSnapshotId: "consumer-r1",
    dependencyRevisionId: "dependency-r2",
    issues: [{ severity: "warning", code: "NON_BLOCKING_NOTE" }],
  });
  assert.equal(validation.status, "valid");
  assert.equal(validation.outcome, "compatible");
  assert.doesNotThrow(() => assertDependencyReady({
    binding: { versionPolicy: "follow_current", validation },
    consumerSnapshotId: "consumer-r1",
    dependencyRevisionId: "dependency-r2",
  }));
});

test("breaking semantic changes require review and are not silently accepted", () => {
  const validation = buildValidation({
    consumerSnapshotId: "consumer-r1",
    dependencyRevisionId: "dependency-r2",
    issues: [{ code: "DEFINITION_NOT_AVAILABLE" }],
  });
  assert.equal(validation.status, "needs_review");
  assert.equal(validation.outcome, "requires_review");
  assert.throws(() => assertDependencyReady({
    binding: { versionPolicy: "follow_current", validation },
    consumerSnapshotId: "consumer-r1",
    dependencyRevisionId: "dependency-r2",
    codePrefix: "TEST_DEPENDENCY",
  }), (error) => error?.status === 409 && error?.details?.some?.((detail) => detail.code === "TEST_DEPENDENCY_REVIEW_REQUIRED"));
});

test("a previously valid audit becomes stale when the live dependency advances", () => {
  const validation = buildValidation({ consumerSnapshotId: "consumer-r1", dependencyRevisionId: "dependency-r1", issues: [] });
  assert.throws(() => assertDependencyReady({
    binding: { versionPolicy: "follow_current", validation },
    consumerSnapshotId: "consumer-r1",
    dependencyRevisionId: "dependency-r2",
    codePrefix: "TEST_DEPENDENCY",
  }), (error) => error?.status === 409 && error?.details?.some?.((detail) => detail.code === "TEST_DEPENDENCY_REVALIDATION_REQUIRED"));
});
