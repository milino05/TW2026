const mongoose = require("mongoose");
const { pushError, hasOwn, trimIfString, isPlainObject } = require("./validation.utils");

const OWNER_TYPES = ["user", "organization"];
const CONTENT_ENTRY_ROLES = ["core", "recommended", "optional"];
const ROUTE_HINT_TYPES = ["indoor", "inter_venue"];
const DELIVERY_MODES = ["self_guided", "synchronized"];
const TOP_LEVEL_FIELDS = new Set(["ownerType", "ownerId", "title", "description", "contentSources", "editorialSources", "contentEntries", "visitAnchors", "deliveryMode", "synchronization", "quiz", "presentationBaseline", "logistics"]);

function normalizeIdObject(value, fields) {
  if (!isPlainObject(value)) return value;
  const result = {};
  for (const field of fields) if (hasOwn(value, field)) result[field] = value[field];
  if (value._id) result._id = value._id;
  return result;
}

function normalizeVisitV2Payload(payload = {}) {
  const normalized = {};
  for (const field of ["ownerType", "title", "description"]) if (hasOwn(payload, field)) normalized[field] = trimIfString(payload[field]);
  if (hasOwn(payload, "deliveryMode")) normalized.deliveryMode = trimIfString(payload.deliveryMode)?.toLowerCase();
  if (hasOwn(payload, "ownerId")) normalized.ownerId = payload.ownerId;
  if (hasOwn(payload, "editorialSources")) normalized.editorialSources = Array.isArray(payload.editorialSources)
    ? payload.editorialSources.map((entry) => normalizeIdObject(entry, ["editorialReleaseId"]))
    : payload.editorialSources;
  if (hasOwn(payload, "contentSources")) normalized.contentSources = Array.isArray(payload.contentSources)
    ? payload.contentSources.map((entry) => {
      const result = normalizeIdObject(entry, ["sourceType", "editorialReleaseId", "itemRevisionId"]);
      if (isPlainObject(result) && hasOwn(result, "sourceType")) result.sourceType = trimIfString(result.sourceType)?.toLowerCase();
      return result;
    })
    : payload.contentSources;
  if (hasOwn(payload, "visitAnchors")) normalized.visitAnchors = Array.isArray(payload.visitAnchors)
    ? payload.visitAnchors.map((entry) => normalizeIdObject(entry, ["venueTargetId"]))
    : payload.visitAnchors;
  if (hasOwn(payload, "contentEntries")) normalized.contentEntries = Array.isArray(payload.contentEntries)
    ? payload.contentEntries.map((entry) => {
      const result = normalizeIdObject(entry, ["contentSourceId", "editorialSourceId", "itemId", "itemEditionId", "itemRevisionId", "deliveryAnchorId", "role"]);
      if (isPlainObject(result) && hasOwn(result, "role")) result.role = trimIfString(result.role)?.toLowerCase();
      return result;
    })
    : payload.contentEntries;
  if (hasOwn(payload, "presentationBaseline")) normalized.presentationBaseline = isPlainObject(payload.presentationBaseline) ? {
    ...(hasOwn(payload.presentationBaseline, "depthPreference") ? { depthPreference: payload.presentationBaseline.depthPreference == null ? null : Number(payload.presentationBaseline.depthPreference) } : {}),
    ...(hasOwn(payload.presentationBaseline, "languageComplexityPreference") ? { languageComplexityPreference: payload.presentationBaseline.languageComplexityPreference == null ? null : Number(payload.presentationBaseline.languageComplexityPreference) } : {}),
    ...(hasOwn(payload.presentationBaseline, "locale") ? { locale: trimIfString(payload.presentationBaseline.locale) || null } : {}),
  } : payload.presentationBaseline;
  if (hasOwn(payload, "synchronization")) normalized.synchronization = isPlainObject(payload.synchronization) ? {
    ...(hasOwn(payload.synchronization, "joinAlias") ? {
      joinAlias: trimIfString(payload.synchronization.joinAlias)?.replace(/\s+/g, " ") || null,
    } : {}),
  } : payload.synchronization;
  if (hasOwn(payload, "quiz")) normalized.quiz = isPlainObject(payload.quiz) ? {
    questions: Array.isArray(payload.quiz.questions) ? payload.quiz.questions.map((question) => {
      if (!isPlainObject(question)) return question;
      const result = normalizeIdObject(question, ["question", "options", "correctOptionIndex", "points"]);
      if (hasOwn(result, "question")) result.question = trimIfString(result.question);
      if (hasOwn(result, "options") && Array.isArray(result.options)) result.options = result.options.map(trimIfString);
      if (hasOwn(result, "correctOptionIndex")) result.correctOptionIndex = Number(result.correctOptionIndex);
      if (hasOwn(result, "points")) result.points = result.points == null || result.points === "" ? null : Number(result.points);
      return result;
    }) : payload.quiz.questions,
  } : payload.quiz;
  if (hasOwn(payload, "logistics")) normalized.logistics = isPlainObject(payload.logistics) ? {
    preVisitNotes: Array.isArray(payload.logistics.preVisitNotes) ? payload.logistics.preVisitNotes.map(trimIfString).filter(Boolean) : payload.logistics.preVisitNotes,
    routeHints: Array.isArray(payload.logistics.routeHints) ? payload.logistics.routeHints.map((hint) => {
      if (!isPlainObject(hint)) return hint;
      const result = normalizeIdObject(hint, ["fromAnchorId", "toAnchorId", "type", "instructionOverride", "note", "estimatedTransferSeconds"]);
      if (hasOwn(result, "type")) result.type = trimIfString(result.type)?.toLowerCase();
      if (hasOwn(result, "instructionOverride")) result.instructionOverride = trimIfString(result.instructionOverride) || null;
      if (hasOwn(result, "note")) result.note = trimIfString(result.note) || null;
      if (hasOwn(result, "estimatedTransferSeconds")) result.estimatedTransferSeconds = result.estimatedTransferSeconds == null ? null : Number(result.estimatedTransferSeconds);
      return result;
    }) : payload.logistics.routeHints,
  } : payload.logistics;
  return normalized;
}

function rejectUnknownFields(rawPayload, errors, allowed = TOP_LEVEL_FIELDS, prefix = "") {
  if (!isPlainObject(rawPayload)) return;
  for (const key of Object.keys(rawPayload)) if (!allowed.has(key)) pushError(errors, prefix ? `${prefix}.${key}` : key, "UNKNOWN_FIELD", `Campo non supportato: ${key}`);
}

function validId(value) { return mongoose.isValidObjectId(value); }

function validatePresentationBaseline(value, errors) {
  if (value == null) return;
  if (!isPlainObject(value)) return pushError(errors, "presentationBaseline", "INVALID_TYPE", "presentationBaseline deve essere un oggetto");
  rejectUnknownFields(value, errors, new Set(["depthPreference", "languageComplexityPreference", "locale"]), "presentationBaseline");
  for (const field of ["depthPreference", "languageComplexityPreference"]) {
    if (!hasOwn(value, field) || value[field] == null) continue;
    if (!Number.isFinite(Number(value[field])) || Number(value[field]) < 0 || Number(value[field]) > 1) pushError(errors, `presentationBaseline.${field}`, "OUT_OF_RANGE", `${field} deve essere compreso tra 0 e 1`);
  }
  if (hasOwn(value, "locale") && value.locale != null && typeof value.locale !== "string") pushError(errors, "presentationBaseline.locale", "INVALID_TYPE", "locale deve essere una stringa");
}

function validateSynchronization(value, errors) {
  if (value == null) return;
  if (!isPlainObject(value)) return pushError(errors, "synchronization", "INVALID_TYPE", "synchronization deve essere un oggetto");
  rejectUnknownFields(value, errors, new Set(["joinAlias"]), "synchronization");
  if (hasOwn(value, "joinAlias") && value.joinAlias != null) {
    if (typeof value.joinAlias !== "string") pushError(errors, "synchronization.joinAlias", "INVALID_TYPE", "L'alias di ingresso deve essere un testo");
    else if (value.joinAlias.length > 80) pushError(errors, "synchronization.joinAlias", "OUT_OF_RANGE", "L'alias di ingresso non può superare 80 caratteri");
  }
}

function validateQuiz(value, rawValue, errors) {
  if (value == null) return;
  if (!isPlainObject(value)) return pushError(errors, "quiz", "INVALID_TYPE", "quiz deve essere un oggetto");
  rejectUnknownFields(rawValue || {}, errors, new Set(["questions"]), "quiz");
  if (value.questions == null) return;
  if (!Array.isArray(value.questions)) return pushError(errors, "quiz.questions", "INVALID_TYPE", "Le domande del quiz devono essere un array");
  value.questions.forEach((question, index) => {
    const field = `quiz.questions[${index}]`;
    if (!isPlainObject(question)) return pushError(errors, field, "INVALID_TYPE", "La domanda del quiz deve essere un oggetto");
    rejectUnknownFields(rawValue?.questions?.[index] || {}, errors, new Set(["_id", "question", "options", "correctOptionIndex", "points"]), field);
    if (hasOwn(question, "question") && typeof question.question !== "string") pushError(errors, `${field}.question`, "INVALID_TYPE", "La domanda deve essere un testo");
    if (hasOwn(question, "options")) {
      if (!Array.isArray(question.options)) pushError(errors, `${field}.options`, "INVALID_TYPE", "Le risposte devono essere un array");
      else question.options.forEach((option, optionIndex) => {
        if (typeof option !== "string") pushError(errors, `${field}.options[${optionIndex}]`, "INVALID_TYPE", "La risposta deve essere un testo");
      });
    }
    if (hasOwn(question, "correctOptionIndex") && !Number.isInteger(question.correctOptionIndex)) pushError(errors, `${field}.correctOptionIndex`, "INVALID_NUMBER", "La risposta corretta deve indicare una delle opzioni");
    if (hasOwn(question, "points") && question.points != null && (!Number.isFinite(question.points) || question.points < 0)) pushError(errors, `${field}.points`, "INVALID_NUMBER", "I punti devono essere un numero maggiore o uguale a zero");
  });
}

function validateVisitV2Payload({ payload, rawPayload = payload, creating = false }) {
  const errors = [];
  if (!isPlainObject(rawPayload)) return [{ field: "payload", code: "INVALID_TYPE", message: "Il payload deve essere un oggetto" }];
  rejectUnknownFields(rawPayload, errors);
  if (creating) {
    if (!OWNER_TYPES.includes(payload.ownerType)) pushError(errors, "ownerType", "INVALID_ENUM", "ownerType deve essere user oppure organization", { allowedValues: OWNER_TYPES });
    if (!validId(payload.ownerId)) pushError(errors, "ownerId", "INVALID_OBJECT_ID", "ownerId non valido");
    if (!payload.title || typeof payload.title !== "string") pushError(errors, "title", "REQUIRED", "title e obbligatorio");
  } else {
    if (hasOwn(rawPayload, "ownerType") || hasOwn(rawPayload, "ownerId")) pushError(errors, "owner", "IMMUTABLE_FIELD", "L'owner della Visit non si modifica tramite la revisione");
    if (hasOwn(rawPayload, "title") && (!payload.title || typeof payload.title !== "string")) pushError(errors, "title", "REQUIRED", "title non puo essere vuoto");
  }

  if (hasOwn(rawPayload, "deliveryMode") && !DELIVERY_MODES.includes(payload.deliveryMode)) pushError(errors, "deliveryMode", "INVALID_ENUM", "deliveryMode deve essere self_guided oppure synchronized", { allowedValues: DELIVERY_MODES });

  if (hasOwn(rawPayload, "editorialSources")) {
    if (!Array.isArray(payload.editorialSources)) pushError(errors, "editorialSources", "INVALID_TYPE", "editorialSources deve essere un array");
    else payload.editorialSources.forEach((entry, index) => {
      const field = `editorialSources[${index}]`;
      if (!isPlainObject(entry)) return pushError(errors, field, "INVALID_TYPE", "EditorialSource deve essere un oggetto");
      rejectUnknownFields(rawPayload.editorialSources?.[index] || {}, errors, new Set(["_id", "editorialReleaseId"]), field);
      if (!validId(entry.editorialReleaseId)) pushError(errors, `${field}.editorialReleaseId`, "INVALID_OBJECT_ID", "editorialReleaseId non valido");
    });
  }

  if (hasOwn(rawPayload, "contentSources")) {
    if (!Array.isArray(payload.contentSources)) pushError(errors, "contentSources", "INVALID_TYPE", "contentSources deve essere un array");
    else payload.contentSources.forEach((entry, index) => {
      const field = `contentSources[${index}]`;
      if (!isPlainObject(entry)) return pushError(errors, field, "INVALID_TYPE", "ContentSource deve essere un oggetto");
      rejectUnknownFields(rawPayload.contentSources?.[index] || {}, errors, new Set(["_id", "sourceType", "editorialReleaseId", "itemRevisionId"]), field);
      if (!["editorial_release", "item_revision"].includes(entry.sourceType)) pushError(errors, `${field}.sourceType`, "INVALID_ENUM", "sourceType non valido");
      if (entry.sourceType === "editorial_release" && !validId(entry.editorialReleaseId)) pushError(errors, `${field}.editorialReleaseId`, "INVALID_OBJECT_ID", "editorialReleaseId non valido");
      if (entry.sourceType === "item_revision" && !validId(entry.itemRevisionId)) pushError(errors, `${field}.itemRevisionId`, "INVALID_OBJECT_ID", "itemRevisionId non valido");
    });
  }

  if (hasOwn(rawPayload, "visitAnchors")) {
    if (!Array.isArray(payload.visitAnchors)) pushError(errors, "visitAnchors", "INVALID_TYPE", "visitAnchors deve essere un array");
    else payload.visitAnchors.forEach((anchor, index) => {
      const field = `visitAnchors[${index}]`;
      if (!isPlainObject(anchor)) return pushError(errors, field, "INVALID_TYPE", "VisitAnchor deve essere un oggetto");
      rejectUnknownFields(rawPayload.visitAnchors?.[index] || {}, errors, new Set(["_id", "venueTargetId"]), field);
      if (!validId(anchor.venueTargetId)) pushError(errors, `${field}.venueTargetId`, "INVALID_OBJECT_ID", "venueTargetId non valido");
    });
  }

  if (hasOwn(rawPayload, "contentEntries")) {
    if (!Array.isArray(payload.contentEntries)) pushError(errors, "contentEntries", "INVALID_TYPE", "contentEntries deve essere un array");
    else payload.contentEntries.forEach((entry, index) => {
      const field = `contentEntries[${index}]`;
      if (!isPlainObject(entry)) return pushError(errors, field, "INVALID_TYPE", "ContentEntry deve essere un oggetto");
      rejectUnknownFields(rawPayload.contentEntries?.[index] || {}, errors, new Set(["_id", "contentSourceId", "editorialSourceId", "itemId", "itemEditionId", "itemRevisionId", "deliveryAnchorId", "role"]), field);
      if (!validId(entry.contentSourceId) && !validId(entry.editorialSourceId)) pushError(errors, `${field}.contentSourceId`, "INVALID_OBJECT_ID", "contentSourceId non valido");
      for (const idField of ["itemId", "itemEditionId", "itemRevisionId"]) if (!validId(entry[idField])) pushError(errors, `${field}.${idField}`, "INVALID_OBJECT_ID", `${idField} non valido`);
      if (entry.deliveryAnchorId != null && !validId(entry.deliveryAnchorId)) pushError(errors, `${field}.deliveryAnchorId`, "INVALID_OBJECT_ID", "deliveryAnchorId non valido");
      if (!CONTENT_ENTRY_ROLES.includes(entry.role || "recommended")) pushError(errors, `${field}.role`, "INVALID_ENUM", "role non valido", { allowedValues: CONTENT_ENTRY_ROLES });
    });
  }

  validatePresentationBaseline(payload.presentationBaseline, errors);
  if (hasOwn(rawPayload, "synchronization")) validateSynchronization(payload.synchronization, errors);
  if (hasOwn(rawPayload, "quiz")) validateQuiz(payload.quiz, rawPayload.quiz, errors);

  if (hasOwn(rawPayload, "logistics")) {
    if (!isPlainObject(payload.logistics)) pushError(errors, "logistics", "INVALID_TYPE", "logistics deve essere un oggetto");
    else {
      rejectUnknownFields(rawPayload.logistics || {}, errors, new Set(["preVisitNotes", "routeHints"]), "logistics");
      if (payload.logistics.preVisitNotes != null && !Array.isArray(payload.logistics.preVisitNotes)) pushError(errors, "logistics.preVisitNotes", "INVALID_TYPE", "preVisitNotes deve essere un array");
      if (payload.logistics.routeHints != null && !Array.isArray(payload.logistics.routeHints)) pushError(errors, "logistics.routeHints", "INVALID_TYPE", "routeHints deve essere un array");
      (payload.logistics.routeHints || []).forEach((hint, index) => {
        const field = `logistics.routeHints[${index}]`;
        if (!isPlainObject(hint)) return pushError(errors, field, "INVALID_TYPE", "RouteHint deve essere un oggetto");
        rejectUnknownFields(rawPayload.logistics?.routeHints?.[index] || {}, errors, new Set(["_id", "fromAnchorId", "toAnchorId", "type", "instructionOverride", "note", "estimatedTransferSeconds"]), field);
        if (!validId(hint.fromAnchorId)) pushError(errors, `${field}.fromAnchorId`, "INVALID_OBJECT_ID", "fromAnchorId non valido");
        if (!validId(hint.toAnchorId)) pushError(errors, `${field}.toAnchorId`, "INVALID_OBJECT_ID", "toAnchorId non valido");
        if (String(hint.fromAnchorId || "") === String(hint.toAnchorId || "")) pushError(errors, field, "SAME_ROUTE_HINT_ENDPOINT", "Un RouteHint deve collegare due Anchor distinti");
        if (!ROUTE_HINT_TYPES.includes(hint.type)) pushError(errors, `${field}.type`, "INVALID_ENUM", "type non valido", { allowedValues: ROUTE_HINT_TYPES });
        if (hint.estimatedTransferSeconds != null && (!Number.isFinite(Number(hint.estimatedTransferSeconds)) || Number(hint.estimatedTransferSeconds) < 0)) pushError(errors, `${field}.estimatedTransferSeconds`, "INVALID_VALUE", "estimatedTransferSeconds deve essere >= 0");
      });
    }
  }
  return errors;
}

module.exports = { OWNER_TYPES, CONTENT_ENTRY_ROLES, ROUTE_HINT_TYPES, DELIVERY_MODES, normalizeVisitV2Payload, validateVisitV2Payload };
