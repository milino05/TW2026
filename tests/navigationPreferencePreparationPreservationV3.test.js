const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const { canonicalPhysicalFeatureRef } = require("../config/navigationNeedCatalog");

const mongoUri = process.env.MONGO_URI;

async function withFreshDatabase(callback) {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  try {
    await mongoose.connection.dropDatabase();
    return await callback();
  } finally {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  }
}

test("un override delle esigenze canoniche preserva i requirement semantic provider-neutral della preparation", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const VisitV2 = require("../models/visitV2.model");
    const VisitRevisionV2 = require("../models/visitRevisionV2.model");
    const ExecutionPreparation = require("../models/executionPreparation.model");
    const {
      createExecutionPreparation,
      updateExecutionPreparation,
    } = require("../services/executionPreparationV2.service");

    const providerNeutralRequirement = {
      physicalFeatureRef: {
        kind: "semantic",
        semanticRefs: [{ scheme: "example-provider", id: "covered-route", matchType: "exact" }],
      },
      operator: "eq",
      value: true,
      priority: "preferred",
      weight: 0.7,
    };
    const stepFreeRequirement = {
      physicalFeatureRef: canonicalPhysicalFeatureRef("step_free"),
      operator: "eq",
      value: true,
      priority: "required",
      weight: 1,
    };

    const owner = await User.create({
      username: "provider-neutral-preparation-owner",
      passwordHash: "test-hash",
      defaultNavigationPreference: {
        movementPacePreference: 0.5,
        requirements: [providerNeutralRequirement, stepFreeRequirement],
      },
    });
    const visit = await VisitV2.create({ ownerType: "user", ownerId: owner._id, createdBy: owner._id });
    const revision = await VisitRevisionV2.create({
      visitId: visit._id,
      version: 1,
      title: "Provider-neutral preparation",
      editorialSources: [],
      contentEntries: [],
      visitAnchors: [],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: owner._id },
      publication: { publishedAt: new Date(), publishedBy: owner._id },
      createdBy: owner._id,
      updatedBy: owner._id,
    });
    visit.publishedRevisionId = revision._id;
    await visit.save();

    const preparation = await createExecutionPreparation({ userId: owner._id, payload: { visitId: visit._id } });
    assert.deepEqual(preparation.navigation.personalNeeds.selected.map((entry) => entry.id), ["step_free"]);

    const updated = await updateExecutionPreparation({
      preparationId: preparation.id,
      userId: owner._id,
      expectedVersion: preparation.version,
      payload: {
        personalNeedSelections: [{ id: "obstacles_present", priority: "preferred" }],
      },
    });
    assert.deepEqual(updated.navigation.personalNeeds.selected.map((entry) => entry.id), ["obstacles_present"]);

    const stored = await ExecutionPreparation.findById(preparation.id).lean();
    const requirements = stored.navigationSnapshot.requirements;
    assert.equal(requirements.length, 2);
    assert.ok(requirements.some((entry) => entry.physicalFeatureRef.semanticRefs?.some((ref) => ref.scheme === "example-provider" && ref.id === "covered-route")));
    assert.ok(requirements.some((entry) => entry.physicalFeatureRef.semanticRefs?.some((ref) => ref.scheme === "artaround-physical" && ref.id === "obstacles_present")));
    assert.equal(requirements.some((entry) => entry.physicalFeatureRef.semanticRefs?.some((ref) => ref.scheme === "artaround-physical" && ref.id === "step_free")), false);
  });
});
