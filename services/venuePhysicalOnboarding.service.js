const Entitlement = require("../models/entitlement.model");
const LayoutRevision = require("../models/layoutRevision.model");
const PhysicalVocabulary = require("../models/physicalVocabulary.model");
const PhysicalVocabularyRevision = require("../models/physicalVocabularyRevision.model");
const Venue = require("../models/venue.model");
const VenueRelease = require("../models/venueRelease.model");
const AppError = require("../utils/AppError");
const { nowWithin } = require("./capabilityAuthorization.service");
const { createPhysicalVocabulary } = require("./physicalVocabulary.service");
const { assertVenuePermission } = require("./venueAuthorization.service");
const { ensureWorkingVenueRelease } = require("./venueRelease.service");

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

async function ownedChoices({ organizationId, canView }) {
  if (!canView) return [];
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
    const live = await PhysicalVocabulary.find({ _id: { $in: liveVocabularyIds }, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).select("publishedRevisionId").lean();
    resolvedRevisionIds.push(...live.map((entry) => entry.publishedRevisionId));
  }
  const uniqueRevisionIds = [...new Map(resolvedRevisionIds.map((entry) => [id(entry), entry])).values()];
  if (!uniqueRevisionIds.length) return [];
  const revisions = await PhysicalVocabularyRevision.find({ _id: { $in: uniqueRevisionIds }, status: { $in: ["published", "superseded"] } }).lean();
  const vocabularyIds = [...new Map(revisions.map((entry) => [id(entry.physicalVocabularyId), entry.physicalVocabularyId])).values()];
  const vocabularies = await PhysicalVocabulary.find({ _id: { $in: vocabularyIds }, lifecycleStatus: "active" }).lean();
  const vocabularyById = new Map(vocabularies.map((entry) => [id(entry._id), entry]));
  return revisions.map((revision) => {
    const vocabulary = vocabularyById.get(id(revision.physicalVocabularyId));
    return vocabulary ? choice({ vocabulary, revision, basis: "license" }) : null;
  }).filter(Boolean);
}

async function getVenuePhysicalOnboarding({ venueId, actorUserId }) {
  const { venue, authority } = await assertVenuePermission({ userId: actorUserId, venueId, permissionCode: "venue.physical.edit" });
  if (venue.workingReleaseId || venue.publishedReleaseId) {
    return { required: false, venueId: venue._id, canCreate: false, choices: [] };
  }
  const permissions = new Set(authority.effectivePermissions || []);
  const [owned, licensed] = await Promise.all([
    ownedChoices({ organizationId: venue.ownerOrganizationId, canView: permissions.has("physical_vocabulary.view") }),
    licensedChoices({ organizationId: venue.ownerOrganizationId }),
  ]);
  const choices = [...owned, ...licensed].filter((entry, index, all) => all.findIndex((candidate) => id(candidate.physicalVocabularyRevisionId) === id(entry.physicalVocabularyRevisionId)) === index);
  return {
    required: true,
    venueId: venue._id,
    organizationId: venue.ownerOrganizationId,
    canCreate: permissions.has("physical_vocabulary.create"),
    recommendedMode: choices.length ? "existing" : "starter",
    choices,
  };
}

async function cleanupCreatedOnboarding({ venueId, physicalVocabulary, revision }) {
  const venue = await Venue.findById(venueId).lean().catch(() => null);
  if (venue?.workingReleaseId) {
    const release = await VenueRelease.findById(venue.workingReleaseId).lean().catch(() => null);
    const layout = release?.layoutRevisionId ? await LayoutRevision.findById(release.layoutRevisionId).lean().catch(() => null) : null;
    if (layout && id(layout.authoredAgainstPhysicalVocabularyRevisionId) === id(revision?._id)) {
      await Venue.updateOne({ _id: venueId, workingReleaseId: release._id }, { $set: { workingReleaseId: null } }).catch(() => {});
      await VenueRelease.deleteOne({ _id: release._id }).catch(() => {});
      await LayoutRevision.deleteOne({ _id: layout._id }).catch(() => {});
    }
  }
  if (physicalVocabulary?._id) {
    await PhysicalVocabularyRevision.deleteMany({ physicalVocabularyId: physicalVocabulary._id }).catch(() => {});
    await PhysicalVocabulary.deleteOne({ _id: physicalVocabulary._id }).catch(() => {});
  }
}

async function initializeVenuePhysicalConfiguration({ venueId, actorUserId, payload = {} }) {
  const { venue, authority } = await assertVenuePermission({ userId: actorUserId, venueId, permissionCode: "venue.physical.edit" });
  if (venue.workingReleaseId || venue.publishedReleaseId) return ensureWorkingVenueRelease({ venueId, actorUserId });
  const mode = String(payload.mode || "existing").trim().toLowerCase();
  if (mode === "existing") {
    if (!payload.physicalVocabularyRevisionId) throw new AppError("Seleziona un vocabolario fisico", 400, [{ field: "physicalVocabularyRevisionId", code: "REQUIRED" }]);
    return ensureWorkingVenueRelease({ venueId, physicalVocabularyRevisionId: payload.physicalVocabularyRevisionId, actorUserId });
  }
  if (!["starter", "blank"].includes(mode)) throw new AppError("Modalita onboarding non valida", 400, [{ field: "mode", code: "INVALID_ENUM", allowedValues: ["existing", "starter", "blank"] }]);
  if (!(authority.effectivePermissions || []).includes("physical_vocabulary.create")) {
    throw new AppError("Non puoi creare un vocabolario fisico per questa organizzazione", 403, [{ code: "PHYSICAL_VOCABULARY_CREATE_REQUIRED" }]);
  }

  let created = null;
  try {
    created = await createPhysicalVocabulary({
      actorUserId,
      payload: {
        ownerType: "organization",
        ownerId: venue.ownerOrganizationId,
        name: String(payload.name || `${venue.name} · Vocabolario fisico`).trim(),
        description: String(payload.description || `Vocabolario fisico creato durante la configurazione iniziale di ${venue.name}.`).trim(),
        applyStarter: mode === "starter",
      },
    });
    const configured = await ensureWorkingVenueRelease({ venueId, physicalVocabularyRevisionId: created.revision._id, actorUserId });
    return {
      ...configured,
      onboarding: {
        mode,
        createdPhysicalVocabularyId: created.physicalVocabulary._id,
        createdPhysicalVocabularyRevisionId: created.revision._id,
      },
    };
  } catch (error) {
    if (created) await cleanupCreatedOnboarding({ venueId, ...created });
    throw error;
  }
}

module.exports = {
  getVenuePhysicalOnboarding,
  initializeVenuePhysicalConfiguration,
};
