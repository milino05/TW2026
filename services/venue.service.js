const mongoose = require("mongoose");
const Venue = require("../models/venue.model");
const VenueTarget = require("../models/venueTarget.model");
const VisitV2 = require("../models/visitV2.model");
const VisitRevisionV2 = require("../models/visitRevisionV2.model");
const Organization = require("../models/organization.model");
const AppError = require("../utils/AppError");
const { assertOrganizationPermission } = require("./organizationAuthorization.service");
const { assertVenuePermission, findVenueOrFail } = require("./venueAuthorization.service");
const { assertCanUseEditorialContextAsVenuePrimary } = require("./editorialContextUsageAuthorization.service");
const { recordAdoptionFromAccess } = require("./marketplaceAdoptionV2.service");
const { normalizeVenuePayload, validateVenuePayload } = require("./validation/venue.validation");

function sameId(a, b) { return String(a || "") === String(b || ""); }

function projectVenue(venue, { includeWorking = false } = {}) {
  const source = venue?.toObject ? venue.toObject() : venue || {};
  const projected = {
    id: source._id,
    name: source.name,
    description: source.description || "",
    ownerOrganizationId: source.ownerOrganizationId,
    primaryEditorialContextId: source.primaryEditorialContextId || null,
    publishedReleaseId: source.publishedReleaseId || null,
    lifecycleStatus: source.lifecycleStatus,
  };
  if (includeWorking) projected.workingReleaseId = source.workingReleaseId || null;
  return projected;
}

function validatedVenuePayload(rawPayload, { creating }) {
  const normalized = normalizeVenuePayload(rawPayload || {});
  const issues = validateVenuePayload({ payload: normalized, rawPayload: rawPayload || {}, creating });
  if (issues.length) throw new AppError("Payload Venue non valido", 400, issues);
  return normalized;
}

async function recordPrimaryContextAdoption({ usage, venue, actorUserId }) {
  if (!usage?.editorialContext || !usage?.access) return null;
  return recordAdoptionFromAccess({
    access: usage.access,
    actorUserId,
    action: "context_venue_primary",
    sourceResourceRef: { resourceType: "editorial_context", resourceId: usage.editorialContext._id },
    sourceSnapshotRef: usage.access.resolvedSnapshotRef,
    resultResourceRef: { resourceType: "venue", resourceId: venue._id },
  });
}

async function createVenue({ payload, actorUserId }) {
  const normalized = validatedVenuePayload(payload, { creating: true });
  const organization = await Organization.findOne({ _id: normalized.ownerOrganizationId, lifecycleStatus: "active" }).lean();
  if (!organization) throw new AppError("Organization non trovata", 404);
  await assertOrganizationPermission({ userId: actorUserId, organizationId: organization._id, permissionCode: "venue.create" });
  const primaryUsage = await assertCanUseEditorialContextAsVenuePrimary({
    editorialContextId: normalized.primaryEditorialContextId,
    actorUserId,
    principalType: "organization",
    principalId: organization._id,
  });
  const venue = await Venue.create({
    name: normalized.name,
    description: normalized.description || "",
    ownerOrganizationId: organization._id,
    primaryEditorialContextId: normalized.primaryEditorialContextId || null,
    createdBy: actorUserId,
  });
  try {
    await recordPrimaryContextAdoption({ usage: primaryUsage, venue, actorUserId });
    return projectVenue(venue, { includeWorking: true });
  } catch (error) {
    await venue.deleteOne().catch(() => {});
    throw error;
  }
}

async function updateVenue({ venueId, payload, actorUserId }) {
  const { venue } = await assertVenuePermission({ userId: actorUserId, venueId, permissionCode: "venue.profile.manage" });
  const normalized = validatedVenuePayload(payload, { creating: false });
  const previousPrimaryId = venue.primaryEditorialContextId || null;
  const changesPrimary = Object.prototype.hasOwnProperty.call(normalized, "primaryEditorialContextId")
    && !sameId(previousPrimaryId, normalized.primaryEditorialContextId || null);
  if (changesPrimary) {
    await assertOrganizationPermission({ userId: actorUserId, organizationId: venue.ownerOrganizationId, permissionCode: "venue.primary_context.manage" });
  }
  const primaryUsage = changesPrimary
    ? await assertCanUseEditorialContextAsVenuePrimary({
        editorialContextId: normalized.primaryEditorialContextId,
        actorUserId,
        principalType: "organization",
        principalId: venue.ownerOrganizationId,
      })
    : null;

  let adoption = null;
  if (changesPrimary && normalized.primaryEditorialContextId) {
    adoption = await recordPrimaryContextAdoption({ usage: primaryUsage, venue, actorUserId });
  }
  try {
    if (Object.prototype.hasOwnProperty.call(normalized, "name")) venue.name = normalized.name;
    if (Object.prototype.hasOwnProperty.call(normalized, "description")) venue.description = normalized.description || "";
    if (Object.prototype.hasOwnProperty.call(normalized, "primaryEditorialContextId")) venue.primaryEditorialContextId = normalized.primaryEditorialContextId || null;
    await venue.save();
    return projectVenue(venue, { includeWorking: true });
  } catch (error) {
    if (adoption) await adoption.deleteOne().catch(() => {});
    throw error;
  }
}

async function listVenues({ ownerOrganizationId = null } = {}) {
  if (ownerOrganizationId && !mongoose.isValidObjectId(ownerOrganizationId)) throw new AppError("ownerOrganizationId non valido", 400);
  const query = { lifecycleStatus: "active" };
  if (ownerOrganizationId) query.ownerOrganizationId = ownerOrganizationId;
  const venues = await Venue.find(query).sort({ name: 1, createdAt: 1 }).lean();
  return venues.map((venue) => projectVenue(venue));
}

async function getVenue({ venueId }) {
  const venue = await findVenueOrFail({ venueId });
  return projectVenue(venue);
}

async function getVenueLifecycleImpact({ venueId, session = null }) {
  let targetQuery = VenueTarget.find({ venueId }).select("_id");
  if (session) targetQuery = targetQuery.session(session);
  const targets = await targetQuery.lean();
  const targetIds = targets.map((entry) => entry._id);
  if (!targetIds.length) return { venueTargetCount: 0, publishedVisitCount: 0 };

  let revisionQuery = VisitRevisionV2.find({
    status: "published",
    "visitAnchors.venueTargetId": { $in: targetIds },
  }).select("_id visitId");
  if (session) revisionQuery = revisionQuery.session(session);
  const revisions = await revisionQuery.lean();
  if (!revisions.length) return { venueTargetCount: targetIds.length, publishedVisitCount: 0 };

  const revisionIds = revisions.map((entry) => entry._id);
  const visitIds = revisions.map((entry) => entry.visitId);
  let visitQuery = VisitV2.find({
    _id: { $in: visitIds },
    publishedRevisionId: { $in: revisionIds },
    lifecycleStatus: "active",
  }).select("_id");
  if (session) visitQuery = visitQuery.session(session);
  const visits = await visitQuery.lean();
  return { venueTargetCount: targetIds.length, publishedVisitCount: visits.length };
}

async function trashVenue({ venueId, actorUserId }) {
  const { venue } = await assertVenuePermission({ userId: actorUserId, venueId, permissionCode: "venue.lifecycle.manage" });
  const session = await mongoose.startSession();
  let result = null;
  try {
    await session.withTransaction(async () => {
      const current = await Venue.findOne({ _id: venue._id, lifecycleStatus: "active" }).session(session);
      if (!current) throw new AppError("Venue non disponibile", 404);
      const impact = await getVenueLifecycleImpact({ venueId: current._id, session });
      const now = new Date();
      current.lifecycleStatus = "trashed";
      current.trashedAt = now;
      current.trashedBy = actorUserId;
      await current.save({ session });
      result = {
        venue: projectVenue(current, { includeWorking: true }),
        removedAt: now,
        impact,
      };
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function restoreVenue({ venueId, actorUserId }) {
  const venue = await Venue.findById(venueId);
  if (!venue) throw new AppError("Venue non disponibile", 404);
  await assertOrganizationPermission({
    userId: actorUserId,
    organizationId: venue.ownerOrganizationId,
    permissionCode: "venue.lifecycle.manage",
  });
  if (venue.lifecycleStatus !== "trashed") throw new AppError("La Venue non e nel cestino", 409);
  const organization = await Organization.findOne({ _id: venue.ownerOrganizationId, lifecycleStatus: "active" }).lean();
  if (!organization) throw new AppError("L'Organization proprietaria non e attiva", 409, [{ code: "VENUE_OWNER_ORGANIZATION_NOT_ACTIVE" }]);
  venue.lifecycleStatus = "active";
  venue.trashedAt = null;
  venue.trashedBy = null;
  await venue.save();
  return { venue: projectVenue(venue, { includeWorking: true }) };
}

module.exports = {
  projectVenue,
  createVenue,
  updateVenue,
  listVenues,
  getVenue,
  getVenueLifecycleImpact,
  trashVenue,
  restoreVenue,
};
