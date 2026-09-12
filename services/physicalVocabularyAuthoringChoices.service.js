const Entitlement = require("../models/entitlement.model");
const PhysicalVocabulary = require("../models/physicalVocabulary.model");
const PhysicalVocabularyRevision = require("../models/physicalVocabularyRevision.model");
const { nowWithin } = require("./capabilityAuthorization.service");

function id(value) { return String(value?._id || value || ""); }

function choice({ vocabulary, revision, basis }) {
  return {
    physicalVocabularyId: vocabulary._id,
    physicalVocabularyRevisionId: revision._id,
    name: vocabulary.name,
    description: vocabulary.description || "",
    version: revision.version,
    revisionStatus: revision.status,
    basis,
  };
}

async function ownedChoices({ organizationId, canViewOwned = true }) {
  if (!canViewOwned) return [];
  const vocabularies = await PhysicalVocabulary.find({
    ownerType: "organization",
    ownerId: organizationId,
    lifecycleStatus: "active",
    $or: [{ workingRevisionId: { $ne: null } }, { publishedRevisionId: { $ne: null } }],
  }).sort({ name: 1, createdAt: 1 }).lean();
  const revisionIds = vocabularies.map((entry) => entry.workingRevisionId || entry.publishedRevisionId).filter(Boolean);
  const revisions = revisionIds.length ? await PhysicalVocabularyRevision.find({ _id: { $in: revisionIds } }).lean() : [];
  const revisionById = new Map(revisions.map((entry) => [id(entry._id), entry]));
  return vocabularies.map((vocabulary) => {
    const revision = revisionById.get(id(vocabulary.workingRevisionId || vocabulary.publishedRevisionId));
    return revision ? choice({ vocabulary, revision, basis: "organization" }) : null;
  }).filter(Boolean);
}

async function licensedChoices({ organizationId }) {
  const now = new Date();
  const entitlements = (await Entitlement.find({
    beneficiaryType: "organization",
    beneficiaryId: organizationId,
    capability: "physical_vocabulary.author",
    status: "active",
    resourceType: { $in: ["physical_vocabulary", "physical_vocabulary_revision"] },
  }).sort({ createdAt: -1 }).lean()).filter((entry) => nowWithin(entry, now));

  const resolvedRevisionIds = [];
  const liveVocabularyIds = [];
  for (const entitlement of entitlements) {
    if (entitlement.resourceType === "physical_vocabulary_revision") {
      resolvedRevisionIds.push(entitlement.resourceId);
      continue;
    }
    if (entitlement.versionPolicy === "pinned" && entitlement.baselineSnapshotRef?.resourceType === "physical_vocabulary_revision") {
      resolvedRevisionIds.push(entitlement.baselineSnapshotRef.resourceId);
    } else liveVocabularyIds.push(entitlement.resourceId);
  }

  if (liveVocabularyIds.length) {
    const live = await PhysicalVocabulary.find({
      _id: { $in: liveVocabularyIds },
      lifecycleStatus: "active",
      publishedRevisionId: { $ne: null },
    }).select("publishedRevisionId").lean();
    resolvedRevisionIds.push(...live.map((entry) => entry.publishedRevisionId));
  }

  const uniqueRevisionIds = [...new Map(resolvedRevisionIds.map((entry) => [id(entry), entry])).values()];
  if (!uniqueRevisionIds.length) return [];
  const revisions = await PhysicalVocabularyRevision.find({
    _id: { $in: uniqueRevisionIds },
    status: { $in: ["published", "superseded"] },
  }).lean();
  const vocabularyIds = [...new Map(revisions.map((entry) => [id(entry.physicalVocabularyId), entry.physicalVocabularyId])).values()];
  const vocabularies = await PhysicalVocabulary.find({ _id: { $in: vocabularyIds } }).lean();
  const vocabularyById = new Map(vocabularies.map((entry) => [id(entry._id), entry]));
  return revisions.map((revision) => {
    const vocabulary = vocabularyById.get(id(revision.physicalVocabularyId));
    return vocabulary ? choice({ vocabulary, revision, basis: "license" }) : null;
  }).filter(Boolean);
}

async function listPhysicalVocabularyAuthoringChoices({ organizationId, canViewOwned = true }) {
  const [owned, licensed] = await Promise.all([
    ownedChoices({ organizationId, canViewOwned }),
    licensedChoices({ organizationId }),
  ]);
  const choices = [...owned, ...licensed].filter((entry, index, all) =>
    all.findIndex((candidate) => id(candidate.physicalVocabularyRevisionId) === id(entry.physicalVocabularyRevisionId)) === index
  );
  return choices.sort((left, right) => left.name.localeCompare(right.name, "it", { sensitivity: "base" }));
}

module.exports = { listPhysicalVocabularyAuthoringChoices };
