const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const UserSubjectAffinity = require("../models/userSubjectAffinity.model");
const UserSubjectKnowledge = require("../models/userSubjectKnowledge.model");
const UserItemEditionAffinity = require("../models/userItemEditionAffinity.model");
const UserContentExposureV2 = require("../models/userContentExposureV2.model");
const UserNamespaceFeatureAffinity = require("../models/userNamespaceFeatureAffinity.model");
const VenueTargetObservationProfile = require("../models/venueTargetObservationProfile.model");
const { candidateNovelty, effectiveAffinity, NAMESPACE_FEATURE_GROUPS } = require("../services/learningV2.service");

test("learning v2 schemas keep semantic, editorial, namespace and physical scopes separate", () => {
  assert.ok(UserSubjectAffinity.schema.path("subjectId"));
  assert.ok(UserSubjectKnowledge.schema.path("subjectId"));
  assert.ok(UserItemEditionAffinity.schema.path("itemEditionId"));
  assert.ok(UserContentExposureV2.schema.path("itemEditionId"));
  assert.ok(UserNamespaceFeatureAffinity.schema.path("namespaceId"));
  assert.ok(UserNamespaceFeatureAffinity.schema.path("definitionId"));
  assert.ok(VenueTargetObservationProfile.schema.path("venueTargetId"));

  for (const model of [UserSubjectAffinity, UserSubjectKnowledge, UserItemEditionAffinity, UserContentExposureV2, UserNamespaceFeatureAffinity, VenueTargetObservationProfile]) {
    assert.equal(model.schema.path("museumId"), undefined);
    assert.equal(model.schema.path("itemType"), undefined);
  }
  assert.deepEqual(Object.keys(NAMESPACE_FEATURE_GROUPS).sort(), ["presentation_aspect", "relation_type", "selection_signal", "subject_class"]);
});

test("candidate novelty is edition-scoped and representation-aware", () => {
  const editionId = new mongoose.Types.ObjectId();
  const variantId = new mongoose.Types.ObjectId();
  const representationId = new mongoose.Types.ObjectId();
  const state = { exposuresByEdition: new Map() };
  assert.deepEqual(candidateNovelty(state, { itemEditionId: editionId, variantId, representationId }), { score: 1, reason: "new_edition" });

  state.exposuresByEdition.set(String(editionId), [{
    itemEditionId: editionId,
    variantId,
    representationId,
  }]);
  assert.deepEqual(candidateNovelty(state, { itemEditionId: editionId, variantId: new mongoose.Types.ObjectId(), representationId }), { score: 0.7, reason: "new_variant" });
  assert.deepEqual(candidateNovelty(state, { itemEditionId: editionId, variantId, representationId: new mongoose.Types.ObjectId() }), { score: 0.3, reason: "new_representation" });
  assert.deepEqual(candidateNovelty(state, { itemEditionId: editionId, variantId, representationId }), { score: 0.05, reason: "familiar_content" });
});

test("effective affinity applies confidence and recency decay", () => {
  const now = new Date("2026-08-21T12:00:00Z");
  const fresh = effectiveAffinity({ value: 1, confidence: 0.8, lastObservedAt: now }, now);
  const old = effectiveAffinity({ value: 1, confidence: 0.8, lastObservedAt: new Date("2026-02-22T12:00:00Z") }, now);
  assert.equal(fresh, 0.8);
  assert.ok(old > 0 && old < fresh);
});
