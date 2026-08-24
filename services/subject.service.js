const Subject = require("../models/subject.model");
const AppError = require("../utils/AppError");
const { getActiveUserOrFail } = require("./userAuthorization.service");
const { normalizeSubjectPayload, validateSubjectPayload } = require("./validation/subject.validation");

const SUBJECT_LABEL_COLLATION = Object.freeze({
  locale: "it",
  strength: 1,
  alternate: "shifted",
});

function normalizeSubjectLabel(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[\u2018\u2019\u02bc\uff07`\u00b4]/gu, "'")
    .toLocaleLowerCase("it")
    .replace(/\s+/gu, " ")
    .trim();
}

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

async function listSubjects({ search = "", limit = 50, match = "text", externalScheme = null, externalId = null } = {}) {
  const numericLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  if (externalScheme || externalId) {
    if (!externalScheme || !externalId) {
      throw new AppError("externalScheme ed externalId devono essere specificati insieme", 400, [{ code: "INVALID_EXTERNAL_IDENTITY_QUERY" }]);
    }
    const exact = await findSubjectByExternalIdentity({ scheme: externalScheme, id: externalId });
    return exact ? [exact] : [];
  }
  const normalizedMatch = String(match || "text").trim().toLowerCase();
  if (!["text", "label_exact"].includes(normalizedMatch)) {
    throw new AppError("Modalita di ricerca Subject non valida", 400, [{
      field: "match",
      code: "INVALID_ENUM",
      allowed: ["text", "label_exact"],
    }]);
  }
  const normalizedSearch = typeof search === "string" ? search.trim().replace(/\s+/gu, " ") : "";
  if (normalizedMatch === "label_exact") {
    if (!normalizedSearch) return [];
    const normalizedLabel = normalizeSubjectLabel(normalizedSearch);
    const candidates = await Subject.find({ preferredLabel: normalizedSearch })
      .collation(SUBJECT_LABEL_COLLATION)
      .sort({ preferredLabel: 1 })
      .limit(numericLimit);
    return candidates.filter((subject) => normalizeSubjectLabel(subject.preferredLabel) === normalizedLabel);
  }
  const query = {};
  if (normalizedSearch) query.$text = { $search: normalizedSearch };
  return Subject.find(query).sort({ preferredLabel: 1 }).limit(numericLimit);
}

module.exports = {
  createSubject,
  getSubjectById,
  listSubjects,
  findSubjectByExternalIdentity,
  normalizedExternalIdentity,
  normalizeSubjectLabel,
  SUBJECT_LABEL_COLLATION,
};
