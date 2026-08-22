const mongoose = require("mongoose");
const Venue = require("../models/venue.model");
const Organization = require("../models/organization.model");
const AppError = require("../utils/AppError");
const { assertOrganizationRole } = require("./organizationAuthorization.service");
const { assertVenueRole, findVenueOrFail } = require("./venueAuthorization.service");
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
  await assertOrganizationRole({ userId: actorUserId, organizationId: organization._id, minimumRole: "operator" });
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
  const { venue } = await assertVenueRole({ userId: actorUserId, venueId, minimumRole: "operator" });
  const normalized = validatedVenuePayload(payload, { creating: false });
  const previousPrimaryId = venue.primaryEditorialContextId || null;
  const changesPrimary = Object.prototype.hasOwnProperty.call(normalized, "primaryEditorialContextId")
    && !sameId(previousPrimaryId, normalized.primaryEditorialContextId || null);
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

module.exports = { projectVenue, createVenue, updateVenue, listVenues, getVenue };
