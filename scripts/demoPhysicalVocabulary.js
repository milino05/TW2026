const PhysicalVocabulary = require("../models/physicalVocabulary.model");
const PhysicalVocabularyRevision = require("../models/physicalVocabularyRevision.model");
const { applyPhysicalStarter } = require("../services/physicalVocabularyStarter.service");

async function createDemoPhysicalVocabulary({ physicalVocabularyId, revisionId, organizationId, userId, name, now }) {
  const physicalVocabulary = await PhysicalVocabulary.create({
    _id: physicalVocabularyId,
    name,
    description: "Vocabolario fisico starter usato dal dataset dimostrativo ArtAround.",
    ownerType: "organization",
    ownerId: organizationId,
    createdBy: userId,
  });
  const snapshot = applyPhysicalStarter({}).snapshot;
  const revision = await PhysicalVocabularyRevision.create({
    _id: revisionId,
    physicalVocabularyId: physicalVocabulary._id,
    version: 1,
    ...snapshot,
    status: "published",
    integrity: { status: "valid", issues: [], checkedAt: now, checkedBy: userId },
    publication: { publishedAt: now, publishedBy: userId },
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
  };
}

function physicalAttributeValues(attributeByKey, values) {
  return Object.entries(values).map(([key, value]) => ({
    physicalAttributeDefinitionId: attributeByKey.get(key).definitionId,
    value,
  }));
}

module.exports = { createDemoPhysicalVocabulary, physicalAttributeValues };
