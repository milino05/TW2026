const PhysicalVocabulary = require("../models/physicalVocabulary.model");
const PhysicalVocabularyRevision = require("../models/physicalVocabularyRevision.model");
const Venue = require("../models/venue.model");
const AppError = require("../utils/AppError");
const { assertOrganizationPermission } = require("./organizationAuthorization.service");
const { assertCanUsePhysicalVocabularyForAuthoring } = require("./physicalVocabularyUsageAuthorization.service");
const { effectiveRevisionId } = require("./versionedSchemaDependency.service");

function id(value) { return String(value?._id || value || ""); }

async function loadPhysicalVocabularyRevisionBundle(
  physicalVocabularyRevisionId,
  { requireStable = false, requireActiveVocabulary = false } = {},
) {
  const revision = await PhysicalVocabularyRevision.findById(physicalVocabularyRevisionId);
  if (!revision) throw new AppError("PhysicalVocabularyRevision non disponibile", 404, [{ code: "PHYSICAL_VOCABULARY_REVISION_NOT_FOUND" }]);
  const physicalVocabulary = await PhysicalVocabulary.findById(revision.physicalVocabularyId);
  if (!physicalVocabulary) throw new AppError("PhysicalVocabulary non disponibile", 409, [{ code: "PHYSICAL_VOCABULARY_NOT_AVAILABLE" }]);
  if (requireActiveVocabulary && physicalVocabulary.lifecycleStatus !== "active") {
    throw new AppError("PhysicalVocabulary non disponibile per nuovo authoring", 409, [{ code: "PHYSICAL_VOCABULARY_NOT_ACTIVE" }]);
  }
  if (requireStable && (!["published", "superseded"].includes(revision.status) || revision.integrity?.status !== "valid")) {
    throw new AppError("PhysicalVocabularyRevision non utilizzabile come snapshot stabile", 409, [{ code: "PHYSICAL_VOCABULARY_REVISION_NOT_STABLE" }]);
  }
  return { physicalVocabulary, revision };
}

async function assertCanAuthorLayoutAgainstRevision({ physicalVocabularyRevisionId, venue, actorUserId }) {
  const bundle = await loadPhysicalVocabularyRevisionBundle(physicalVocabularyRevisionId);
  if (bundle.physicalVocabulary.ownerType === "organization"
    && id(bundle.physicalVocabulary.ownerId) === id(venue.ownerOrganizationId)) {
    if (bundle.physicalVocabulary.lifecycleStatus !== "active") {
      throw new AppError("PhysicalVocabulary non disponibile per nuovo authoring", 409, [{ code: "PHYSICAL_VOCABULARY_NOT_ACTIVE" }]);
    }
    await assertOrganizationPermission({
      userId: actorUserId,
      organizationId: venue.ownerOrganizationId,
      permissionCode: "physical_vocabulary.view",
    });
    return { ...bundle, access: { basis: "principal_authority", resolvedSnapshotRef: { resourceType: "physical_vocabulary_revision", resourceId: bundle.revision._id } } };
  }

  const access = await assertCanUsePhysicalVocabularyForAuthoring({
    physicalVocabulary: bundle.physicalVocabulary,
    actorUserId,
    principalType: "organization",
    principalId: venue.ownerOrganizationId,
  });
  if (bundle.physicalVocabulary.lifecycleStatus !== "active" && access.basis !== "entitlement") {
    throw new AppError("PhysicalVocabulary non disponibile per nuovo authoring", 409, [{ code: "PHYSICAL_VOCABULARY_NOT_ACTIVE" }]);
  }
  if (access.resolvedSnapshotRef?.resourceType !== "physical_vocabulary_revision"
    || id(access.resolvedSnapshotRef.resourceId) !== id(bundle.revision._id)) {
    throw new AppError("La licenza non autorizza la revisione fisica selezionata", 403, [{ code: "PHYSICAL_VOCABULARY_REVISION_ACCESS_MISMATCH" }]);
  }
  if (!["published", "superseded"].includes(bundle.revision.status)) {
    throw new AppError("Una revisione esterna deve essere pubblicata prima dell'uso", 409, [{ code: "EXTERNAL_PHYSICAL_VOCABULARY_REVISION_NOT_PUBLISHED" }]);
  }
  return { ...bundle, access };
}

async function loadVenuePhysicalVocabulary(venue, options = {}) {
  if (!venue?.physicalVocabularyId) {
    throw new AppError("Venue senza PhysicalVocabulary lineage", 409, [{ code: "VENUE_PHYSICAL_VOCABULARY_REQUIRED" }]);
  }
  const physicalVocabulary = await PhysicalVocabulary.findById(venue.physicalVocabularyId);
  if (!physicalVocabulary) {
    throw new AppError("PhysicalVocabulary della Venue non disponibile", 409, [{ code: "PHYSICAL_VOCABULARY_NOT_AVAILABLE" }]);
  }
  const revisionId = effectiveRevisionId({
    binding: venue.physicalVocabularyDependency,
    publishedRevisionId: physicalVocabulary.publishedRevisionId,
  });
  const bundle = await loadPhysicalVocabularyRevisionBundle(revisionId, options);
  if (id(bundle.physicalVocabulary._id) !== id(venue.physicalVocabularyId)) {
    throw new AppError("La revisione fisica effettiva non appartiene al PhysicalVocabulary della Venue", 409, [{ code: "PHYSICAL_VOCABULARY_LINEAGE_MISMATCH" }]);
  }
  return bundle;
}

async function loadLayoutPhysicalVocabulary(layout, options = {}) {
  const { historical = false, ...bundleOptions } = options || {};
  if (!historical && layout?.venueId) {
    const venue = await Venue.findById(layout.venueId);
    if (venue?.physicalVocabularyId && venue.physicalVocabularyDependency) {
      return loadVenuePhysicalVocabulary(venue, bundleOptions);
    }
  }
  if (!layout?.authoredAgainstPhysicalVocabularyRevisionId) {
    throw new AppError("LayoutRevision senza PhysicalVocabularyRevision di authoring", 409, [{ code: "LAYOUT_PHYSICAL_VOCABULARY_REVISION_REQUIRED" }]);
  }
  return loadPhysicalVocabularyRevisionBundle(layout.authoredAgainstPhysicalVocabularyRevisionId, bundleOptions);
}

module.exports = {
  loadPhysicalVocabularyRevisionBundle,
  assertCanAuthorLayoutAgainstRevision,
  loadVenuePhysicalVocabulary,
  loadLayoutPhysicalVocabulary,
};
