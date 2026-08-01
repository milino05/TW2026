const Visit = require("../models/visit");
const User = require("../models/user");
const AppError = require("../utils/AppError");
const { hasOwn } = require("./validation/validation.utils");
const { normalizeVisitPayload, validateVisitDraftPayload } = require("./validation/visit.validation");
const { assertCanManageVisit } = require("./visitIntegrity.service");

function sameId(a, b) {
  return String(a) === String(b);
}

async function getActiveUserOrFail(userId) {
  const user = await User.findOne({ _id: userId, status: "active" }).lean();
  if (!user) throw new AppError("Utente non autorizzato", 403);
  return user;
}

function isMuseumOperator(user, museumId) {
  return (user.memberships || []).some(
    (membership) => sameId(membership.museumId, museumId) && membership.role === "operator",
  );
}

async function createVisit({ payload, actorUserId }) {
  const actor = await getActiveUserOrFail(actorUserId);
  const normalizedPayload = normalizeVisitPayload(payload);
  const validation = await validateVisitDraftPayload({
    payload: normalizedPayload,
    mode: "create",
  });

  if (validation.errors.length > 0) {
    throw new AppError("Payload non valido", 400, validation.errors);
  }

  if (normalizedPayload.kind === "official" && !isMuseumOperator(actor, normalizedPayload.ownerMuseumId)) {
    throw new AppError("E richiesto il ruolo di operatore del museo", 403);
  }

  const visit = new Visit({
    ...normalizedPayload,
    ownerMuseumId: normalizedPayload.kind === "official" ? normalizedPayload.ownerMuseumId : null,
    createdBy: actorUserId,
    museumIds: validation.museumIds,
    status: "draft",
    publishedAt: null,
    integrity: {
      status: "needs_review",
      issues: [],
    },
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
    payload: normalizedPayload,
    mode: "update",
    existingVisit: visit.toObject(),
  });

  if (validation.errors.length > 0) {
    throw new AppError("Payload non valido", 400, validation.errors);
  }

  ["title", "description", "defaultPresentationPolicy", "stops"].forEach((field) => {
    if (hasOwn(normalizedPayload, field)) {
      visit.set(field, normalizedPayload[field]);
    }
  });

  if (hasOwn(normalizedPayload, "stops")) {
    visit.museumIds = validation.museumIds;
  }

  visit.status = "draft";
  visit.publishedAt = null;
  visit.integrity = {
    status: "needs_review",
    issues: [],
  };

  await visit.save();
  return visit;
}

async function listPublishedVisits(filters = {}) {
  const query = { status: "published" };

  if (["official", "community"].includes(filters.kind)) query.kind = filters.kind;
  if (filters.ownerMuseumId) query.ownerMuseumId = filters.ownerMuseumId;
  if (filters.includedMuseumId) query.museumIds = filters.includedMuseumId;

  return Visit.find(query).sort({ publishedAt: -1, title: 1 });
}

async function listManageableVisits(actorUserId) {
  const actor = await getActiveUserOrFail(actorUserId);
  const operatorMuseumIds = (actor.memberships || [])
    .filter((membership) => membership.role === "operator")
    .map((membership) => membership.museumId);

  return Visit.find({
    $or: [
      { kind: "community", createdBy: actorUserId },
      { kind: "official", ownerMuseumId: { $in: operatorMuseumIds } },
    ],
  }).sort({ updatedAt: -1, title: 1 });
}

async function getVisit({ visitId, actorUserId = null }) {
  const visit = await getVisitOrFail(visitId);

  if (visit.status === "published") return visit;

  await assertCanManageVisit({ visit, actorUserId });
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
