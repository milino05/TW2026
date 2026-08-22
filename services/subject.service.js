const Subject = require("../models/subject.model");
const AppError = require("../utils/AppError");
const { getActiveUserOrFail } = require("./userAuthorization.service");
const { normalizeSubjectPayload, validateSubjectPayload } = require("./validation/subject.validation");

async function exactExternalRefCollision(externalRefs = []) {
  for (const ref of externalRefs) {
    if ((ref.matchType || "exact") !== "exact") continue;
    const exists = await Subject.exists({
      externalRefs: {
        $elemMatch: {
          scheme: ref.scheme,
          id: ref.id,
          matchType: "exact",
        },
      },
    });
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

async function listSubjects({ search = "", limit = 50 } = {}) {
  const numericLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const query = {};
  if (typeof search === "string" && search.trim()) query.$text = { $search: search.trim() };
  return Subject.find(query).sort({ preferredLabel: 1 }).limit(numericLimit);
}

module.exports = { createSubject, getSubjectById, listSubjects, exactExternalRefCollision };
