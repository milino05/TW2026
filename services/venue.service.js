const mongoose = require("mongoose");
const Venue = require("../models/venue.model");
const Organization = require("../models/organization.model");
const EditorialContext = require("../models/editorialContext.model");
const AppError = require("../utils/AppError");
const { assertOrganizationRole } = require("./organizationAuthorization.service");
const { assertVenueRole, findVenueOrFail } = require("./venueAuthorization.service");
const { normalizeVenuePayload, validateVenuePayload } = require("./validation/venue.validation");

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

async function assertEditorialContextExists(editorialContextId) {
  if (!editorialContextId) return;
  const exists = await EditorialContext.exists({ _id: editorialContextId, lifecycleStatus: "active" });
  if (!exists) throw new AppError("EditorialContext primario non disponibile", 404);
}

async function createVenue({ payload, actorUserId }) {
  const normalized = validatedVenuePayload(payload, { creating: true });
  const organization = await Organization.findOne({ _id: normalized.ownerOrganizationId, lifecycleStatus: "active" }).lean();
  if (!organization) throw new AppError("Organization non trovata", 404);
  await assertOrganizationRole({ userId: actorUserId, organizationId: organization._id, minimumRole: "operator" });
  await assertEditorialContextExists(normalized.primaryEditorialContextId);
  const venue = await Venue.create({
    name: normalized.name,
    description: normalized.description || "",
    ownerOrganizationId: organization._id,
    primaryEditorialContextId: normalized.primaryEditorialContextId || null,
    createdBy: actorUserId,
  });
  return projectVenue(venue, { includeWorking: true });
}

async function updateVenue({ venueId, payload, actorUserId }) {
  const { venue } = await assertVenueRole({ userId: actorUserId, venueId, minimumRole: "operator" });
  const normalized = validatedVenuePayload(payload, { creating: false });
  if (Object.prototype.hasOwnProperty.call(normalized, "primaryEditorialContextId")) await assertEditorialContextExists(normalized.primaryEditorialContextId);
  if (Object.prototype.hasOwnProperty.call(normalized, "name")) venue.name = normalized.name;
  if (Object.prototype.hasOwnProperty.call(normalized, "description")) venue.description = normalized.description || "";
  if (Object.prototype.hasOwnProperty.call(normalized, "primaryEditorialContextId")) venue.primaryEditorialContextId = normalized.primaryEditorialContextId || null;
  await venue.save();
  return projectVenue(venue, { includeWorking: true });
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
