const mongoose = require("mongoose");
const { OWNER_TYPES } = require("../resourceOwnership.service");
const { hasOwn, trimIfString, isPlainObject } = require("./validation.utils");

function normalizeStringList(values) {
  return Array.isArray(values) ? values.map((value) => trimIfString(value)) : values;
}

function normalizeMediaSource(value) {
  if (!isPlainObject(value)) return value;
  return {
    provider: trimIfString(value.provider),
    wikidataEntityId: trimIfString(value.wikidataEntityId),
    fileTitle: trimIfString(value.fileTitle),
    pageUrl: trimIfString(value.pageUrl),
    retrievedAt: value.retrievedAt || null,
  };
}

function normalizeMediaRights(value) {
  if (!isPlainObject(value)) return value;
  return {
    creator: trimIfString(value.creator),
    attribution: trimIfString(value.attribution),
    licenseName: trimIfString(value.licenseName),
    licenseUrl: trimIfString(value.licenseUrl),
  };
}

function normalizeIllustrativeMedia(values) {
  if (!Array.isArray(values)) return values;
  return values.map((value) => isPlainObject(value) ? {
    ...(value._id ? { _id: value._id } : {}),
    url: trimIfString(value.url),
    originalUrl: trimIfString(value.originalUrl),
    altText: trimIfString(value.altText),
    mimeType: trimIfString(value.mimeType),
    width: value.width || null,
    height: value.height || null,
    source: value.source ? normalizeMediaSource(value.source) : null,
    rights: value.rights ? normalizeMediaRights(value.rights) : null,
  } : value);
}

function normalizeRevisionPayload(payload = {}) {
  const out = {};
  if (hasOwn(payload, "label")) out.label = trimIfString(payload.label);
  if (hasOwn(payload, "relatedSubjectIds")) out.relatedSubjectIds = payload.relatedSubjectIds;
  if (hasOwn(payload, "tags")) out.tags = normalizeStringList(payload.tags);
  if (hasOwn(payload, "authorCredits")) out.authorCredits = normalizeStringList(payload.authorCredits);
  if (hasOwn(payload, "metadata")) out.metadata = isPlainObject(payload.metadata) ? { license: trimIfString(payload.metadata.license) } : payload.metadata;
  if (hasOwn(payload, "illustrativeMedia")) out.illustrativeMedia = normalizeIllustrativeMedia(payload.illustrativeMedia);
  if (hasOwn(payload, "selectionSignals")) out.selectionSignals = payload.selectionSignals;
  if (hasOwn(payload, "presentationVariants")) out.presentationVariants = payload.presentationVariants;
  if (hasOwn(payload, "defaultPresentation")) out.defaultPresentation = payload.defaultPresentation;
  if (hasOwn(payload, "provenance")) out.provenance = payload.provenance;
  return out;
}

function validateCreateItemPayload(payload = {}) {
  const issues = [];
  const allowed = ["primarySubjectId", "ownerType", "ownerId", "provenance"];
  for (const key of Object.keys(payload)) if (!allowed.includes(key)) issues.push({ field: key, code: "UNKNOWN_FIELD", message: `Campo non supportato: ${key}` });
  if (!mongoose.isValidObjectId(payload.primarySubjectId)) issues.push({ field: "primarySubjectId", code: "INVALID_OBJECT_ID", message: "primarySubjectId non valido" });
  if (!OWNER_TYPES.includes(payload.ownerType)) issues.push({ field: "ownerType", code: "INVALID_ENUM", message: "ownerType non valido", allowedValues: OWNER_TYPES });
  if (!mongoose.isValidObjectId(payload.ownerId)) issues.push({ field: "ownerId", code: "INVALID_OBJECT_ID", message: "ownerId non valido" });
  return issues;
}

function validateCreateEditionPayload(payload = {}) {
  const issues = [];
  const allowed = ["namespaceId", "authoredAgainstNamespaceRevisionId", "revision"];
  for (const key of Object.keys(payload)) if (!allowed.includes(key)) issues.push({ field: key, code: "UNKNOWN_FIELD", message: `Campo non supportato: ${key}` });
  if (!mongoose.isValidObjectId(payload.namespaceId)) issues.push({ field: "namespaceId", code: "INVALID_OBJECT_ID", message: "namespaceId non valido" });
  if (payload.authoredAgainstNamespaceRevisionId && !mongoose.isValidObjectId(payload.authoredAgainstNamespaceRevisionId)) issues.push({ field: "authoredAgainstNamespaceRevisionId", code: "INVALID_OBJECT_ID", message: "authoredAgainstNamespaceRevisionId non valido" });
  if (!isPlainObject(payload.revision)) issues.push({ field: "revision", code: "REQUIRED", message: "revision e obbligatoria" });
  return issues;
}

function validMediaUrl(value, { allowLocalUpload = false } = {}) {
  const url = String(value || "").trim();
  if (allowLocalUpload && /^\/uploads\/item-media\/[a-z0-9-]+\.(?:jpe?g|png|webp|avif)$/i.test(url)) return true;
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

function validateIllustrativeMedia(values) {
  const issues = [];
  if (!Array.isArray(values)) return issues;
  if (values.length > 1) issues.push({ field: "illustrativeMedia", code: "MAX_ITEMS", message: "Puoi associare una sola immagine al contenuto" });
  values.forEach((media, index) => {
    const base = `illustrativeMedia[${index}]`;
    if (!isPlainObject(media)) {
      issues.push({ field: base, code: "INVALID_TYPE", message: "L'immagine del contenuto non è valida" });
      return;
    }
    if (!validMediaUrl(media.url, { allowLocalUpload: true })) issues.push({ field: `${base}.url`, code: "INVALID_URL", message: "Inserisci un indirizzo valido per l'immagine" });
    if (!String(media.altText || "").trim()) issues.push({ field: `${base}.altText`, code: "REQUIRED", message: "Descrivi brevemente l'immagine per renderla accessibile" });
    if (media.originalUrl && !validMediaUrl(media.originalUrl)) issues.push({ field: `${base}.originalUrl`, code: "INVALID_URL", message: "L'indirizzo dell'immagine originale non è valido" });
    if (media.source !== null && media.source !== undefined && !isPlainObject(media.source)) issues.push({ field: `${base}.source`, code: "INVALID_TYPE", message: "La provenienza dell'immagine non è valida" });
    if (media.rights !== null && media.rights !== undefined && !isPlainObject(media.rights)) issues.push({ field: `${base}.rights`, code: "INVALID_TYPE", message: "I diritti dell'immagine non sono validi" });
    if (isPlainObject(media.source)) {
      if (media.source.pageUrl && !validMediaUrl(media.source.pageUrl)) issues.push({ field: `${base}.source.pageUrl`, code: "INVALID_URL", message: "L'indirizzo della fonte dell'immagine non è valido" });
      if (media.source.retrievedAt && !Number.isFinite(Date.parse(media.source.retrievedAt))) issues.push({ field: `${base}.source.retrievedAt`, code: "INVALID_DATE", message: "La data di acquisizione dell'immagine non è valida" });
    }
    if (isPlainObject(media.rights) && media.rights.licenseUrl && !validMediaUrl(media.rights.licenseUrl)) issues.push({ field: `${base}.rights.licenseUrl`, code: "INVALID_URL", message: "L'indirizzo della licenza dell'immagine non è valido" });
    for (const dimension of ["width", "height"]) {
      if (media[dimension] !== null && media[dimension] !== undefined && (!Number.isFinite(Number(media[dimension])) || Number(media[dimension]) <= 0)) issues.push({ field: `${base}.${dimension}`, code: "INVALID_NUMBER", message: "Le dimensioni dell'immagine devono essere numeri positivi" });
    }
  });
  return issues;
}

function validateRevisionPayloadShape(payload = {}, { partial = false } = {}) {
  const issues = [];
  const allowed = ["label", "relatedSubjectIds", "tags", "authorCredits", "metadata", "illustrativeMedia", "selectionSignals", "presentationVariants", "defaultPresentation", "provenance"];
  for (const key of Object.keys(payload || {})) if (!allowed.includes(key)) issues.push({ field: key, code: "UNKNOWN_FIELD", message: `Campo non supportato: ${key}` });
  if (!partial && (!payload.label || typeof payload.label !== "string")) issues.push({ field: "label", code: "REQUIRED", message: "label e obbligatoria" });
  for (const field of ["relatedSubjectIds", "tags", "authorCredits", "illustrativeMedia", "selectionSignals", "presentationVariants"]) {
    if (hasOwn(payload, field) && !Array.isArray(payload[field])) issues.push({ field, code: "INVALID_TYPE", message: `${field} deve essere un array` });
  }
  if (Array.isArray(payload.relatedSubjectIds)) payload.relatedSubjectIds.forEach((subjectId, index) => {
    if (!mongoose.isValidObjectId(subjectId)) issues.push({ field: `relatedSubjectIds[${index}]`, code: "INVALID_OBJECT_ID", message: "Subject id non valido" });
  });
  if (Array.isArray(payload.illustrativeMedia)) issues.push(...validateIllustrativeMedia(payload.illustrativeMedia));
  if (hasOwn(payload, "defaultPresentation") && payload.defaultPresentation !== null && !isPlainObject(payload.defaultPresentation)) issues.push({ field: "defaultPresentation", code: "INVALID_TYPE", message: "defaultPresentation deve essere un oggetto" });
  return issues;
}

module.exports = {
  normalizeIllustrativeMedia,
  normalizeRevisionPayload,
  validateCreateItemPayload,
  validateCreateEditionPayload,
  validateIllustrativeMedia,
  validateRevisionPayloadShape,
};
