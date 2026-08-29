const test = require("node:test");
const assert = require("node:assert/strict");
const { validateNamespaceRevisionSnapshot } = require("../services/validation/namespace.validation");

const IDS = Object.freeze({
  work: "11111111-1111-4111-8111-111111111111",
  person: "22222222-2222-4222-8222-222222222222",
  relation: "33333333-3333-4333-8333-333333333333",
  overview: "44444444-4444-4444-8444-444444444444",
  biography: "55555555-5555-4555-8555-555555555555",
});

function snapshot(overrides = {}) {
  return {
    subjectClasses: [
      { definitionId: IDS.work, key: "opera", label: "Opera", description: "", semanticRefs: [] },
      { definitionId: IDS.person, key: "persona", label: "Persona", description: "", semanticRefs: [] },
    ],
    relationTypes: [{
      definitionId: IDS.relation,
      key: "creata-da",
      label: "Creata da",
      description: "",
      domainDefinitionIds: [IDS.work],
      rangeDefinitionIds: [IDS.person],
      category: "semantic",
      strength: "strong",
      userIntents: ["chi è l'autore"],
      targetSelectionSignals: [{ definitionId: IDS.overview, weight: 1 }, { definitionId: IDS.biography, weight: 0.9 }],
      directionality: "directed",
      reverse: {
        label: "Autore di",
        description: "",
        userIntents: ["quali opere ha realizzato"],
        targetSelectionSignals: [{ definitionId: IDS.overview, weight: 1 }],
      },
      validationRules: { allowMultiple: true, targetRequired: true },
      semanticRefs: [],
    }],
    durationTypes: [],
    languageLevels: [],
    presentationAspects: [],
    selectionSignals: [
      { definitionId: IDS.overview, key: "panoramica", label: "Panoramica", description: "", semanticRefs: [] },
      { definitionId: IDS.biography, key: "biografia", label: "Biografia", description: "", semanticRefs: [] },
    ],
    ...overrides,
  };
}

test("RelationType accetta preferenze forward e reverse verso SelectionSignal del Namespace", () => {
  assert.deepEqual(validateNamespaceRevisionSnapshot(snapshot(), { requireCoreScales: false }), []);
});

test("RelationType rifiuta un target SelectionSignal non definito nel Namespace", () => {
  const value = snapshot();
  value.relationTypes[0].targetSelectionSignals = [{ definitionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", weight: 1 }];
  const issues = validateNamespaceRevisionSnapshot(value, { requireCoreScales: false });
  assert.ok(issues.some((issue) => issue.code === "UNKNOWN_SELECTION_SIGNAL" && issue.field.includes("targetSelectionSignals")));
});

test("RelationType rifiuta preferenze duplicate e pesi fuori intervallo", () => {
  const value = snapshot();
  value.relationTypes[0].targetSelectionSignals = [
    { definitionId: IDS.overview, weight: 1 },
    { definitionId: IDS.overview, weight: 1.2 },
  ];
  const issues = validateNamespaceRevisionSnapshot(value, { requireCoreScales: false });
  assert.ok(issues.some((issue) => issue.code === "DUPLICATE_VALUE"));
  assert.ok(issues.some((issue) => issue.code === "OUT_OF_RANGE"));
});

test("anche le preferenze reverse sono validate contro SelectionSignal del Namespace", () => {
  const value = snapshot();
  value.relationTypes[0].reverse.targetSelectionSignals = [{ definitionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", weight: 1 }];
  const issues = validateNamespaceRevisionSnapshot(value, { requireCoreScales: false });
  assert.ok(issues.some((issue) => issue.code === "UNKNOWN_SELECTION_SIGNAL" && issue.field.includes("reverse.targetSelectionSignals")));
});
