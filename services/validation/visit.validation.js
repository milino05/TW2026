const mongoose = require("mongoose");
const Item = require("../../models/item.model");
const { pushError, hasOwn, trimIfString, isPlainObject, normalizeBoolean, normalizeKey } = require("./validation.utils");

const WRITABLE_FIELDS = new Set([
  "title",
  "description",
  "kind",
  "ownerMuseumId",
  "defaultPresentationPolicy",
  "stops",
]);

const IMMUTABLE_AFTER_CREATE = new Set(["kind", "ownerMuseumId"]);

function normalizeVisitPayload(payload = {}) {
  const normalized = {};

  if (hasOwn(payload, "title")) normalized.title = trimIfString(payload.title);
  if (hasOwn(payload, "description")) normalized.description = trimIfString(payload.description);
  if (hasOwn(payload, "kind")) normalized.kind = normalizeKey(payload.kind);
  if (hasOwn(payload, "ownerMuseumId")) normalized.ownerMuseumId = payload.ownerMuseumId || null;

  if (hasOwn(payload, "defaultPresentationPolicy")) {
    normalized.defaultPresentationPolicy = isPlainObject(payload.defaultPresentationPolicy)
      ? {
          durationKey: normalizeKey(payload.defaultPresentationPolicy.durationKey),
          languageLevelKey: normalizeKey(payload.defaultPresentationPolicy.languageLevelKey),
        }
      : payload.defaultPresentationPolicy;
  }

  if (hasOwn(payload, "stops")) {
    normalized.stops = Array.isArray(payload.stops)
      ? payload.stops.map((stop) => {
          if (!isPlainObject(stop)) return stop;

          return {
            itemId: stop.itemId,
            optional: hasOwn(stop, "optional") ? normalizeBoolean(stop.optional) : false,
          };
        })
      : payload.stops;
  }

  return normalized;
}

function validateAllowedFields(rawPayload, errors, mode) {
  Object.keys(rawPayload || {}).forEach((field) => {
    if (!WRITABLE_FIELDS.has(field)) {
      pushError(errors, field, "FORBIDDEN_FIELD", `Il campo ${field} non puo essere modificato direttamente`);
    }

    if (mode === "update" && IMMUTABLE_AFTER_CREATE.has(field)) {
      pushError(errors, field, "IMMUTABLE_FIELD", `Il campo ${field} non puo essere modificato dopo la creazione`);
    }
  });
}

function validateBaseFields({ payload, errors, mode }) {
  const isCreate = mode === "create";

  if (isCreate || hasOwn(payload, "title")) {
    if (!payload.title || typeof payload.title !== "string") {
      pushError(errors, "title", "REQUIRED", "title e obbligatorio");
    }
  }

  if (hasOwn(payload, "description") && typeof payload.description !== "string") {
    pushError(errors, "description", "INVALID_TYPE", "description deve essere una stringa");
  }

  if (isCreate || hasOwn(payload, "kind")) {
    if (!["official", "community"].includes(payload.kind)) {
      pushError(errors, "kind", "INVALID_ENUM", "kind deve essere official oppure community", {
        allowedValues: ["official", "community"],
      });
    }
  }

  if (isCreate && payload.kind === "official" && !payload.ownerMuseumId) {
    pushError(errors, "ownerMuseumId", "REQUIRED", "ownerMuseumId e obbligatorio per una visita ufficiale");
  }

  if (isCreate && payload.kind === "community" && payload.ownerMuseumId) {
    pushError(errors, "ownerMuseumId", "NOT_ALLOWED", "ownerMuseumId non e ammesso per una visita community");
  }

  if (payload.ownerMuseumId && !mongoose.isValidObjectId(payload.ownerMuseumId)) {
    pushError(errors, "ownerMuseumId", "INVALID_OBJECT_ID", "ownerMuseumId non e un ObjectId valido");
  }
}

function validateDefaultPolicy(policy, errors, required) {
  if (policy === undefined && !required) return;

  if (!isPlainObject(policy)) {
    pushError(errors, "defaultPresentationPolicy", "REQUIRED", "defaultPresentationPolicy deve essere un oggetto");
    return;
  }

  if (!policy.durationKey || typeof policy.durationKey !== "string") {
    pushError(errors, "defaultPresentationPolicy.durationKey", "REQUIRED", "durationKey e obbligatoria");
  }

  if (!policy.languageLevelKey || typeof policy.languageLevelKey !== "string") {
    pushError(errors, "defaultPresentationPolicy.languageLevelKey", "REQUIRED", "languageLevelKey e obbligatoria");
  }
}

async function validateStops({ stops, kind, ownerMuseumId, errors }) {
  if (stops === undefined) return { museumIds: [] };

  if (!Array.isArray(stops)) {
    pushError(errors, "stops", "INVALID_TYPE", "stops deve essere un array");
    return { museumIds: [] };
  }

  const validEntries = [];

  stops.forEach((stop, index) => {
    const basePath = `stops[${index}]`;

    if (!isPlainObject(stop)) {
      pushError(errors, basePath, "INVALID_TYPE", "Ogni tappa deve essere un oggetto");
      return;
    }

    if (typeof stop.optional !== "boolean") {
      pushError(errors, `${basePath}.optional`, "INVALID_TYPE", "optional deve essere booleano");
    }

    if (!stop.itemId) {
      pushError(errors, `${basePath}.itemId`, "REQUIRED", "itemId e obbligatorio");
      return;
    }

    if (!mongoose.isValidObjectId(stop.itemId)) {
      pushError(errors, `${basePath}.itemId`, "INVALID_OBJECT_ID", "itemId non e un ObjectId valido");
      return;
    }

    validEntries.push({ itemId: stop.itemId, index });
  });

  const items = validEntries.length
    ? await Item.find({ _id: { $in: validEntries.map((entry) => entry.itemId) } })
        .select("_id museumId")
        .lean()
    : [];
  const itemsById = new Map(items.map((item) => [String(item._id), item]));
  const museumIds = new Set();

  validEntries.forEach(({ itemId, index }) => {
    const item = itemsById.get(String(itemId));
    if (!item) {
      pushError(errors, `stops[${index}].itemId`, "ITEM_NOT_FOUND", "L'item della tappa non esiste");
      return;
    }

    museumIds.add(String(item.museumId));

    if (kind === "official" && ownerMuseumId && String(item.museumId) !== String(ownerMuseumId)) {
      pushError(errors, `stops[${index}].itemId`, "ITEM_FROM_DIFFERENT_MUSEUM", "Una visita ufficiale puo contenere soltanto item del museo proprietario");
    }
  });

  return { museumIds: Array.from(museumIds) };
}

async function validateVisitDraftPayload({ rawPayload, payload, mode, existingVisit = null }) {
  const errors = [];

  validateAllowedFields(rawPayload, errors, mode);
  validateBaseFields({ payload, errors, mode });
  validateDefaultPolicy(payload.defaultPresentationPolicy, errors, mode === "create");

  const effectiveKind = mode === "create" ? payload.kind : existingVisit?.kind;
  const effectiveOwnerMuseumId = mode === "create" ? payload.ownerMuseumId : existingVisit?.ownerMuseumId;

  const stopResult = await validateStops({
    stops: payload.stops,
    kind: effectiveKind,
    ownerMuseumId: effectiveOwnerMuseumId,
    errors,
  });

  return {
    errors,
    museumIds: stopResult.museumIds,
  };
}

module.exports = {
  normalizeVisitPayload,
  validateVisitDraftPayload,
};
