const mongoose = require("mongoose");
const Venue = require("../models/venue.model");
const VenueTarget = require("../models/venueTarget.model");
const VenueRelease = require("../models/venueRelease.model");
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
  const ensured = await ensureVenueEntity({ venueId, payload, actorUserId });
  return ensured.target;
}

async function ensureVenueEntity({ venueId, payload, actorUserId, session = null, skipAuthorization = false }) {
  if (!skipAuthorization) await assertVenuePermission({ userId: actorUserId, venueId, permissionCode: "venue.inventory.manage" });
  const normalized = validatedTargetPayload(payload, { creating: true });
  let subjectQuery = Subject.exists({ _id: normalized.subjectId });
  if (session) subjectQuery = subjectQuery.session(session);
  const subject = await subjectQuery;
  if (!subject) throw new AppError("Subject non trovato", 404);
  const payloadToCreate = {
    venueId,
    subjectId: normalized.subjectId,
    displayLabelOverride: normalized.displayLabelOverride || null,
    inventoryNote: normalized.inventoryNote || null,
    provenance: normalized.provenance || { origin: "human" },
    createdBy: actorUserId,
  };
  const result = await VenueTarget.findOneAndUpdate(
    { venueId, subjectId: normalized.subjectId, lifecycleStatus: "active" },
    { $setOnInsert: payloadToCreate },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
      includeResultMetadata: true,
      ...(session ? { session } : {}),
    },
  );
  if (!result?.value) throw new AppError("Entità della sede non disponibile", 409, [{ code: "VENUE_ENTITY_ENSURE_FAILED" }]);
  return { target: result.value, created: Boolean(result.lastErrorObject?.upserted) };
}

async function updateVenueTarget({ venueId, venueTargetId, payload, actorUserId }) {
  await assertVenuePermission({ userId: actorUserId, venueId, permissionCode: "venue.inventory.manage" });
  const target = await findVenueTargetOrFail({ venueId, venueTargetId });
  const normalized = validatedTargetPayload(payload, { creating: false });
  if (Object.prototype.hasOwnProperty.call(normalized, "displayLabelOverride")) target.displayLabelOverride = normalized.displayLabelOverride;
  if (Object.prototype.hasOwnProperty.call(normalized, "inventoryNote")) target.inventoryNote = normalized.inventoryNote;
  if (Object.prototype.hasOwnProperty.call(normalized, "provenance")) target.provenance = normalized.provenance;
  await target.save();
  return target;
}

async function listVenueTargets({ venueId, view = "published", actorUserId = null } = {}) {
  const venue = await findVenueOrFail({ venueId });
  if (view === "all") {
    await assertVenuePermission({ userId: actorUserId, venueId, permissionCode: "venue.view" });
    return VenueTarget.find({ venueId, lifecycleStatus: "active" }).sort({ displayLabelOverride: 1, createdAt: 1 }).lean();
  }
  if (view !== "published") throw new AppError("view deve essere published o all", 400);
  if (!venue.publishedReleaseId) return [];
  const release = await VenueRelease.findById(venue.publishedReleaseId).select("targetBindings").lean();
  if (!release) return [];
  const activeIds = (release.targetBindings || []).filter((binding) => binding.availability === "active" && binding.exhibitSlotId).map((binding) => binding.venueTargetId);
  const targets = await VenueTarget.find({ _id: { $in: activeIds }, venueId }).lean();
  const byId = new Map(targets.map((target) => [String(target._id), target]));
  return activeIds.map((targetId) => byId.get(String(targetId))).filter(Boolean);
}

async function releaseReferencesTarget({ releaseId, venueId, venueTargetId, session }) {
  if (!releaseId) return { binding: false };
  const release = await VenueRelease.findOne({ _id: releaseId, venueId }).select("targetBindings").session(session);
  if (!release) return { binding: false };
  const binding = (release.targetBindings || []).some((entry) => id(entry.venueTargetId) === id(venueTargetId));
  return { binding };
}

async function publishedVisitReferenceCounts({ venueTargetIds = [], session = null }) {
  const targetIds = [...new Map((venueTargetIds || []).map((value) => [id(value), value]).filter(([key]) => key)).values()];
  const counts = new Map(targetIds.map((value) => [id(value), { count: 0, visitIds: [] }]));
  if (!targetIds.length) return counts;

  let revisionQuery = VisitRevisionV2.find({
    status: "published",
    "visitAnchors.venueTargetId": { $in: targetIds },
  }).select("_id visitId visitAnchors");
  if (session) revisionQuery = revisionQuery.session(session);
  const revisions = await revisionQuery.lean();
  if (!revisions.length) return counts;

  const revisionIds = revisions.map((entry) => entry._id);
  const candidateVisitIds = revisions.map((entry) => entry.visitId);
  let visitQuery = VisitV2.find({
    _id: { $in: candidateVisitIds },
    publishedRevisionId: { $in: revisionIds },
    lifecycleStatus: "active",
  }).select("_id publishedRevisionId");
  if (session) visitQuery = visitQuery.session(session);
  const visits = await visitQuery.lean();
  const currentRevisionToVisit = new Map(visits.map((entry) => [id(entry.publishedRevisionId), entry._id]));

  for (const revision of revisions) {
    const visitId = currentRevisionToVisit.get(id(revision._id));
    if (!visitId) continue;
    const referenced = new Set((revision.visitAnchors || []).map((anchor) => id(anchor.venueTargetId)).filter((targetId) => counts.has(targetId)));
    for (const targetId of referenced) {
      const entry = counts.get(targetId);
      entry.count += 1;
      entry.visitIds.push(visitId);
    }
  }
  return counts;
}

async function publishedVisitReferencesTarget({ venueTargetId, session = null }) {
  const counts = await publishedVisitReferenceCounts({ venueTargetIds: [venueTargetId], session });
  return counts.get(id(venueTargetId)) || { count: 0, visitIds: [] };
}

async function trashVenueTarget({ venueId, venueTargetId, actorUserId }) {
  await assertVenuePermission({ userId: actorUserId, venueId, permissionCode: "venue.inventory.manage" });
  let trashedTarget = null;
  try {
    await mongoose.connection.transaction(async (session) => {
      const currentVenue = await Venue.findOne({ _id: venueId, lifecycleStatus: "active" })
        .select("_id workingReleaseId publishedReleaseId")
        .session(session);
      if (!currentVenue) throw new AppError("Venue non disponibile", 404);
      const target = await VenueTarget.findOne({
        _id: venueTargetId,
        venueId,
        lifecycleStatus: "active",
      }).session(session);
      if (!target) throw new AppError("VenueTarget non trovato", 404);

      const workingReferences = await releaseReferencesTarget({
        releaseId: currentVenue.workingReleaseId,
        venueId,
        venueTargetId: target._id,
        session,
      });
      if (workingReferences.binding) {
        throw new AppError("Rimuovi prima l’entità dalla configurazione fisica di lavoro", 409, [{
          code: "TARGET_IN_WORKING_RELEASE",
          field: "venueTargetId",
        }]);
      }

      const publishedReferences = await releaseReferencesTarget({
        releaseId: currentVenue.publishedReleaseId,
        venueId,
        venueTargetId: target._id,
        session,
      });
      if (publishedReferences.binding) {
        throw new AppError("L’entità appartiene ancora alla configurazione pubblicata. Pubblica prima una nuova release che non la includa", 409, [{
          code: "TARGET_IN_PUBLISHED_RELEASE",
          field: "venueTargetId",
        }]);
      }

      const visitReferences = await publishedVisitReferencesTarget({ venueTargetId: target._id, session });
      if (visitReferences.count) {
        throw new AppError("L’entità è ancora usata da una visita pubblicata. Aggiorna prima la visita", 409, [{
          code: "TARGET_IN_PUBLISHED_VISIT",
          field: "venueTargetId",
          context: { publishedVisitCount: visitReferences.count, visitIds: visitReferences.visitIds },
        }]);
      }

      target.lifecycleStatus = "trashed";
      target.trashedAt = new Date();
      target.trashedBy = actorUserId;
      await target.save({ session });
      trashedTarget = target;
    });
    return trashedTarget;
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
  ensureVenueEntity,
  updateVenueTarget,
  listVenueTargets,
  releaseReferencesTarget,
  publishedVisitReferenceCounts,
  publishedVisitReferencesTarget,
  trashVenueTarget,
};