const PhysicalVocabulary = require("../../models/physicalVocabulary.model");
const PhysicalVocabularyRevision = require("../../models/physicalVocabularyRevision.model");
const { applyPhysicalStarter } = require("../../services/physicalVocabularyStarter.service");

async function createPublishedPhysicalVocabulary({ userId, ownerType = "user", ownerId = userId, name = "Vocabolario fisico di test" }) {
  const physicalVocabulary = await PhysicalVocabulary.create({
    name,
    ownerType,
    ownerId,
    createdBy: userId,
  });
  const snapshot = applyPhysicalStarter({}).snapshot;
  const revision = await PhysicalVocabularyRevision.create({
    physicalVocabularyId: physicalVocabulary._id,
    version: 1,
    ...snapshot,
    status: "published",
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: userId },
    publication: { publishedAt: new Date(), publishedBy: userId },
    createdBy: userId,
    updatedBy: userId,
  });
  physicalVocabulary.publishedRevisionId = revision._id;
  await physicalVocabulary.save();
  return {
    physicalVocabulary,
    revision,
    placeTypeByKey: new Map(revision.placeTypes.map((definition) => [definition.key, definition])),
    connectionTypeByKey: new Map(revision.connectionTypes.map((definition) => [definition.key, definition])),
    physicalAttributeByKey: new Map(revision.physicalAttributes.map((definition) => [definition.key, definition])),
    routingProfileByKey: new Map(revision.routingProfiles.map((definition) => [definition.key, definition])),
  };
}

module.exports = { createPublishedPhysicalVocabulary };
