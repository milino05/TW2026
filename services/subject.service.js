const Subject = require("../models/subject.model");
const AppError = require("../utils/AppError");
const { getActiveUserOrFail } = require("./userAuthorization.service");
const { normalizeSubjectPayload, validateSubjectPayload } = require("./validation/subject.validation");

function normalizedExternalIdentity(scheme, id) {
  const normalizedScheme = String(scheme || "").trim().toLowerCase();
  const normalizedId = String(id || "").trim();
  return normalizedScheme && normalizedId ? { scheme: normalizedScheme, id: normalizedId } : null;
}

async function findSubjectByExternalIdentity({ scheme, id }) {
  const identity = normalizedExternalIdentity(scheme, id);
  if (!identity) return null;
  return Subject.findOne({
    externalIdentities: { $elemMatch: identity },
  });
}

async function createSubject({ payload, actorUserId }) {
  const actor = await getActiveUserOrFail(actorUserId);
  const rawPayload = payload || {};
  const normalized = normalizeSubjectPayload(rawPayload);
  const issues = validateSubjectPayload({ payload: normalized, rawPayload, mode: "create" });
  if (issues.length) throw new AppError("Payload non valido", 400, issues);

  return Subject.create({ ...normalized, createdBy: actor._id });
}

async function getSubjectById({ subjectId }) {
  const subject = await Subject.findById(subjectId);
  if (!subject) throw new AppError("Subject non trovato", 404);
  return subject;
}

async function listSubjects({ search = "", limit = 50, externalScheme = null, externalId = null } = {}) {
  const numericLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  if (externalScheme || externalId) {
    if (!externalScheme || !externalId) {
      throw new AppError("externalScheme ed externalId devono essere specificati insieme", 400, [{ code: "INVALID_EXTERNAL_IDENTITY_QUERY" }]);
    }
    const exact = await findSubjectByExternalIdentity({ scheme: externalScheme, id: externalId });
    return exact ? [exact] : [];
  }
  const query = {};
  if (typeof search === "string" && search.trim()) query.$text = { $search: search.trim() };
  return Subject.find(query).sort({ preferredLabel: 1 }).limit(numericLimit);
}

module.exports = {
  createSubject,
  getSubjectById,
  listSubjects,
  findSubjectByExternalIdentity,
  normalizedExternalIdentity,
};
