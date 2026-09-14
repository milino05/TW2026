const Entitlement = require("../models/entitlement.model");
const PhysicalVocabulary = require("../models/physicalVocabulary.model");
const PhysicalVocabularyRevision = require("../models/physicalVocabularyRevision.model");
const { nowWithin } = require("./capabilityAuthorization.service");

function id(value) { return String(value?._id || value || ""); }

function choice({ vocabulary, revision, basis, versionPolicy = "follow_current" }) {
  return {
    physicalVocabularyId: vocabulary._id,
    effectiveRevisionId: revision._id,
    name: vocabulary.name,
    description: vocabulary.description || "",
    effectiveVersion: revision.version,
    revisionStatus: revision.status,
    versionPolicy,
    basis,
  };
}

async function ownedChoices({ organizationId, canViewOwned = true }) {
  if (!canViewOwned) return [];
  const vocabularies = await PhysicalVocabulary.find({
    ownerType: "organization",
    ownerId: organizationId,
    lifecycleStatus: "active",
    publishedRevisionId: { $ne: null },
  }).sort({ name: 1, createdAt: 1 }).lean();
  const revisionIds = vocabularies.map((entry) => entry.publishedRevisionId).filter(Boolean);
  const revisions = revisionIds.length ? await PhysicalVocabularyRevision.find({
    _id: { $in: revisionIds },
    status: "published",
    "integrity.status": "valid",
  }).lean() : [];
  const revisionById = new Map(revisions.map((entry) => [id(entry._id), entry]));
  return vocabularies.map((vocabulary) => {
    const revision = revisionById.get(id(vocabulary.publishedRevisionId));
    return revision ? choice({ vocabulary, revision, basis: "organization", versionPolicy: "follow_current" }) : null;
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

  const requested = [];
  for (const entitlement of entitlements) {
    if (entitlement.resourceType === "physical_vocabulary_revision") {
      requested.push({ revisionId: entitlement.resourceId, versionPolicy: "pinned" });
      continue;
    }
    if (entitlement.versionPolicy === "pinned" && entitlement.baselineSnapshotRef?.resourceType === "physical_vocabulary_revision") {
      requested.push({ revisionId: entitlement.baselineSnapshotRef.resourceId, versionPolicy: "pinned" });
      continue;
    }
    const vocabulary = await PhysicalVocabulary.findOne({
      _id: entitlement.resourceId,
      lifecycleStatus: "active",
      publishedRevisionId: { $ne: null },
    }).select("publishedRevisionId").lean();
    if (vocabulary?.publishedRevisionId) requested.push({ revisionId: vocabulary.publishedRevisionId, versionPolicy: "follow_current" });
  }

  const unique = [...new Map(requested.map((entry) => [`${id(entry.revisionId)}:${entry.versionPolicy}`, entry])).values()];
  if (!unique.length) return [];
  const revisions = await PhysicalVocabularyRevision.find({
    _id: { $in: unique.map((entry) => entry.revisionId) },
    status: { $in: ["published", "superseded"] },
    "integrity.status": "valid",
  }).lean();
  const revisionById = new Map(revisions.map((entry) => [id(entry._id), entry]));
  const vocabularyIds = [...new Map(revisions.map((entry) => [id(entry.physicalVocabularyId), entry.physicalVocabularyId])).values()];
  const vocabularies = await PhysicalVocabulary.find({ _id: { $in: vocabularyIds } }).lean();
  const vocabularyById = new Map(vocabularies.map((entry) => [id(entry._id), entry]));
  const raw = unique.map((entry) => {
    const revision = revisionById.get(id(entry.revisionId));
    const vocabulary = revision ? vocabularyById.get(id(revision.physicalVocabularyId)) : null;
    return vocabulary ? choice({ vocabulary, revision, basis: "license", versionPolicy: entry.versionPolicy }) : null;
  }).filter(Boolean);

  const byLineage = new Map();
  for (const entry of raw) {
    const key = id(entry.physicalVocabularyId);
    const current = byLineage.get(key);
    if (!current || (current.versionPolicy === "pinned" && entry.versionPolicy === "follow_current")
      || (current.versionPolicy === entry.versionPolicy && Number(entry.effectiveVersion) > Number(current.effectiveVersion))) {
      byLineage.set(key, entry);
    }
  }
  return [...byLineage.values()];
}

async function listPhysicalVocabularyAuthoringChoices({ organizationId, canViewOwned = true }) {
  const [owned, licensed] = await Promise.all([
    ownedChoices({ organizationId, canViewOwned }),
    licensedChoices({ organizationId }),
  ]);
  const choices = [...owned, ...licensed].filter((entry, index, all) =>
    all.findIndex((candidate) => id(candidate.physicalVocabularyId) === id(entry.physicalVocabularyId)) === index
  );
  return choices.sort((left, right) => left.name.localeCompare(right.name, "it", { sensitivity: "base" }));
}

module.exports = { listPhysicalVocabularyAuthoringChoices };
