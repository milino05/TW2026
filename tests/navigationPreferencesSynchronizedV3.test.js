const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("crypto");
const mongoose = require("mongoose");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_navigation_preferences_sync_v3`;
  return parsed.toString();
}
const mongoUri = isolatedMongoUri(baseMongoUri);

function loadAllModels() {
  const modelsDir = path.join(__dirname, "..", "models");
  for (const file of fs.readdirSync(modelsDir)) if (file.endsWith(".js")) require(path.join(modelsDir, file));
}

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

function emptySharedPlan(visitRevisionId) {
  return {
    origin: { sourceType: "visit", visitRevisionId, generatedVisitPlanId: null },
    createdReason: "initial",
    fidelity: "preserve",
    executedThroughEntryIndex: -1,
    sourceEditorialReleaseIds: [],
    semanticGraphPins: [],
    semanticContentPins: [],
    contentEntries: [],
    visitAnchors: [],
    physicalRoute: { legs: [] },
    estimatedTiming: {},
    explanation: {},
  };
}

test("la sessione sincronizzata congela lo snapshot di navigazione deciso dall'host", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    loadAllModels();
    const User = require("../models/user");
    const SynchronizedVisitSession = require("../models/synchronizedVisitSession.model");
    const { createSynchronizedVisitRuntime } = require("../services/synchronizedVisitSession.service");
    const { canonicalPhysicalFeatureRef } = require("../config/navigationNeedCatalog");

    const host = await User.create({ username: "navigation-sync-host", passwordHash: "test-hash" });
    const visitId = new mongoose.Types.ObjectId();
    const visitRevisionId = new mongoose.Types.ObjectId();
    const venueId = new mongoose.Types.ObjectId();
    const physicalVocabularyId = new mongoose.Types.ObjectId();
    const localDefinitionId = randomUUID();
    const navigationSnapshot = {
      movementPacePreference: 0.35,
      routingProfileSelections: [],
      requirements: [{
        physicalFeatureRef: canonicalPhysicalFeatureRef("step_free"),
        operator: "eq",
        value: true,
        priority: "required",
        weight: 1,
      }],
      venueRequirements: [{
        venueId,
        requirements: [{
          physicalFeatureRef: {
            kind: "local",
            physicalVocabularyId,
            definitionId: localDefinitionId,
          },
          operator: "eq",
          value: false,
          priority: "preferred",
          weight: 1,
        }],
      }],
    };

    const runtime = await createSynchronizedVisitRuntime({
      hostUserId: host._id,
      visitId,
      visitRevisionId,
      preferredAlias: "Percorso host",
      plan: emptySharedPlan(visitRevisionId),
      venuePins: [{
        venueId,
        venueReleaseId: new mongoose.Types.ObjectId(),
        layoutRevisionId: new mongoose.Types.ObjectId(),
        physicalVocabularyRevisionId: new mongoose.Types.ObjectId(),
      }],
      navigationSnapshot,
      sessionMovementSpeedMps: 1,
      adaptivePolicyVersion: 1,
    });

    const stored = await SynchronizedVisitSession.findById(runtime.synchronizedSession._id).lean();
    assert.equal(stored.navigationSnapshot.movementPacePreference, 0.35);
    assert.equal(stored.navigationSnapshot.requirements.length, 1);
    assert.equal(stored.navigationSnapshot.requirements[0].physicalFeatureRef.kind, "semantic");
    assert.equal(stored.navigationSnapshot.venueRequirements.length, 1);
    assert.equal(String(stored.navigationSnapshot.venueRequirements[0].venueId), String(venueId));
    assert.equal(stored.navigationSnapshot.venueRequirements[0].requirements[0].physicalFeatureRef.kind, "local");
    assert.equal(stored.navigationSnapshot.venueRequirements[0].requirements[0].physicalFeatureRef.definitionId, localDefinitionId);

    // La VisitSession personale dell'host non possiede un secondo routing fisico:
    // durante una visita sincronizzata il physicalSession è la SynchronizedVisitSession condivisa.
    assert.equal(runtime.hostVisitSession.synchronizedSessionId.toString(), stored._id.toString());
  });
});
