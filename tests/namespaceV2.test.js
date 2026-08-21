const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("crypto");

const {
  ensureDefinitionIds,
  regenerateDefinitionIdsForFork,
} = require("../services/namespaceDefinitionIdentity.service");
const {
  normalizeNamespaceRevisionPayload,
  validateNamespaceRevisionUnknownFields,
  validateNamespaceRevisionSnapshot,
} = require("../services/validation/namespace.validation");

function validCoreSnapshot(overrides = {}) {
  const subjectId = randomUUID();
  return {
    subjectClasses: [{ definitionId: subjectId, key: "artwork", label: "Opera", semanticRefs: [] }],
    relationTypes: [],
    durationTypes: [{ definitionId: randomUUID(), key: "short", label: "Breve", targetSeconds: 15, semanticRefs: [] }],
    languageLevels: [{ definitionId: randomUUID(), key: "simple", label: "Semplice", semanticRefs: [] }],
    presentationAspects: [],
    selectionSignals: [],
    ...overrides,
  };
}

test("Namespace definition identity viene generata solo quando manca", () => {
  const existingId = randomUUID();
  const prepared = ensureDefinitionIds({
    subjectClasses: [
      { definitionId: existingId, key: "artwork", label: "Opera" },
      { key: "person", label: "Persona" },
    ],
  });
  assert.equal(prepared.subjectClasses[0].definitionId, existingId);
  assert.match(prepared.subjectClasses[1].definitionId, /^[0-9a-f-]{36}$/i);
  assert.notEqual(prepared.subjectClasses[1].definitionId, existingId);
});

test("fork Namespace rigenera le identity e rimappa domain/range delle relation", () => {
  const artworkId = randomUUID();
  const personId = randomUUID();
  const relationId = randomUUID();
  const source = validCoreSnapshot({
    subjectClasses: [
      { definitionId: artworkId, key: "artwork", label: "Opera", semanticRefs: [] },
      { definitionId: personId, key: "person", label: "Persona", semanticRefs: [] },
    ],
    relationTypes: [{
      definitionId: relationId,
      key: "created_by",
      label: "Creato da",
      domainDefinitionIds: [artworkId],
      rangeDefinitionIds: [personId],
      category: "semantic",
      strength: "strong",
      userIntents: [],
      directionality: "directed",
      reverse: { userIntents: [] },
      validationRules: { allowMultiple: true, targetRequired: true },
      semanticRefs: [],
    }],
  });

  const { snapshot } = regenerateDefinitionIdsForFork(source);
  assert.notEqual(snapshot.subjectClasses[0].definitionId, artworkId);
  assert.notEqual(snapshot.subjectClasses[1].definitionId, personId);
  assert.notEqual(snapshot.relationTypes[0].definitionId, relationId);
  assert.equal(snapshot.relationTypes[0].domainDefinitionIds[0], snapshot.subjectClasses[0].definitionId);
  assert.equal(snapshot.relationTypes[0].rangeDefinitionIds[0], snapshot.subjectClasses[1].definitionId);
});

test("RelationType domain/range referenziano SubjectClassDefinition identity", () => {
  const artworkId = randomUUID();
  const unknownId = randomUUID();
  const snapshot = validCoreSnapshot({
    subjectClasses: [{ definitionId: artworkId, key: "artwork", label: "Opera", semanticRefs: [] }],
    relationTypes: [{
      definitionId: randomUUID(),
      key: "created_by",
      label: "Creato da",
      domainDefinitionIds: [artworkId],
      rangeDefinitionIds: [unknownId],
      category: "semantic",
      strength: "medium",
      userIntents: [],
      directionality: "directed",
      reverse: { userIntents: [] },
      validationRules: { allowMultiple: true, targetRequired: true },
      semanticRefs: [],
    }],
  });
  const issues = validateNamespaceRevisionSnapshot(snapshot);
  assert.ok(issues.some((issue) => issue.code === "UNKNOWN_SUBJECT_CLASS"));
});

test("definitionId deve essere univoco anche tra famiglie differenti", () => {
  const sharedId = randomUUID();
  const snapshot = validCoreSnapshot({
    subjectClasses: [{ definitionId: sharedId, key: "artwork", label: "Opera", semanticRefs: [] }],
    presentationAspects: [{ definitionId: sharedId, key: "narrative", label: "Narrativo", semanticRefs: [] }],
  });
  const issues = validateNamespaceRevisionSnapshot(snapshot);
  assert.ok(issues.some((issue) => issue.code === "DUPLICATE_DEFINITION_ID"));
});

test("DurationType e LanguageLevel sono scale ordinate e obbligatorie in pubblicazione", () => {
  const missing = validCoreSnapshot({ durationTypes: [], languageLevels: [] });
  const missingIssues = validateNamespaceRevisionSnapshot(missing, { requireCoreScales: true });
  assert.ok(missingIssues.some((issue) => issue.field === "durationTypes" && issue.code === "EMPTY_ARRAY"));
  assert.ok(missingIssues.some((issue) => issue.field === "languageLevels" && issue.code === "EMPTY_ARRAY"));

  const nonIncreasing = validCoreSnapshot({
    durationTypes: [
      { definitionId: randomUUID(), key: "medium", label: "Medio", targetSeconds: 40, semanticRefs: [] },
      { definitionId: randomUUID(), key: "short", label: "Breve", targetSeconds: 15, semanticRefs: [] },
    ],
  });
  const orderIssues = validateNamespaceRevisionSnapshot(nonIncreasing);
  assert.ok(orderIssues.some((issue) => issue.code === "NON_INCREASING_TARGET_SECONDS"));
});

test("payload Namespace rifiuta campi non appartenenti al contratto", () => {
  const raw = {
    subjectClasses: [{ definitionId: randomUUID(), key: "artwork", label: "Opera", capabilities: ["navigation_target"] }],
  };
  const unknown = validateNamespaceRevisionUnknownFields(raw);
  assert.ok(unknown.some((issue) => issue.code === "UNKNOWN_FIELD" && issue.field.endsWith("capabilities")));

  const normalized = normalizeNamespaceRevisionPayload(raw);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.subjectClasses[0], "capabilities"), false);
});
