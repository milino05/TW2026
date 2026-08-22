const Subject = require("../models/subject.model");
const AppError = require("../utils/AppError");
const { getActiveUserOrFail } = require("./userAuthorization.service");
const { normalizeSubjectPayload, validateSubjectPayload } = require("./validation/subject.validation");

function normalizedExternalRef(scheme, id) {
  const normalizedScheme = String(scheme || "").trim().toLowerCase();
  const normalizedId = String(id || "").trim();
  return normalizedScheme && normalizedId ? { scheme: normalizedScheme, id: normalizedId, matchType: "exact" } : null;
}

async function findSubjectByExactExternalRef({ scheme, id }) {
  const ref = normalizedExternalRef(scheme, id);
  if (!ref) return null;
  return Subject.findOne({
    externalRefs: { $elemMatch: ref },
  });
}

async function exactExternalRefCollision(externalRefs = []) {
  for (const ref of externalRefs) {
    if ((ref.matchType || "exact") !== "exact") continue;
    const exists = await findSubjectByExactExternalRef({ scheme: ref.scheme, id: ref.id });
    if (exists) return ref;
  }
  return null;
}

async function createSubject({ payload, actorUserId }) {
  const actor = await getActiveUserOrFail(actorUserId);
  const rawPayload = payload || {};
  const normalized = normalizeSubjectPayload(rawPayload);
  const issues = validateSubjectPayload({ payload: normalized, rawPayload, mode: "create" });
  if (issues.length) throw new AppError("Payload non valido", 400, issues);

  const collision = await exactExternalRefCollision(normalized.externalRefs || []);
  if (collision) {
    throw new AppError("Esiste gia un Subject con lo stesso external identity", 409, [{
      field: "externalRefs",
      code: "EXTERNAL_IDENTITY_ALREADY_BOUND",
      scheme: collision.scheme,
      id: collision.id,
    }]);
  }

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
    const exact = await findSubjectByExactExternalRef({ scheme: externalScheme, id: externalId });
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
  exactExternalRefCollision,
  findSubjectByExactExternalRef,
};
