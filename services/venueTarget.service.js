const VenueTarget = require("../models/venueTarget.model");
const VenueRelease = require("../models/venueRelease.model");
const Subject = require("../models/subject.model");
const AppError = require("../utils/AppError");
const { assertVenueRole, findVenueOrFail } = require("./venueAuthorization.service");
const { normalizeVenueTargetPayload, validateVenueTargetPayload } = require("./validation/venue.validation");

function validatedTargetPayload(rawPayload, { creating }) {
  const normalized = normalizeVenueTargetPayload(rawPayload || {});
  const issues = validateVenueTargetPayload({ payload: normalized, rawPayload: rawPayload || {}, creating });
  if (issues.length) throw new AppError("Payload VenueTarget non valido", 400, issues);
  return normalized;
}

async function findVenueTargetOrFail({ venueId, venueTargetId, includeTrashed = false }) {
  const query = { _id: venueTargetId, venueId };
  if (!includeTrashed) query.lifecycleStatus = "active";
  const target = await VenueTarget.findOne(query);
  if (!target) throw new AppError("VenueTarget non trovato", 404);
  return target;
}

async function createVenueTarget({ venueId, payload, actorUserId }) {
  await assertVenueRole({ userId: actorUserId, venueId, minimumRole: "operator" });
  const normalized = validatedTargetPayload(payload, { creating: true });
  const subject = await Subject.exists({ _id: normalized.subjectId });
  if (!subject) throw new AppError("Subject non trovato", 404);
  return VenueTarget.create({
    venueId,
    subjectId: normalized.subjectId,
    label: normalized.label,
    description: normalized.description || "",
    createdBy: actorUserId,
  });
}

async function updateVenueTarget({ venueId, venueTargetId, payload, actorUserId }) {
  await assertVenueRole({ userId: actorUserId, venueId, minimumRole: "operator" });
  const target = await findVenueTargetOrFail({ venueId, venueTargetId });
  const normalized = validatedTargetPayload(payload, { creating: false });
  if (Object.prototype.hasOwnProperty.call(normalized, "label")) target.label = normalized.label;
  if (Object.prototype.hasOwnProperty.call(normalized, "description")) target.description = normalized.description || "";
  await target.save();
  return target;
}

async function listVenueTargets({ venueId, includeTrashed = false } = {}) {
  await findVenueOrFail({ venueId });
  const query = { venueId };
  if (!includeTrashed) query.lifecycleStatus = "active";
  return VenueTarget.find(query).sort({ label: 1, createdAt: 1 }).lean();
}

async function trashVenueTarget({ venueId, venueTargetId, actorUserId }) {
  const { venue } = await assertVenueRole({ userId: actorUserId, venueId, minimumRole: "manager" });
  const target = await findVenueTargetOrFail({ venueId, venueTargetId });
  if (venue.publishedReleaseId) {
    const release = await VenueRelease.findById(venue.publishedReleaseId).select("targetBindings").lean();
    const activeBinding = (release?.targetBindings || []).find((binding) => String(binding.venueTargetId) === String(target._id) && binding.availability === "active");
    if (activeBinding) throw new AppError("Il VenueTarget e ancora attivo nella VenueRelease pubblicata", 409, [{ code: "TARGET_IN_PUBLISHED_RELEASE" }]);
  }
  target.lifecycleStatus = "trashed";
  target.trashedAt = new Date();
  target.trashedBy = actorUserId;
  await target.save();
  return target;
}

module.exports = { findVenueTargetOrFail, createVenueTarget, updateVenueTarget, listVenueTargets, trashVenueTarget };
