const Visit = require("../models/visit");
const AppError = require("../utils/AppError");
const { computeVisitIntegrity } = require("./validation/visitIntegrity.validation");
const {
  getActiveUserOrFail,
  assertMuseumRole,
} = require("./museumAuthorization.service");

function sameId(a, b) {
  return String(a) === String(b);
}

async function assertCommunityAuthor({ visit, actorUserId }) {
  await getActiveUserOrFail(actorUserId);

  if (!sameId(visit.createdBy, actorUserId)) {
    throw new AppError("Solo l'autore puo gestire questa visita community", 403);
  }
}

async function assertCanViewVisit({ visit, actorUserId }) {
  if (!actorUserId) throw new AppError("Autenticazione richiesta", 401);

  if (visit.kind === "community") {
    return assertCommunityAuthor({ visit, actorUserId });
  }

  return assertMuseumRole({
    userId: actorUserId,
    museumId: visit.ownerMuseumId,
    minimumRole: "operator",
  });
}

/**
 * Policy conservativa: modifica, controllo e pubblicazione di una visita
 * ufficiale richiedono un manager finche i privilegi editoriali
 * dell'operatore non vengono chiariti.
 */
async function assertCanManageVisit({ visit, actorUserId }) {
  if (!actorUserId) throw new AppError("Autenticazione richiesta", 401);

  if (visit.kind === "community") {
    return assertCommunityAuthor({ visit, actorUserId });
  }

  return assertMuseumRole({
    userId: actorUserId,
    museumId: visit.ownerMuseumId,
    minimumRole: "manager",
  });
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
    throw new AppError(
      "Impossibile pubblicare una visita con problemi di integrita",
      400,
      result.issues,
    );
  }

  visit.museumIds = result.museumIds;
  visit.status = "published";
  visit.publishedAt = new Date();
  visit.integrity = { status: "valid", issues: [] };

  await visit.save();
  return visit;
}

module.exports = {
  assertCanViewVisit,
  assertCanManageVisit,
  checkVisitConsistency,
  publishVisit,
};
