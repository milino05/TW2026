const { randomUUID } = require("crypto");
const PhysicalVocabulary = require("../models/physicalVocabulary.model");
const PhysicalVocabularyRevision = require("../models/physicalVocabularyRevision.model");
const { applyPhysicalStarter } = require("../services/physicalVocabularyStarter.service");

function demoLocalPhysicalAttributes() {
  return [
    {
      definitionId: randomUUID(),
      key: "sensory_load",
      label: "Livello di stimoli ambientali",
      description: "Indicatore locale del museo per descrivere rumore, affollamento e intensità degli stimoli ambientali.",
      localizations: [{ locale: "it-IT", aliases: ["rumore", "stimoli ambientali"] }],
      semanticRefs: [],
      metadata: { demoLocal: true },
      dataType: "choice",
      unit: null,
      options: [
        { value: "low", label: "Basso" },
        { value: "medium", label: "Medio" },
        { value: "high", label: "Alto" },
      ],
      appliesTo: "both",
      visitorControl: { enabled: false },
    },
    {
      definitionId: randomUUID(),
      key: "quiet_area",
      label: "Area tranquilla",
      description: "Indicatore locale del museo per identificare spazi adatti a una sosta in un ambiente più tranquillo.",
      localizations: [{ locale: "it-IT", aliases: ["zona tranquilla", "area calma"] }],
      semanticRefs: [],
      metadata: { demoLocal: true },
      dataType: "boolean",
      unit: null,
      options: [],
      appliesTo: "place",
      visitorControl: { enabled: false },
    },
  ];
}

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
  snapshot.physicalAttributes.push(...demoLocalPhysicalAttributes());
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
