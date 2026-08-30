const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_learning_v2`;
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

test("learning v2 separates Subject, Edition, Namespace and VenueTarget scopes", { skip: !mongoUri }, async () => {
  process.env.ADAPTIVE_CONTRIBUTOR_SECRET = process.env.ADAPTIVE_CONTRIBUTOR_SECRET || "learning-v2-test-secret-value";
  await withFreshDatabase(async () => {
    loadAllModels();
    const User = require("../models/user");
    const Organization = require("../models/organization.model");
    const Subject = require("../models/subject.model");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const ItemV2 = require("../models/itemV2.model");
    const ItemEdition = require("../models/itemEdition.model");
    const ItemRevisionV2 = require("../models/itemRevisionV2.model");
    const Venue = require("../models/venue.model");
    const VenueTarget = require("../models/venueTarget.model");
    const UserContentExposureV2 = require("../models/userContentExposureV2.model");
    const LearningContribution = require("../models/learningContribution.model");
    const {
      upsertSubjectAffinity,
      upsertSubjectKnowledge,
      upsertItemEditionAffinity,
      upsertNamespaceFeatureAffinity,
      recordContentExposure,
      recordVenueTargetObservation,
      loadUserLearningState,
      candidateNovelty,
      removeUserLearningV2,
    } = require("../services/learningV2.service");

    const user = await User.create({ username: "learning-v2-test", passwordHash: "test-hash" });
    const organization = await Organization.create({ name: "Learning venue org", createdBy: user._id });
    const subject = await Subject.create({ preferredLabel: "Opera globale", createdBy: user._id });
    const namespace = await Namespace.create({ name: "Schema editoriale", ownerType: "user", ownerId: user._id, createdBy: user._id });
    const aspectDefinitionId = "aspect-history-v1";
    const namespaceRevision = await NamespaceRevision.create({
      namespaceId: namespace._id,
      version: 1,
      presentationAspects: [{ definitionId: aspectDefinitionId, key: "historical", label: "Storico" }],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
      publication: { publishedAt: new Date(), publishedBy: user._id },
      createdBy: user._id,
      updatedBy: user._id,
    });
    namespace.publishedRevisionId = namespaceRevision._id;
    await namespace.save();

    const item = await ItemV2.create({ primarySubjectId: subject._id, ownerType: "user", ownerId: user._id, createdBy: user._id });
    const edition = await ItemEdition.create({ itemId: item._id, namespaceId: namespace._id, createdBy: user._id });
    const variantId = new mongoose.Types.ObjectId();
    const representationId = new mongoose.Types.ObjectId();
    const itemRevision = await ItemRevisionV2.create({
      itemEditionId: edition._id,
      version: 1,
      authoredAgainstNamespaceRevisionId: namespaceRevision._id,
      label: "Testo editoriale",
      authorCredits: ["Autore"],
      metadata: { license: "CC BY" },
      presentationVariants: [{
        _id: variantId,
        key: "standard",
        label: "Standard",
        presentationAspects: [{ definitionId: aspectDefinitionId, weight: 1 }],
        representations: [{
          _id: representationId,
          durationTypeDefinitionId: "duration-standard",
          languageLevelDefinitionId: "language-medium",
          locale: "it-IT",
          text: "Descrizione di prova",
        }],
      }],
      defaultPresentation: { variantId, representationId },
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
      publication: { publishedAt: new Date(), publishedBy: user._id },
      createdBy: user._id,
      updatedBy: user._id,
    });
    edition.publishedRevisionId = itemRevision._id;
    await edition.save();

    const venue = await Venue.create({ name: "Venue learning", ownerOrganizationId: organization._id, createdBy: user._id });
    const target = await VenueTarget.create({ venueId: venue._id, subjectId: subject._id, displayLabelOverride: "Opera fisica", createdBy: user._id });

    await upsertSubjectAffinity({ userId: user._id, subjectId: subject._id, evidence: 1 });
    await upsertSubjectKnowledge({ userId: user._id, subjectId: subject._id, level: 0.8, confidence: 1, source: "explicit" });
    await upsertItemEditionAffinity({ userId: user._id, itemEditionId: edition._id, evidence: 0.7 });
    await upsertNamespaceFeatureAffinity({
      userId: user._id,
      namespaceId: namespace._id,
      namespaceRevisionId: namespaceRevision._id,
      kind: "presentation_aspect",
      definitionId: aspectDefinitionId,
      evidence: 0.9,
    });
    await recordContentExposure({
      userId: user._id,
      itemEditionId: edition._id,
      itemRevisionId: itemRevision._id,
      variantId,
      representationId,
      completionRatio: 0.75,
    });
    const observation = await recordVenueTargetObservation({ userId: user._id, venueTargetId: target._id, observedSeconds: 60 });
    assert.equal(observation.accepted, true);
    assert.equal(observation.profile.sampleCount, 1);
    assert.equal(observation.profile.contributorCount, 1);
    assert.equal(observation.profile.typicalObservationSeconds, 60);

    const state = await loadUserLearningState({
      userId: user._id,
      subjectIds: [subject._id],
      itemEditionIds: [edition._id],
      namespaceIds: [namespace._id],
    });
    assert.equal(state.subjectAffinities.length, 1);
    assert.equal(state.subjectKnowledge.length, 1);
    assert.equal(state.editionAffinities.length, 1);
    assert.equal(state.exposures.length, 1);
    assert.equal(state.namespaceFeatureAffinities.length, 1);
    assert.deepEqual(candidateNovelty(state, { itemEditionId: edition._id, variantId, representationId }), { score: 0.05, reason: "familiar_content" });

    const exposure = await UserContentExposureV2.findOne({ userId: user._id, itemEditionId: edition._id }).lean();
    assert.equal(exposure.completionEma, 0.75);
    assert.equal(String(exposure.lastItemRevisionId), String(itemRevision._id));
    assert.equal(exposure.museumId, undefined);

    await removeUserLearningV2(user._id);
    const afterRemoval = await loadUserLearningState({ userId: user._id, subjectIds: [subject._id], itemEditionIds: [edition._id], namespaceIds: [namespace._id] });
    assert.equal(afterRemoval.subjectAffinities.length, 0);
    assert.equal(afterRemoval.exposures.length, 0);
    assert.equal(await LearningContribution.countDocuments({}), 0);
  });
});
