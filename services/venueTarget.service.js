const mongoose = require("mongoose");
const VenueTarget = require("../models/venueTarget.model");
const VenueRelease = require("../models/venueRelease.model");
const LayoutRevision = require("../models/layoutRevision.model");
const VisitV2 = require("../models/visitV2.model");
const VisitRevisionV2 = require("../models/visitRevisionV2.model");
const Subject = require("../models/subject.model");
const AppError = require("../utils/AppError");
const { assertVenuePermission, findVenueOrFail } = require("./venueAuthorization.service");
const { normalizeVenueTargetPayload, validateVenueTargetPayload } = require("./validation/venue.validation");

function id(value) { return String(value?._id || value || ""); }
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
  await assertVenuePermission({ userId: actorUserId, venueId, permissionCode: "venue.physical.edit" });
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
  await assertVenuePermission({ userId: actorUserId, venueId, permissionCode: "venue.physical.edit" });
  const target = await findVenueTargetOrFail({ venueId, venueTargetId });
  const normalized = validatedTargetPayload(payload, { creating: false });
  if (Object.prototype.hasOwnProperty.call(normalized, "label")) target.label = normalized.label;
  if (Object.prototype.hasOwnProperty.call(normalized, "description")) target.description = normalized.description || "";
  await target.save();
  return target;
}

async function listVenueTargets({ venueId, view = "published", actorUserId = null } = {}) {
  const venue = await findVenueOrFail({ venueId });
  if (view === "all") {
    await assertVenuePermission({ userId: actorUserId, venueId, permissionCode: "venue.view" });
    return VenueTarget.find({ venueId, lifecycleStatus: "active" }).sort({ label: 1, createdAt: 1 }).lean();
  }
  if (view !== "published") throw new AppError("view deve essere published o all", 400);
  if (!venue.publishedReleaseId) return [];
  const release = await VenueRelease.findById(venue.publishedReleaseId).select("targetBindings").lean();
  if (!release) return [];
  const activeIds = (release.targetBindings || []).filter((binding) => binding.availability === "active").map((binding) => binding.venueTargetId);
  const targets = await VenueTarget.find({ _id: { $in: activeIds }, venueId }).lean();
  const byId = new Map(targets.map((target) => [String(target._id), target]));
  return activeIds.map((targetId) => byId.get(String(targetId))).filter(Boolean);
}

async function releaseReferencesTarget({ releaseId, venueId, venueTargetId, session }) {
  if (!releaseId) return { binding: false, placement: false };
  const release = await VenueRelease.findOne({ _id: releaseId, venueId }).select("targetBindings layoutRevisionId").session(session);
  if (!release) return { binding: false, placement: false };
  const binding = (release.targetBindings || []).some((entry) => id(entry.venueTargetId) === id(venueTargetId));
  const placement = release.layoutRevisionId
    ? Boolean(await LayoutRevision.exists({
      _id: release.layoutRevisionId,
      venueId,
      "venueTargetPlacements.venueTargetId": venueTargetId,
    }).session(session))
    : false;
  return { binding, placement };
}

async function publishedVisitReferencesTarget({ venueTargetId, session = null }) {
  let revisionQuery = VisitRevisionV2.find({
    status: "published",
    "visitAnchors.venueTargetId": venueTargetId,
  }).select("_id visitId");
  if (session) revisionQuery = revisionQuery.session(session);
  const revisions = await revisionQuery.lean();
  if (!revisions.length) return { count: 0, visitIds: [] };

  const revisionIds = revisions.map((entry) => entry._id);
  const candidateVisitIds = revisions.map((entry) => entry.visitId);
  let visitQuery = VisitV2.find({
    _id: { $in: candidateVisitIds },
    publishedRevisionId: { $in: revisionIds },
    lifecycleStatus: "active",
  }).select("_id");
  if (session) visitQuery = visitQuery.session(session);
  const visits = await visitQuery.lean();
  return { count: visits.length, visitIds: visits.map((entry) => entry._id) };
}

async function trashVenueTarget({ venueId, venueTargetId, actorUserId }) {
  const { venue } = await assertVenuePermission({ userId: actorUserId, venueId, permissionCode: "venue.lifecycle.manage" });
  try {
    return await mongoose.connection.transaction(async (session) => {
      const target = await VenueTarget.findOne({
        _id: venueTargetId,
        venueId,
        lifecycleStatus: "active",
      }).session(session);
      if (!target) throw new AppError("VenueTarget non trovato", 404);

      const workingReferences = await releaseReferencesTarget({
        releaseId: venue.workingReleaseId,
        venueId,
        venueTargetId: target._id,
        session,
      });
      if (workingReferences.binding || workingReferences.placement) {
        throw new AppError("Rimuovi prima l'oggetto dalla configurazione fisica di lavoro", 409, [{
          code: "TARGET_IN_WORKING_RELEASE",
          field: "venueTargetId",
        }]);
      }

      const publishedReferences = await releaseReferencesTarget({
        releaseId: venue.publishedReleaseId,
        venueId,
        venueTargetId: target._id,
        session,
      });
      if (publishedReferences.binding || publishedReferences.placement) {
        throw new AppError("L'oggetto appartiene ancora alla configurazione pubblicata. Pubblica prima una nuova release senza questo oggetto", 409, [{
          code: "TARGET_IN_PUBLISHED_RELEASE",
          field: "venueTargetId",
        }]);
      }

      const visitReferences = await publishedVisitReferencesTarget({ venueTargetId: target._id, session });
      if (visitReferences.count) {
        throw new AppError("L'oggetto è ancora usato da una visita pubblicata. Aggiorna prima la visita", 409, [{
          code: "TARGET_IN_PUBLISHED_VISIT",
          field: "venueTargetId",
          context: { publishedVisitCount: visitReferences.count, visitIds: visitReferences.visitIds },
        }]);
      }

      target.lifecycleStatus = "trashed";
      target.trashedAt = new Date();
      target.trashedBy = actorUserId;
      await target.save({ session });
      return target;
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Spostamento del VenueTarget nel cestino non completato", 500, [{
      code: "VENUE_TARGET_TRASH_FAILED",
      message: error.message,
    }]);
  }
}

module.exports = {
  findVenueTargetOrFail,
  createVenueTarget,
  updateVenueTarget,
  listVenueTargets,
  releaseReferencesTarget,
  publishedVisitReferencesTarget,
  trashVenueTarget,
};
