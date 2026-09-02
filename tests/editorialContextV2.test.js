const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const ContentSpace = require("../models/contentSpace.model");
const ContentSpaceMembership = require("../models/contentSpaceMembership.model");
const EditorialContext = require("../models/editorialContext.model");
const { normalizeContentSpacePayload, validateContentSpacePayload } = require("../services/validation/contentSpace.validation");
const { normalizeEditorialContextPayload, validateEditorialContextPayload } = require("../services/validation/editorialContext.validation");
const { buildEditorialContextSummary } = require("../services/editorialContextProjection.service");

function id() { return new mongoose.Types.ObjectId(); }

test("ContentSpace is owner-scoped but Namespace-neutral", () => {
  const doc = new ContentSpace({ name: "Collezione", ownerType: "user", ownerId: id(), createdBy: id() });
  assert.equal(doc.namespaceId, undefined);
  assert.equal(doc.venueId, undefined);
  assert.equal(doc.parentContentSpaceId, undefined);
});

test("ContentSpaceMembership is non-owning Item membership", () => {
  const membership = new ContentSpaceMembership({ contentSpaceId: id(), itemId: id(), addedBy: id() });
  assert.ok(membership.contentSpaceId);
  assert.ok(membership.itemId);
  assert.equal(membership.ownerId, undefined);
  assert.equal(ContentSpaceMembership.schema.path("itemId").options.ref, "ItemV2");
  assert.equal(ContentSpaceMembership.schema.indexes().some(([keys, options]) => keys.contentSpaceId === 1 && keys.itemId === 1 && options.unique), true);
});

test("EditorialContext materializes a collection over ContentSpace and Namespace while referencing a reusable SemanticGraph", () => {
  const semanticGraphId = id();
  const context = new EditorialContext({
    contentSpaceId: id(),
    namespaceId: id(),
    semanticGraphId,
    displayName: "Approccio storico",
    createdBy: id(),
  });
  assert.equal(String(context.semanticGraphId), String(semanticGraphId));
  assert.equal(EditorialContext.schema.path("semanticGraphId").options.ref, "SemanticGraph");
  assert.equal(context.ownerType, undefined);
  assert.equal(context.ownerId, undefined);
  assert.equal(context.venueId, undefined);
  assert.equal(context.durationTypeDefinitionId, undefined);
  assert.equal(context.languageLevelDefinitionId, undefined);
  assert.equal(EditorialContext.schema.indexes().some(([keys, options]) => keys.contentSpaceId === 1 && keys.namespaceId === 1 && options.unique), false);
  assert.equal(EditorialContext.schema.indexes().some(([keys]) => keys.semanticGraphId === 1 && keys.lifecycleStatus === 1), true);
});

test("ContentSpace payload validation keeps ownership immutable after creation", () => {
  const raw = { name: "  Ricerca  ", description: "  Appunti  ", ownerType: "user", ownerId: String(id()) };
  const normalized = normalizeContentSpacePayload(raw);
  assert.equal(normalized.name, "Ricerca");
  assert.deepEqual(validateContentSpacePayload({ payload: normalized, rawPayload: raw, creating: true }), []);
  const issues = validateContentSpacePayload({ payload: normalizeContentSpacePayload({ ownerId: String(id()) }), rawPayload: { ownerId: String(id()) }, creating: false });
  assert.ok(issues.some((issue) => issue.code === "UNKNOWN_FIELD" && issue.field === "ownerId"));
});

test("EditorialContext payload validation does not accept presentation or ownership axes", () => {
  const raw = { contentSpaceId: String(id()), namespaceId: String(id()), displayName: "  Storico  ", durationKey: "long" };
  const normalized = normalizeEditorialContextPayload(raw);
  const issues = validateEditorialContextPayload({ payload: normalized, rawPayload: raw, creating: true });
  assert.equal(normalized.displayName, "Storico");
  assert.ok(issues.some((issue) => issue.code === "UNKNOWN_FIELD" && issue.field === "durationKey"));
});

test("EditorialContextSummary exposes user-facing source identity without technical pairing", () => {
  const context = { _id: id(), displayName: "Approfondimento storico", shortDescription: "Lettura storico-artistica" };
  const contentSpace = { _id: id(), name: "Collezione permanente" };
  const namespace = { _id: id(), name: "Schema storico-artistico" };
  const curator = { id: id(), displayName: "Museo" };
  const summary = buildEditorialContextSummary({ editorialContext: context, contentSpace, namespace, curator });
  assert.equal(summary.name, "Approfondimento storico");
  assert.equal(summary.contentSpace.name, "Collezione permanente");
  assert.equal(summary.namespace.name, "Schema storico-artistico");
  assert.deepEqual(summary.stats, { availableItemCount: 0, subjectCount: 0 });
  assert.equal(summary.ownerId, undefined);
});
