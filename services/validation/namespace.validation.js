const OWNER_TYPES = Object.freeze(["user", "organization"]);
const {
  pushError,
  hasOwn,
  trimIfString,
  isPlainObject,
  normalizeKey,
  normalizeBoolean,
  normalizeStringArrayStrict,
  toNumberIfPresent,
} = require("./validation.utils");

const MATCH_TYPES = Object.freeze(["exact", "close", "broader", "narrower"]);
const RELATION_CATEGORIES = Object.freeze(["semantic", "contextual", "editorial"]);
const RELATION_DIRECTIONS = Object.freeze(["directed", "symmetric"]);
const RELATION_STRENGTHS = Object.freeze(["strong", "medium", "weak"]);
const DEFINITION_FIELDS = Object.freeze([
  "subjectClasses",
  "relationTypes",
  "durationTypes",
  "languageLevels",
  "presentationAspects",
  "selectionSignals",
]);
const REVISION_FIELDS = new Set(DEFINITION_FIELDS);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;
function validateUuid(value) { return typeof value === "string" && UUID_PATTERN.test(value); }
function validateObjectId(value) { return typeof value === "string" ? OBJECT_ID_PATTERN.test(value) : Boolean(value && OBJECT_ID_PATTERN.test(String(value))); }

function validateUnknownFields(value, allowed, field, errors) {
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) pushError(errors, field ? `${field}.${key}` : key, "UNKNOWN_FIELD", `Campo non supportato: ${key}`);
  }
}

function normalizeSemanticRefs(values) {
  if (!Array.isArray(values)) return values;
  return values.map((value) => isPlainObject(value) ? {
    scheme: normalizeKey(value.scheme),
    id: trimIfString(value.id),
    matchType: normalizeKey(value.matchType || "exact"),
  } : value);
}

function normalizeBaseDefinition(value) {
  if (!isPlainObject(value)) return value;
  return {
    ...(hasOwn(value, "definitionId") ? { definitionId: trimIfString(value.definitionId) } : {}),
    key: normalizeKey(value.key),
    label: trimIfString(value.label),
    description: trimIfString(value.description),
    semanticRefs: normalizeSemanticRefs(value.semanticRefs || []),
  };
}

function normalizeRelationTargetSelectionSignals(values) {
  if (!Array.isArray(values)) return values;
  return values.map((value) => isPlainObject(value) ? {
    definitionId: trimIfString(value.definitionId),
    weight: value.weight === undefined || value.weight === "" ? 1 : Number(value.weight),
  } : value);
}

function normalizeRelationType(value) {
  if (!isPlainObject(value)) return value;
  const base = normalizeBaseDefinition(value);
  return {
    ...base,
    domainDefinitionIds: normalizeStringArrayStrict(value.domainDefinitionIds || []),
    rangeDefinitionIds: normalizeStringArrayStrict(value.rangeDefinitionIds || []),
    category: normalizeKey(value.category || "semantic"),
    strength: normalizeKey(value.strength || "medium"),
    userIntents: normalizeStringArrayStrict(value.userIntents || []),
    targetSelectionSignals: normalizeRelationTargetSelectionSignals(value.targetSelectionSignals || []),
    directionality: normalizeKey(value.directionality || "directed"),
    reverse: isPlainObject(value.reverse) ? {
      label: trimIfString(value.reverse.label),
      description: trimIfString(value.reverse.description),
      userIntents: normalizeStringArrayStrict(value.reverse.userIntents || []),
      targetSelectionSignals: normalizeRelationTargetSelectionSignals(value.reverse.targetSelectionSignals || []),
    } : value.reverse,
    validationRules: isPlainObject(value.validationRules) ? {
      allowMultiple: normalizeBoolean(value.validationRules.allowMultiple) !== false,
      targetRequired: normalizeBoolean(value.validationRules.targetRequired) !== false,
    } : { allowMultiple: true, targetRequired: true },
  };
}

function normalizeNamespaceRevisionPayload(payload = {}) {
  const normalized = {};
  if (hasOwn(payload, "subjectClasses")) normalized.subjectClasses = Array.isArray(payload.subjectClasses) ? payload.subjectClasses.map(normalizeBaseDefinition) : payload.subjectClasses;
  if (hasOwn(payload, "relationTypes")) normalized.relationTypes = Array.isArray(payload.relationTypes) ? payload.relationTypes.map(normalizeRelationType) : payload.relationTypes;
  if (hasOwn(payload, "durationTypes")) normalized.durationTypes = Array.isArray(payload.durationTypes) ? payload.durationTypes.map((value) => {
    const base = normalizeBaseDefinition(value);
    return isPlainObject(base) ? { ...base, targetSeconds: toNumberIfPresent(value.targetSeconds), ...(hasOwn(value, "level") ? { level: value.level } : {}) } : base;
  }) : payload.durationTypes;
  if (hasOwn(payload, "languageLevels")) normalized.languageLevels = Array.isArray(payload.languageLevels) ? payload.languageLevels.map((value) => {
    const base = normalizeBaseDefinition(value);
    return isPlainObject(base) && hasOwn(value, "level") ? { ...base, level: value.level } : base;
  }) : payload.languageLevels;
  if (hasOwn(payload, "presentationAspects")) normalized.presentationAspects = Array.isArray(payload.presentationAspects) ? payload.presentationAspects.map(normalizeBaseDefinition) : payload.presentationAspects;
  if (hasOwn(payload, "selectionSignals")) normalized.selectionSignals = Array.isArray(payload.selectionSignals) ? payload.selectionSignals.map(normalizeBaseDefinition) : payload.selectionSignals;
  return normalized;
}

function validateSemanticRefs(values, field, errors) {
  if (!Array.isArray(values)) return pushError(errors, field, "INVALID_TYPE", `${field} deve essere un array`);
  const seen = new Set();
  values.forEach((value, index) => {
    const path = `${field}[${index}]`;
    if (!isPlainObject(value)) return pushError(errors, path, "INVALID_TYPE", "semanticRef deve essere un oggetto");
    validateUnknownFields(value, new Set(["scheme", "id", "matchType"]), path, errors);
    if (!value.scheme || typeof value.scheme !== "string") pushError(errors, `${path}.scheme`, "REQUIRED", "scheme e obbligatorio");
    if (!value.id || typeof value.id !== "string") pushError(errors, `${path}.id`, "REQUIRED", "id e obbligatorio");
    if (!MATCH_TYPES.includes(value.matchType || "exact")) pushError(errors, `${path}.matchType`, "INVALID_ENUM", "matchType non valido", { allowedValues: MATCH_TYPES });
    const key = `${value.scheme}::${value.id}::${value.matchType || "exact"}`;
    if (seen.has(key)) pushError(errors, path, "DUPLICATE_SEMANTIC_REF", "semanticRef duplicata");
    seen.add(key);
  });
}

function validateDefinitionBase(value, path, errors, { extraAllowed = [] } = {}) {
  if (!isPlainObject(value)) {
    pushError(errors, path, "INVALID_TYPE", "La definizione deve essere un oggetto");
    return false;
  }
  validateUnknownFields(value, new Set(["definitionId", "key", "label", "description", "semanticRefs", ...extraAllowed]), path, errors);
  if (!value.definitionId || typeof value.definitionId !== "string") pushError(errors, `${path}.definitionId`, "REQUIRED", "definitionId e obbligatorio");
  else if (!validateUuid(value.definitionId)) pushError(errors, `${path}.definitionId`, "INVALID_UUID", "definitionId deve essere un UUID valido");
  if (!value.key || typeof value.key !== "string") pushError(errors, `${path}.key`, "REQUIRED", "key e obbligatoria");
  if (!value.label || typeof value.label !== "string") pushError(errors, `${path}.label`, "REQUIRED", "label e obbligatoria");
  validateSemanticRefs(value.semanticRefs || [], `${path}.semanticRefs`, errors);
  return true;
}

function validateDefinitionCollection(values, field, errors, options = {}) {
  if (!Array.isArray(values)) {
    pushError(errors, field, "INVALID_TYPE", `${field} deve essere un array`);
    return;
  }
  const keys = new Set();
  values.forEach((value, index) => {
    const path = `${field}[${index}]`;
    if (!validateDefinitionBase(value, path, errors, options)) return;
    if (keys.has(value.key)) pushError(errors, `${path}.key`, "DUPLICATE_KEY", `key duplicata: ${value.key}`);
    keys.add(value.key);
  });
}

function validateDurationTypes(values, errors) {
  validateDefinitionCollection(values, "durationTypes", errors, { extraAllowed: ["targetSeconds", "level"] });
  if (!Array.isArray(values)) return;
  let previous = null;
  const seenSeconds = new Set();
  values.forEach((value, index) => {
    if (!isPlainObject(value)) return;
    const path = `durationTypes[${index}]`;
    if (hasOwn(value, "level")) pushError(errors, `${path}.level`, "FORBIDDEN_FIELD", "level e derivato dall'ordine dell'array");
    if (!Number.isInteger(value.targetSeconds) || value.targetSeconds < 1) pushError(errors, `${path}.targetSeconds`, "INVALID_NUMBER", "targetSeconds deve essere un intero positivo");
    if (seenSeconds.has(value.targetSeconds)) pushError(errors, `${path}.targetSeconds`, "DUPLICATE_TARGET_SECONDS", "targetSeconds deve essere univoco");
    if (previous !== null && value.targetSeconds <= previous) pushError(errors, `${path}.targetSeconds`, "NON_INCREASING_TARGET_SECONDS", "targetSeconds deve crescere seguendo l'ordine editoriale");
    seenSeconds.add(value.targetSeconds);
    previous = value.targetSeconds;
  });
}

function validateLanguageLevels(values, errors) {
  validateDefinitionCollection(values, "languageLevels", errors, { extraAllowed: ["level"] });
  if (!Array.isArray(values)) return;
  values.forEach((value, index) => {
    if (isPlainObject(value) && hasOwn(value, "level")) pushError(errors, `languageLevels[${index}].level`, "FORBIDDEN_FIELD", "level e derivato dall'ordine dell'array");
  });
}

function validateRelationSelectionSignals(values, field, selectionSignalIds, errors) {
  if (!Array.isArray(values)) {
    pushError(errors, field, "INVALID_TYPE", `${field} deve essere un array`);
    return;
  }
  const seen = new Set();
  values.forEach((value, index) => {
    const path = `${field}[${index}]`;
    if (!isPlainObject(value)) return pushError(errors, path, "INVALID_TYPE", "La preferenza deve essere un oggetto");
    validateUnknownFields(value, new Set(["definitionId", "weight"]), path, errors);
    const definitionId = value.definitionId;
    if (typeof definitionId !== "string" || !validateUuid(definitionId)) pushError(errors, `${path}.definitionId`, "INVALID_UUID", "Il SelectionSignal deve essere un UUID valido");
    else if (!selectionSignalIds.has(definitionId)) pushError(errors, `${path}.definitionId`, "UNKNOWN_SELECTION_SIGNAL", `SelectionSignal non presente: ${definitionId}`);
    if (seen.has(definitionId)) pushError(errors, `${path}.definitionId`, "DUPLICATE_VALUE", `SelectionSignal duplicato: ${definitionId}`);
    seen.add(definitionId);
    if (!Number.isFinite(Number(value.weight)) || Number(value.weight) < 0 || Number(value.weight) > 1) {
      pushError(errors, `${path}.weight`, "OUT_OF_RANGE", "weight deve essere compreso fra 0 e 1");
    }
  });
}

function validateRelationTypes(values, subjectClasses, selectionSignals, errors) {
  validateDefinitionCollection(values, "relationTypes", errors, {
    extraAllowed: ["domainDefinitionIds", "rangeDefinitionIds", "category", "strength", "userIntents", "targetSelectionSignals", "directionality", "reverse", "validationRules"],
  });
  if (!Array.isArray(values)) return;
  const subjectClassIds = new Set((subjectClasses || []).filter(isPlainObject).map((entry) => entry.definitionId));
  const selectionSignalIds = new Set((selectionSignals || []).filter(isPlainObject).map((entry) => entry.definitionId));
  values.forEach((value, index) => {
    if (!isPlainObject(value)) return;
    const path = `relationTypes[${index}]`;
    if (!RELATION_CATEGORIES.includes(value.category)) pushError(errors, `${path}.category`, "INVALID_ENUM", "category non valida", { allowedValues: RELATION_CATEGORIES });
    if (!RELATION_STRENGTHS.includes(value.strength)) pushError(errors, `${path}.strength`, "INVALID_ENUM", "strength non valida", { allowedValues: RELATION_STRENGTHS });
    if (!RELATION_DIRECTIONS.includes(value.directionality)) pushError(errors, `${path}.directionality`, "INVALID_ENUM", "directionality non valida", { allowedValues: RELATION_DIRECTIONS });
    for (const field of ["domainDefinitionIds", "rangeDefinitionIds"]) {
      if (!Array.isArray(value[field])) {
        pushError(errors, `${path}.${field}`, "INVALID_TYPE", `${field} deve essere un array`);
        continue;
      }
      const seen = new Set();
      value[field].forEach((definitionId, definitionIndex) => {
        const itemPath = `${path}.${field}[${definitionIndex}]`;
        if (typeof definitionId !== "string" || !validateUuid(definitionId)) pushError(errors, itemPath, "INVALID_UUID", "Il riferimento deve essere un UUID valido");
        else if (!subjectClassIds.has(definitionId)) pushError(errors, itemPath, "UNKNOWN_SUBJECT_CLASS", `SubjectClassDefinition non presente: ${definitionId}`);
        if (seen.has(definitionId)) pushError(errors, itemPath, "DUPLICATE_VALUE", `Riferimento duplicato: ${definitionId}`);
        seen.add(definitionId);
      });
    }
    if (!Array.isArray(value.userIntents)) pushError(errors, `${path}.userIntents`, "INVALID_TYPE", "userIntents deve essere un array");
    validateRelationSelectionSignals(value.targetSelectionSignals || [], `${path}.targetSelectionSignals`, selectionSignalIds, errors);
    if (value.reverse !== undefined && value.reverse !== null) {
      if (!isPlainObject(value.reverse)) pushError(errors, `${path}.reverse`, "INVALID_TYPE", "reverse deve essere un oggetto");
      else {
        validateUnknownFields(value.reverse, new Set(["label", "description", "userIntents", "targetSelectionSignals"]), `${path}.reverse`, errors);
        if (!Array.isArray(value.reverse.userIntents || [])) pushError(errors, `${path}.reverse.userIntents`, "INVALID_TYPE", "reverse.userIntents deve essere un array");
        validateRelationSelectionSignals(value.reverse.targetSelectionSignals || [], `${path}.reverse.targetSelectionSignals`, selectionSignalIds, errors);
      }
    }
    if (!isPlainObject(value.validationRules)) pushError(errors, `${path}.validationRules`, "INVALID_TYPE", "validationRules deve essere un oggetto");
    else {
      validateUnknownFields(value.validationRules, new Set(["allowMultiple", "targetRequired"]), `${path}.validationRules`, errors);
      if (typeof value.validationRules.allowMultiple !== "boolean") pushError(errors, `${path}.validationRules.allowMultiple`, "INVALID_TYPE", "allowMultiple deve essere boolean");
      if (typeof value.validationRules.targetRequired !== "boolean") pushError(errors, `${path}.validationRules.targetRequired`, "INVALID_TYPE", "targetRequired deve essere boolean");
    }
  });
}

function validateDefinitionIdsAreUnique(snapshot, errors) {
  const seen = new Map();
  for (const field of DEFINITION_FIELDS) {
    for (let index = 0; index < (snapshot[field] || []).length; index += 1) {
      const definition = snapshot[field][index];
      if (!isPlainObject(definition) || !definition.definitionId) continue;
      const previous = seen.get(definition.definitionId);
      if (previous) pushError(errors, `${field}[${index}].definitionId`, "DUPLICATE_DEFINITION_ID", `definitionId gia usato in ${previous}`);
      else seen.set(definition.definitionId, `${field}[${index}]`);
    }
  }
}

function validateNamespaceRevisionUnknownFields(payload = {}) {
  const errors = [];
  if (!isPlainObject(payload)) {
    pushError(errors, "revision", "INVALID_TYPE", "La revisione Namespace deve essere un oggetto");
    return errors;
  }
  validateUnknownFields(payload, REVISION_FIELDS, "", errors);
  const baseAllowed = new Set(["definitionId", "key", "label", "description", "semanticRefs"]);
  const durationAllowed = new Set([...baseAllowed, "targetSeconds", "level"]);
  const languageAllowed = new Set([...baseAllowed, "level"]);
  const relationAllowed = new Set([...baseAllowed, "domainDefinitionIds", "rangeDefinitionIds", "category", "strength", "userIntents", "targetSelectionSignals", "directionality", "reverse", "validationRules"]);
  const inspectDefinitions = (field, allowed) => {
    if (!Array.isArray(payload[field])) return;
    payload[field].forEach((definition, index) => {
      if (!isPlainObject(definition)) return;
      const path = `${field}[${index}]`;
      validateUnknownFields(definition, allowed, path, errors);
      if (Array.isArray(definition.semanticRefs)) {
        definition.semanticRefs.forEach((ref, refIndex) => {
          if (isPlainObject(ref)) validateUnknownFields(ref, new Set(["scheme", "id", "matchType"]), `${path}.semanticRefs[${refIndex}]`, errors);
        });
      }
      if (field === "relationTypes") {
        if (Array.isArray(definition.targetSelectionSignals)) definition.targetSelectionSignals.forEach((signal, signalIndex) => {
          if (isPlainObject(signal)) validateUnknownFields(signal, new Set(["definitionId", "weight"]), `${path}.targetSelectionSignals[${signalIndex}]`, errors);
        });
        if (isPlainObject(definition.reverse)) {
          validateUnknownFields(definition.reverse, new Set(["label", "description", "userIntents", "targetSelectionSignals"]), `${path}.reverse`, errors);
          if (Array.isArray(definition.reverse.targetSelectionSignals)) definition.reverse.targetSelectionSignals.forEach((signal, signalIndex) => {
            if (isPlainObject(signal)) validateUnknownFields(signal, new Set(["definitionId", "weight"]), `${path}.reverse.targetSelectionSignals[${signalIndex}]`, errors);
          });
        }
        if (isPlainObject(definition.validationRules)) validateUnknownFields(definition.validationRules, new Set(["allowMultiple", "targetRequired"]), `${path}.validationRules`, errors);
      }
    });
  };
  inspectDefinitions("subjectClasses", baseAllowed);
  inspectDefinitions("relationTypes", relationAllowed);
  inspectDefinitions("durationTypes", durationAllowed);
  inspectDefinitions("languageLevels", languageAllowed);
  inspectDefinitions("presentationAspects", baseAllowed);
  inspectDefinitions("selectionSignals", baseAllowed);
  return errors;
}

function validateNamespaceRevisionSnapshot(snapshot = {}, { requireCoreScales = true } = {}) {
  const errors = [];
  validateDefinitionCollection(snapshot.subjectClasses || [], "subjectClasses", errors);
  validateDurationTypes(snapshot.durationTypes || [], errors);
  validateLanguageLevels(snapshot.languageLevels || [], errors);
  validateDefinitionCollection(snapshot.presentationAspects || [], "presentationAspects", errors);
  validateDefinitionCollection(snapshot.selectionSignals || [], "selectionSignals", errors);
  validateRelationTypes(snapshot.relationTypes || [], snapshot.subjectClasses || [], snapshot.selectionSignals || [], errors);
  validateDefinitionIdsAreUnique(snapshot, errors);
  if (requireCoreScales && !(snapshot.durationTypes || []).length) pushError(errors, "durationTypes", "EMPTY_ARRAY", "Almeno un DurationType e obbligatorio per pubblicare il Namespace");
  if (requireCoreScales && !(snapshot.languageLevels || []).length) pushError(errors, "languageLevels", "EMPTY_ARRAY", "Almeno un LanguageLevel e obbligatorio per pubblicare il Namespace");
  return errors;
}

function normalizeNamespaceMetadataPayload(payload = {}) {
  const normalized = {};
  if (hasOwn(payload, "name")) normalized.name = trimIfString(payload.name);
  if (hasOwn(payload, "description")) normalized.description = trimIfString(payload.description);
  if (hasOwn(payload, "ownerType")) normalized.ownerType = normalizeKey(payload.ownerType);
  if (hasOwn(payload, "ownerId")) normalized.ownerId = payload.ownerId;
  return normalized;
}

function validateNamespaceMetadataPayload(payload = {}, { creating = false } = {}) {
  const errors = [];
  if (!isPlainObject(payload)) {
    pushError(errors, "namespace", "INVALID_TYPE", "Namespace deve essere un oggetto");
    return errors;
  }
  const allowed = creating ? new Set(["name", "description", "ownerType", "ownerId", "revision"]) : new Set(["name", "description"]);
  validateUnknownFields(payload, allowed, "", errors);
  if (creating || hasOwn(payload, "name")) {
    if (!payload.name || typeof payload.name !== "string" || !payload.name.trim()) pushError(errors, "name", "REQUIRED", "name e obbligatorio");
  }
  if (hasOwn(payload, "description") && payload.description !== null && typeof payload.description !== "string") pushError(errors, "description", "INVALID_TYPE", "description deve essere una stringa o null");
  if (creating) {
    if (!OWNER_TYPES.includes(payload.ownerType)) pushError(errors, "ownerType", "INVALID_ENUM", "ownerType non valido", { allowedValues: OWNER_TYPES });
    if (!payload.ownerId) pushError(errors, "ownerId", "REQUIRED", "ownerId e obbligatorio");
    else if (!validateObjectId(payload.ownerId)) pushError(errors, "ownerId", "INVALID_OBJECT_ID", "ownerId non e un ObjectId valido");
  }
  return errors;
}

module.exports = {
  MATCH_TYPES,
  RELATION_CATEGORIES,
  RELATION_DIRECTIONS,
  RELATION_STRENGTHS,
  DEFINITION_FIELDS,
  normalizeNamespaceMetadataPayload,
  validateNamespaceMetadataPayload,
  normalizeNamespaceRevisionPayload,
  validateNamespaceRevisionUnknownFields,
  validateNamespaceRevisionSnapshot,
};
