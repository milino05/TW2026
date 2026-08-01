const Visit = require("../models/visit");
const User = require("../models/user");
const AppError = require("../utils/AppError");
const { computeVisitIntegrity } = require("./validation/visitIntegrity.validation");

function sameId(a, b) {
  return String(a) === String(b);
}

async function assertCanManageVisit({ visit, actorUserId }) {
  if (!actorUserId) throw new AppError("Autenticazione richiesta", 401);

  const actor = await User.findOne({ _id: actorUserId, status: "active" })
    .select("status memberships")
    .lean();

  if (!actor) throw new AppError("Utente non autorizzato", 403);

  if (visit.kind === "community") {
    if (!sameId(visit.createdBy, actorUserId)) {
      throw new AppError("Solo l'autore puo gestire questa visita community", 403);
    }
    return;
  }

  const isOperator = (actor.memberships || []).some(
    (membership) => sameId(membership.museumId, visit.ownerMuseumId) && membership.role === "operator",
  );

  if (!isOperator) {
    throw new AppError("E richiesto il ruolo di operatore del museo", 403);
  }
}

async function getVisitOrFail(visitId) {
  const visit = await Visit.findById(visitId);
  if (!visit) throw new AppError("Visita non trovata", 404);
  return visit;
}

async function checkVisitConsistency({ visitId, actorUserId }) {
  const visit = await getVisitOrFail(visitId);
  await assertCanManageVisit({ visit, actorUserId });

  const result = await computeVisitIntegrity({ visit: visit.toObject() });
  const hasIssues = result.issues.length > 0;

  visit.museumIds = result.museumIds;
  visit.integrity = {
    status: hasIssues ? "needs_review" : "valid",
    issues: result.issues,
  };

  if (visit.status === "published" && hasIssues) {
    visit.status = "draft";
    visit.publishedAt = null;
  }

  await visit.save();

  return {
    visit,
    issues: result.issues,
    integrity: visit.integrity,
  };
}

async function publishVisit({ visitId, actorUserId }) {
  const visit = await getVisitOrFail(visitId);
  await assertCanManageVisit({ visit, actorUserId });

  const result = await computeVisitIntegrity({ visit: visit.toObject() });

  if (result.issues.length > 0) {
    visit.museumIds = result.museumIds;
    visit.integrity = { status: "needs_review", issues: result.issues };
    await visit.save();
    throw new AppError("Impossibile pubblicare una visita con problemi di integrita", 400, result.issues);
  }

  visit.museumIds = result.museumIds;
  visit.status = "published";
  visit.publishedAt = new Date();
  visit.integrity = { status: "valid", issues: [] };

  await visit.save();
  return visit;
}

module.exports = {
  assertCanManageVisit,
  checkVisitConsistency,
  publishVisit,
};
