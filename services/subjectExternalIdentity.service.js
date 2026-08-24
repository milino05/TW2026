const Subject = require("../models/subject.model");
const AppError = require("../utils/AppError");
const { getActiveUserOrFail } = require("./userAuthorization.service");
const { projectSubject } = require("./subjectProjection.service");
const semanticResolver = require("./semanticResolver/semanticResolver.service");

function normalizeCommandPayload(payload = {}) {
  return {
    scheme: typeof payload.scheme === "string" ? payload.scheme.trim().toLowerCase() : payload.scheme,
    id: typeof payload.id === "string" ? payload.id.trim() : payload.id,
    locale: typeof payload.locale === "string" ? payload.locale.trim() : "it",
    ...(Object.prototype.hasOwnProperty.call(payload, "preferredLabel") ? {
      preferredLabel: typeof payload.preferredLabel === "string" ? payload.preferredLabel.trim() : payload.preferredLabel,
    } : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, "description") ? {
      description: typeof payload.description === "string" ? payload.description.trim() : payload.description,
    } : {}),
  };
}

function validateCommandPayload(payload, rawPayload) {
  const issues = [];
  const add = (field, code, message) => issues.push({ field, code, message });
  if (!payload.scheme || typeof payload.scheme !== "string") add("scheme", "REQUIRED", "scheme e obbligatorio");
  if (!payload.id || typeof payload.id !== "string") add("id", "REQUIRED", "id e obbligatorio");
  if (Object.prototype.hasOwnProperty.call(payload, "preferredLabel") && (typeof payload.preferredLabel !== "string" || !payload.preferredLabel)) {
    add("preferredLabel", "INVALID_STRING", "preferredLabel deve essere una stringa non vuota");
  }
  if (Object.prototype.hasOwnProperty.call(payload, "description") && typeof payload.description !== "string") {
    add("description", "INVALID_STRING", "description deve essere una stringa");
  }
  const allowed = new Set(["scheme", "id", "locale", "preferredLabel", "description"]);
  for (const field of Object.keys(rawPayload || {})) {
    if (!allowed.has(field)) add(field, "UNKNOWN_FIELD", `Campo non supportato: ${field}`);
  }
  return issues;
}

function reconciliationError({ scheme, resolution, subjects }) {
  return new AppError("La canonicalizzazione coinvolge Subject differenti", 409, [{
    code: "RECONCILIATION_REQUIRED",
    scheme,
    requestedId: resolution.requestedId,
    canonicalId: resolution.canonicalId,
    subjectIds: subjects.map((subject) => String(subject._id || subject.id)),
  }]);
}

async function createSubjectFromExternalIdentity({ payload, actorUserId }) {
  const actor = await getActiveUserOrFail(actorUserId);
  const rawPayload = payload || {};
  const normalized = normalizeCommandPayload(rawPayload);
  const issues = validateCommandPayload(normalized, rawPayload);
  if (issues.length) throw new AppError("Payload non valido", 400, issues);

  const resolution = await semanticResolver.resolve({
    scheme: normalized.scheme,
    id: normalized.id,
    locale: normalized.locale,
  });
  if (resolution.boundSubjects.length > 1) {
    throw reconciliationError({ scheme: normalized.scheme, resolution, subjects: resolution.boundSubjects });
  }
  if (resolution.boundSubjects.length === 1) {
    return {
      outcome: "reuse_existing",
      created: false,
      subject: resolution.boundSubjects[0],
      resolution: {
        status: resolution.status,
        requestedId: resolution.requestedId,
        canonicalId: resolution.canonicalId,
      },
    };
  }

  const now = new Date();
  const baseProvenance = {
    confirmation: { source: "resolver", confirmedAt: now, confirmedBy: actor._id },
    verification: { status: "verified", checkedAt: now },
  };
  const externalIdentities = [{
    scheme: normalized.scheme,
    id: resolution.canonicalId,
    role: "canonical",
    canonicalId: null,
    ...baseProvenance,
  }];
  if (resolution.requestedId !== resolution.canonicalId) {
    externalIdentities.push({
      scheme: normalized.scheme,
      id: resolution.requestedId,
      role: "historical",
      canonicalId: resolution.canonicalId,
      confirmation: baseProvenance.confirmation,
      verification: { status: "redirected", checkedAt: now },
    });
  }

  try {
    await Subject.init();
    const subject = await Subject.create({
      preferredLabel: normalized.preferredLabel || resolution.candidate.label,
      description: Object.prototype.hasOwnProperty.call(normalized, "description")
        ? normalized.description
        : resolution.candidate.description,
      externalIdentities,
      createdBy: actor._id,
    });
    return {
      outcome: "created",
      created: true,
      subject: projectSubject(subject),
      resolution: {
        status: resolution.status,
        requestedId: resolution.requestedId,
        canonicalId: resolution.canonicalId,
      },
    };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const collided = await semanticResolver.subjectsBoundTo({
      scheme: normalized.scheme,
      ids: [resolution.requestedId, resolution.canonicalId],
    });
    if (collided.length > 1) throw reconciliationError({ scheme: normalized.scheme, resolution, subjects: collided });
    if (collided.length === 1) {
      return {
        outcome: "reuse_existing",
        created: false,
        subject: projectSubject(collided[0]),
        resolution: {
          status: resolution.status,
          requestedId: resolution.requestedId,
          canonicalId: resolution.canonicalId,
        },
      };
    }
    throw error;
  }
}

module.exports = {
  createSubjectFromExternalIdentity,
  normalizeCommandPayload,
  validateCommandPayload,
};
