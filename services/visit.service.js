const mongoose = require("mongoose");
const Visit = require("../models/visit");
const AppError = require("../utils/AppError");
const { hasOwn } = require("./validation/validation.utils");
const {
  normalizeVisitPayload,
  validateVisitDraftPayload,
} = require("./validation/visit.validation");
const {
  assertCanViewVisit,
  assertCanManageVisit,
} = require("./visitIntegrity.service");
const {
  getActiveUserOrFail,
  assertMuseumRole,
} = require("./museumAuthorization.service");

async function createVisit({ payload, actorUserId }) {
  await getActiveUserOrFail(actorUserId);
  const normalizedPayload = normalizeVisitPayload(payload);
  const validation = await validateVisitDraftPayload({
    rawPayload: payload,
    payload: normalizedPayload,
    mode: "create",
  });

  if (validation.errors.length > 0) {
    throw new AppError("Payload non valido", 400, validation.errors);
  }

  if (normalizedPayload.kind === "official") {
    await assertMuseumRole({
      userId: actorUserId,
      museumId: normalizedPayload.ownerMuseumId,
      minimumRole: "operator",
    });
  }

  const visit = new Visit({
    ...normalizedPayload,
    ownerMuseumId:
      normalizedPayload.kind === "official" ? normalizedPayload.ownerMuseumId : null,
    defaultPresentationPolicy:
      normalizedPayload.kind === "official"
        ? normalizedPayload.defaultPresentationPolicy
        : null,
    createdBy: actorUserId,
    museumIds: validation.museumIds,
    status: "draft",
    publishedAt: null,
    integrity: { status: "needs_review", issues: [] },
  });

  await visit.save();
  return visit;
}

async function getVisitOrFail(visitId) {
  const visit = await Visit.findById(visitId);
  if (!visit) throw new AppError("Visita non trovata", 404);
  return visit;
}

async function updateVisit({ visitId, payload, actorUserId }) {
  const visit = await getVisitOrFail(visitId);
  await assertCanManageVisit({ visit, actorUserId });

  const normalizedPayload = normalizeVisitPayload(payload);
  const validation = await validateVisitDraftPayload({
    rawPayload: payload,
    payload: normalizedPayload,
    mode: "update",
    existingVisit: visit.toObject(),
  });

  if (validation.errors.length > 0) {
    throw new AppError("Payload non valido", 400, validation.errors);
  }

  ["title", "description", "defaultPresentationPolicy", "stops"].forEach((field) => {
    if (hasOwn(normalizedPayload, field)) visit.set(field, normalizedPayload[field]);
  });

  if (hasOwn(normalizedPayload, "stops")) {
    visit.museumIds = validation.museumIds;
  }

  visit.status = "draft";
  visit.publishedAt = null;
  visit.integrity = { status: "needs_review", issues: [] };

  await visit.save();
  return visit;
}

function validateOptionalObjectId(value, field) {
  if (value && !mongoose.isValidObjectId(value)) {
    throw new AppError("Filtro non valido", 400, [
      { field, code: "INVALID_OBJECT_ID", message: `${field} non e un ObjectId valido` },
    ]);
  }
}

async function listPublishedVisits(filters = {}) {
  validateOptionalObjectId(filters.ownerMuseumId, "ownerMuseumId");
  validateOptionalObjectId(filters.includedMuseumId, "includedMuseumId");

  const query = { status: "published" };

  if (["official", "community"].includes(filters.kind)) query.kind = filters.kind;
  if (filters.ownerMuseumId) query.ownerMuseumId = filters.ownerMuseumId;
  if (filters.includedMuseumId) query.museumIds = filters.includedMuseumId;

  return Visit.find(query).sort({ publishedAt: -1, title: 1 });
}

async function listManageableVisits(actorUserId) {
  const actor = await getActiveUserOrFail(actorUserId);
  const museumIds = (actor.memberships || [])
    .filter((membership) => ["operator", "manager"].includes(membership.role))
    .map((membership) => membership.museumId);

  return Visit.find({
    $or: [
      { kind: "community", createdBy: actorUserId },
      { kind: "official", ownerMuseumId: { $in: museumIds } },
    ],
  }).sort({ updatedAt: -1, title: 1 });
}

async function getVisit({ visitId, actorUserId = null }) {
  const visit = await getVisitOrFail(visitId);
  if (visit.status === "published") return visit;

  await assertCanViewVisit({ visit, actorUserId });
  return visit;
}

module.exports = {
  createVisit,
  updateVisit,
  listPublishedVisits,
  listManageableVisits,
  getVisit,
  getVisitOrFail,
};
