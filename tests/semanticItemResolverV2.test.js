const test = require("node:test");
const assert = require("node:assert/strict");
const {
  effectiveSignalWeight,
  resolveCandidatesForSubject,
  resolveSemanticRelationTargets,
} = require("../services/semanticItemResolverV2.service");

const SIGNAL = Object.freeze({
  overview: "11111111-1111-4111-8111-111111111111",
  biography: "22222222-2222-4222-8222-222222222222",
  curiosity: "33333333-3333-4333-8333-333333333333",
  anecdote: "44444444-4444-4444-8444-444444444444",
});

function candidate(key, signals = [], curationSignals = []) {
  return {
    item: { _id: `item-${key}` },
    edition: { _id: `edition-${key}` },
    revision: { _id: `revision-${key}`, label: key, selectionSignals: signals },
    itemId: `item-${key}`,
    itemEditionId: `edition-${key}`,
    itemRevisionId: `revision-${key}`,
    subjectId: "leonardo",
    sourceEditorialReleaseId: "release-a",
    curationSignals,
  };
}

const authorRelation = {
  targetSelectionSignals: [
    { definitionId: SIGNAL.overview, weight: 1 },
    { definitionId: SIGNAL.biography, weight: 0.9 },
  ],
  reverse: { targetSelectionSignals: [{ definitionId: SIGNAL.overview, weight: 1 }] },
};

test("la domanda sull'autore seleziona il contenuto biografico fra più Item dello stesso Subject", () => {
  const biography = candidate("biografia", [
    { definitionId: SIGNAL.overview, weight: 1 },
    { definitionId: SIGNAL.biography, weight: 1 },
  ]);
  const curiosity = candidate("curiosita", [{ definitionId: SIGNAL.curiosity, weight: 1 }]);
  const anecdote = candidate("aneddoto", [
    { definitionId: SIGNAL.anecdote, weight: 1 },
    { definitionId: SIGNAL.curiosity, weight: 0.8 },
  ]);

  const result = resolveSemanticRelationTargets({
    relationType: authorRelation,
    targets: [{ subjectId: "leonardo", candidates: [curiosity, anecdote, biography] }],
  });

  assert.equal(result.status, "resolved");
  assert.equal(result.selected.itemRevisionId, biography.itemRevisionId);
});

test("un pareggio resta ambiguo invece di dipendere dall'ordine dell'array", () => {
  const first = candidate("prima", [{ definitionId: SIGNAL.overview, weight: 1 }]);
  const second = candidate("seconda", [{ definitionId: SIGNAL.overview, weight: 1 }]);
  const result = resolveCandidatesForSubject({
    candidates: [second, first],
    preferences: [{ definitionId: SIGNAL.overview, weight: 1 }],
  });
  assert.equal(result.status, "ambiguous");
  assert.deepEqual(result.candidates.map((entry) => entry.itemRevisionId).sort(), [first.itemRevisionId, second.itemRevisionId].sort());
});

test("più Item senza un segnale pertinente richiedono una scelta esplicita", () => {
  const result = resolveCandidatesForSubject({
    candidates: [candidate("curiosita", [{ definitionId: SIGNAL.curiosity, weight: 1 }]), candidate("aneddoto", [{ definitionId: SIGNAL.anecdote, weight: 1 }])],
    preferences: authorRelation.targetSelectionSignals,
  });
  assert.equal(result.status, "ambiguous");
  assert.equal(result.candidates.length, 2);
});

test("il ranking degli Item non elimina la cardinalità del grafo", () => {
  const leonardo = candidate("leonardo", [{ definitionId: SIGNAL.overview, weight: 1 }]);
  const verrocchio = { ...candidate("verrocchio", [{ definitionId: SIGNAL.overview, weight: 1 }]), subjectId: "verrocchio" };
  const result = resolveSemanticRelationTargets({
    relationType: authorRelation,
    targets: [
      { subjectId: "leonardo", candidates: [leonardo] },
      { subjectId: "verrocchio", candidates: [verrocchio] },
    ],
  });
  assert.equal(result.status, "ambiguous");
  assert.equal(result.targets.length, 2);
});

test("un curationSignal può rendere un Item preferibile soltanto nello specifico EditorialContext", () => {
  const generic = candidate("generico", []);
  const curated = candidate("curato", [], [{ definitionId: SIGNAL.overview, weight: 1 }]);
  assert.equal(effectiveSignalWeight(curated, SIGNAL.overview), 1);
  const result = resolveCandidatesForSubject({ candidates: [generic, curated], preferences: authorRelation.targetSelectionSignals });
  assert.equal(result.status, "resolved");
  assert.equal(result.selected.itemRevisionId, curated.itemRevisionId);
});

test("la direzione inversa usa preferenze di destinazione indipendenti", () => {
  const work = { ...candidate("opera", [{ definitionId: SIGNAL.overview, weight: 1 }]), subjectId: "opera" };
  const result = resolveSemanticRelationTargets({
    relationType: authorRelation,
    direction: "reverse",
    targets: [{ subjectId: "opera", candidates: [work] }],
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.selected.itemRevisionId, work.itemRevisionId);
});
