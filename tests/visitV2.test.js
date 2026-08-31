const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { normalizeVisitV2Payload, validateVisitV2Payload } = require("../services/validation/visitV2.validation");
const { cloneDetachedVisitRevision } = require("../services/visitV2Copy.service");

function oid() { return new mongoose.Types.ObjectId(); }

test("Visit v2 validation rejects legacy coupling fields", () => {
  const raw = {
    ownerType: "user",
    ownerId: oid(),
    title: "Visita",
    museumIds: [oid()],
    contentEntries: [{
      editorialSourceId: oid(), itemId: oid(), itemEditionId: oid(), itemRevisionId: oid(), role: "core", spatialMode: "target",
    }],
  };
  const normalized = normalizeVisitV2Payload(raw);
  const issues = validateVisitV2Payload({ payload: normalized, rawPayload: raw, creating: true });
  assert.ok(issues.some((entry) => entry.field === "museumIds" && entry.code === "UNKNOWN_FIELD"));
  assert.ok(issues.some((entry) => entry.field === "contentEntries[0].spatialMode" && entry.code === "UNKNOWN_FIELD"));
});

test("Visit v2 normalizza la configurazione editoriale sincronizzata", () => {
  const raw = {
    ownerType: "user",
    ownerId: oid(),
    title: "Visita di classe",
    deliveryMode: "synchronized",
    synchronization: { joinAlias: "  Fenice   rossa  " },
    quiz: {
      questions: [{
        question: "  Chi ha realizzato l'opera?  ",
        options: ["  Leonardo  ", "Raffaello"],
        correctOptionIndex: "0",
        points: "2",
      }],
    },
  };
  const normalized = normalizeVisitV2Payload(raw);
  const issues = validateVisitV2Payload({ payload: normalized, rawPayload: raw, creating: true });
  assert.equal(issues.length, 0);
  assert.equal(normalized.deliveryMode, "synchronized");
  assert.equal(normalized.synchronization.joinAlias, "Fenice rossa");
  assert.deepEqual(normalized.quiz.questions[0], {
    question: "Chi ha realizzato l'opera?",
    options: ["Leonardo", "Raffaello"],
    correctOptionIndex: 0,
    points: 2,
  });
});

test("detached Visit copy remaps local structure and preserves immutable external pins", () => {
  const sourceId = oid();
  const anchorId = oid();
  const releaseId = oid();
  const targetId = oid();
  const itemId = oid();
  const editionId = oid();
  const revisionId = oid();
  const quizQuestionId = oid();
  const sourceRevision = {
    title: "Originale",
    description: "Descrizione",
    deliveryMode: "synchronized",
    synchronization: { joinAlias: "Fenice rossa" },
    quiz: { questions: [{ _id: quizQuestionId, question: "Domanda?", options: ["A", "B"], correctOptionIndex: 1, points: 3 }] },
    editorialSources: [{ _id: sourceId, editorialReleaseId: releaseId }],
    visitAnchors: [{ _id: anchorId, venueTargetId: targetId }],
    contentEntries: [{ _id: oid(), editorialSourceId: sourceId, itemId, itemEditionId: editionId, itemRevisionId: revisionId, deliveryAnchorId: anchorId, role: "core" }],
    presentationBaseline: { depthPreference: 0.5, languageComplexityPreference: 0.4, locale: "it-IT" },
    logistics: { preVisitNotes: ["Nota"], routeHints: [] },
  };
  const copy = cloneDetachedVisitRevision(sourceRevision, { title: "Copia" });
  assert.equal(copy.title, "Copia");
  assert.notEqual(String(copy.editorialSources[0]._id), String(sourceId));
  assert.notEqual(String(copy.visitAnchors[0]._id), String(anchorId));
  assert.equal(String(copy.editorialSources[0].editorialReleaseId), String(releaseId));
  assert.equal(String(copy.visitAnchors[0].venueTargetId), String(targetId));
  assert.equal(String(copy.contentEntries[0].itemId), String(itemId));
  assert.equal(String(copy.contentEntries[0].itemEditionId), String(editionId));
  assert.equal(String(copy.contentEntries[0].itemRevisionId), String(revisionId));
  assert.equal(String(copy.contentEntries[0].editorialSourceId), String(copy.editorialSources[0]._id));
  assert.equal(String(copy.contentEntries[0].deliveryAnchorId), String(copy.visitAnchors[0]._id));
  assert.equal(copy.deliveryMode, "synchronized");
  assert.equal(copy.synchronization.joinAlias, "Fenice rossa");
  assert.equal(copy.quiz.questions[0].question, "Domanda?");
  assert.notEqual(String(copy.quiz.questions[0]._id), String(quizQuestionId));
});

test("detached Visit copy preserva e rimappa una fonte contenuto diretta", () => {
  const contentSourceId = oid();
  const itemRevisionId = oid();
  const sourceRevision = {
    title: "Visita diretta",
    contentSources: [{ _id: contentSourceId, sourceType: "item_revision", itemRevisionId }],
    editorialSources: [],
    visitAnchors: [],
    contentEntries: [{ _id: oid(), contentSourceId, itemId: oid(), itemEditionId: oid(), itemRevisionId, role: "recommended" }],
    logistics: { preVisitNotes: [], routeHints: [] },
  };
  const copy = cloneDetachedVisitRevision(sourceRevision);
  assert.equal(copy.contentSources.length, 1);
  assert.equal(copy.contentSources[0].sourceType, "item_revision");
  assert.equal(String(copy.contentSources[0].itemRevisionId), String(itemRevisionId));
  assert.notEqual(String(copy.contentSources[0]._id), String(contentSourceId));
  assert.equal(String(copy.contentEntries[0].contentSourceId), String(copy.contentSources[0]._id));
});

test("Visit v2 allows repeated VenueTarget occurrences through distinct anchors", () => {
  const targetId = oid();
  const raw = {
    ownerType: "user",
    ownerId: oid(),
    title: "Ritorno alla stessa opera",
    visitAnchors: [{ _id: oid(), venueTargetId: targetId }, { _id: oid(), venueTargetId: targetId }],
  };
  const normalized = normalizeVisitV2Payload(raw);
  const issues = validateVisitV2Payload({ payload: normalized, rawPayload: raw, creating: true });
  assert.equal(issues.length, 0);
});
