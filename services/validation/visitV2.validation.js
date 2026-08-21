const mongoose = require("mongoose");
const { pushError, hasOwn, trimIfString, isPlainObject } = require("./validation.utils");

const OWNER_TYPES = ["user", "organization"];
const CONTENT_ENTRY_ROLES = ["core", "recommended", "optional"];
const ROUTE_HINT_TYPES = ["indoor", "inter_venue"];
const TOP_LEVEL_FIELDS = new Set(["ownerType", "ownerId", "title", "description", "editorialSources", "contentEntries", "visitAnchors", "presentationBaseline", "logistics"]);

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
  if (hasOwn(payload, "ownerId")) normalized.ownerId = payload.ownerId;
  if (hasOwn(payload, "editorialSources")) normalized.editorialSources = Array.isArray(payload.editorialSources)
    ? payload.editorialSources.map((entry) => normalizeIdObject(entry, ["editorialReleaseId"]))
    : payload.editorialSources;
  if (hasOwn(payload, "visitAnchors")) normalized.visitAnchors = Array.isArray(payload.visitAnchors)
    ? payload.visitAnchors.map((entry) => normalizeIdObject(entry, ["venueTargetId"]))
    : payload.visitAnchors;
  if (hasOwn(payload, "contentEntries")) normalized.contentEntries = Array.isArray(payload.contentEntries)
    ? payload.contentEntries.map((entry) => {
      const result = normalizeIdObject(entry, ["editorialSourceId", "itemId", "itemEditionId", "itemRevisionId", "deliveryAnchorId", "role"]);
      if (isPlainObject(result) && hasOwn(result, "role")) result.role = trimIfString(result.role)?.toLowerCase();
      return result;
    })
    : payload.contentEntries;
  if (hasOwn(payload, "presentationBaseline")) normalized.presentationBaseline = isPlainObject(payload.presentationBaseline) ? {
    ...(hasOwn(payload.presentationBaseline, "depthPreference") ? { depthPreference: payload.presentationBaseline.depthPreference == null ? null : Number(payload.presentationBaseline.depthPreference) } : {}),
    ...(hasOwn(payload.presentationBaseline, "languageComplexityPreference") ? { languageComplexityPreference: payload.presentationBaseline.languageComplexityPreference == null ? null : Number(payload.presentationBaseline.languageComplexityPreference) } : {}),
    ...(hasOwn(payload.presentationBaseline, "locale") ? { locale: trimIfString(payload.presentationBaseline.locale) || null } : {}),
  } : payload.presentationBaseline;
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

  if (hasOwn(rawPayload, "editorialSources")) {
    if (!Array.isArray(payload.editorialSources)) pushError(errors, "editorialSources", "INVALID_TYPE", "editorialSources deve essere un array");
    else payload.editorialSources.forEach((entry, index) => {
      const field = `editorialSources[${index}]`;
      if (!isPlainObject(entry)) return pushError(errors, field, "INVALID_TYPE", "EditorialSource deve essere un oggetto");
      rejectUnknownFields(rawPayload.editorialSources?.[index] || {}, errors, new Set(["_id", "editorialReleaseId"]), field);
      if (!validId(entry.editorialReleaseId)) pushError(errors, `${field}.editorialReleaseId`, "INVALID_OBJECT_ID", "editorialReleaseId non valido");
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
      rejectUnknownFields(rawPayload.contentEntries?.[index] || {}, errors, new Set(["_id", "editorialSourceId", "itemId", "itemEditionId", "itemRevisionId", "deliveryAnchorId", "role"]), field);
      for (const idField of ["editorialSourceId", "itemId", "itemEditionId", "itemRevisionId"]) if (!validId(entry[idField])) pushError(errors, `${field}.${idField}`, "INVALID_OBJECT_ID", `${idField} non valido`);
      if (entry.deliveryAnchorId != null && !validId(entry.deliveryAnchorId)) pushError(errors, `${field}.deliveryAnchorId`, "INVALID_OBJECT_ID", "deliveryAnchorId non valido");
      if (!CONTENT_ENTRY_ROLES.includes(entry.role || "recommended")) pushError(errors, `${field}.role`, "INVALID_ENUM", "role non valido", { allowedValues: CONTENT_ENTRY_ROLES });
    });
  }

  validatePresentationBaseline(payload.presentationBaseline, errors);

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

module.exports = { OWNER_TYPES, CONTENT_ENTRY_ROLES, ROUTE_HINT_TYPES, normalizeVisitV2Payload, validateVisitV2Payload };
