const mongoose = require("mongoose");
const EditorialContext = require("../models/editorialContext.model");
const CollectionItemMembership = require("../models/collectionItemMembership.model");
const EditorialContextRevision = require("../models/editorialContextRevision.model");
const SemanticGraph = require("../models/semanticGraph.model");
const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemV2 = require("../models/itemV2.model");
const AppError = require("../utils/AppError");
const { findContentSpaceOrFail, assertCanManageContentSpace } = require("./contentSpace.service");
const { assertCanUseNamespaceForEditorialContext } = require("./namespaceUsageAuthorization.service");
const { assertCanUseItemEditionForEditorialRelease } = require("./itemUsageAuthorization.service");
const { validateEditorialReleaseCoherence } = require("./editorialReleaseIntegrity.service");

function id(value) { return String(value?._id || value || ""); }
function reviewConflict() {
  return new AppError("Lo stato della raccolta è cambiato durante l'operazione", 409, [{ code: "EDITORIAL_CONTEXT_WORKING_CONFLICT" }]);
}
function requiredMessage(value) {
  const message = String(value || "").trim();
  if (!message) throw new AppError("La motivazione delle modifiche richieste è obbligatoria", 400, [{ field: "message", code: "REQUIRED" }]);
  if (message.length > 2000) throw new AppError("La motivazione è troppo lunga", 400, [{ field: "message", code: "MAX_LENGTH", max: 2000 }]);
  return message;
}
function issue(field, code, message, context = null) {
  return { field, code, message, ...(context ? { context } : {}) };
}

async function loadContextAndSpace({ editorialContextId, actorUserId, permissionCode }) {
  const context = await EditorialContext.findOne({ _id: editorialContextId, lifecycleStatus: "active" });
  if (!context) throw new AppError("Raccolta editoriale non trovata", 404);
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId: context.contentSpaceId });
  await assertCanManageContentSpace(contentSpace, actorUserId, permissionCode);
  return { context, contentSpace };
}

async function buildWorkingSnapshot({ context, contentSpace, actorUserId }) {
  const issues = [];
  const namespace = await Namespace.findOne({ _id: context.namespaceId, lifecycleStatus: "active" });
  if (!namespace) {
    return { issues: [issue("namespaceId", "NAMESPACE_NOT_AVAILABLE", "Le regole editoriali della raccolta non sono disponibili")], snapshot: null };
  }

  let namespaceRevisionId = null;
  try {
    const access = await assertCanUseNamespaceForEditorialContext({
      namespace,
      actorUserId,
      principalType: contentSpace.ownerType,
      principalId: contentSpace.ownerId,
    });
    const ref = access?.resolvedSnapshotRef;
    if (ref?.resourceType === "namespace_revision") namespaceRevisionId = ref.resourceId;
    else issues.push(issue("namespaceRevisionId", "AUTHORIZED_NAMESPACE_REVISION_REQUIRED", "Le regole editoriali non hanno una versione pubblicata utilizzabile"));
  } catch (error) {
    if ([403, 404, 409].includes(error?.status)) issues.push(issue("namespaceRevisionId", "NAMESPACE_NOT_AUTHORIZED", error.message));
    else throw error;
  }

  if (namespaceRevisionId) {
    const revision = await NamespaceRevision.findOne({
      _id: namespaceRevisionId,
      namespaceId: namespace._id,
      status: { $in: ["published", "superseded"] },
      "integrity.status": "valid",
    }).select("_id").lean();
    if (!revision) issues.push(issue("namespaceRevisionId", "NAMESPACE_REVISION_NOT_RELEASE_READY", "La versione delle regole editoriali non è pronta per una raccolta pubblicabile"));
  }

  const semanticGraph = await SemanticGraph.findOne({ _id: context.semanticGraphId, lifecycleStatus: "active" }).lean();
  if (!semanticGraph) issues.push(issue("semanticGraphId", "SEMANTIC_GRAPH_NOT_AVAILABLE", "Il grafo semantico della raccolta non è disponibile"));
  else if (id(semanticGraph.namespaceId) !== id(context.namespaceId)) issues.push(issue("semanticGraphId", "SEMANTIC_GRAPH_NAMESPACE_MISMATCH", "Il grafo semantico usa regole editoriali diverse"));
  const graphRevisionId = semanticGraph?.workingRevisionId || null;
  if (!graphRevisionId) issues.push(issue("graphRevisionId", "WORKING_GRAPH_REVISION_REQUIRED", "Definisci una revisione del grafo semantico prima della revisione"));

  const itemMemberships = await CollectionItemMembership.find({ editorialContextId: context._id }).sort({ createdAt: 1, _id: 1 }).lean();
  if (!itemMemberships.length) issues.push(issue("itemBindings", "EDITORIAL_CONTEXT_EMPTY", "Aggiungi almeno un contenuto alla raccolta prima della revisione"));

  const itemBindings = [];
  for (const [index, membership] of itemMemberships.entries()) {
    const item = await ItemV2.findOne({ _id: membership.itemId, lifecycleStatus: "active" }).select("_id primarySubjectId").lean();
    if (!item) {
      issues.push(issue(`itemBindings[${index}].itemId`, "ITEM_NOT_ACTIVE", "Il contenuto selezionato non è più disponibile", { itemId: membership.itemId }));
      continue;
    }
    const edition = await ItemEdition.findOne({ itemId: item._id, namespaceId: context.namespaceId }).select("_id").lean();
    if (!edition) {
      issues.push(issue(`itemBindings[${index}].itemEditionId`, "ITEM_EDITION_REQUIRED", "Il contenuto non ha ancora una versione compatibile con le regole editoriali della raccolta", { itemId: item._id, namespaceId: context.namespaceId }));
      continue;
    }
    try {
      const usage = await assertCanUseItemEditionForEditorialRelease({
        itemEditionId: edition._id,
        actorUserId,
        principalType: contentSpace.ownerType,
        principalId: contentSpace.ownerId,
      });
      const ref = usage.access?.resolvedSnapshotRef;
      if (ref?.resourceType !== "item_revision") {
        issues.push(issue(`itemBindings[${index}].itemRevisionId`, "ITEM_REVISION_NOT_RELEASE_READY", "Il contenuto non ha una versione pubblicata utilizzabile", { itemId: item._id, itemEditionId: edition._id }));
        continue;
      }
      itemBindings.push({
        itemId: item._id,
        itemEditionId: edition._id,
        itemRevisionId: ref.resourceId,
        curationSignals: (membership.curationSignals || []).map((signal) => ({ definitionId: signal.definitionId, weight: signal.weight })),
      });
    } catch (error) {
      if ([403, 404, 409].includes(error?.status)) {
        issues.push(issue(`itemBindings[${index}].itemEditionId`, "ITEM_NOT_AUTHORIZED_FOR_RELEASE", error.message, { itemId: item._id, itemEditionId: edition._id }));
      } else throw error;
    }
  }

  if (namespaceRevisionId && graphRevisionId && itemBindings.length === itemMemberships.length) {
    const coherence = await validateEditorialReleaseCoherence({
      editorialContextId: context._id,
      namespaceRevisionId,
      graphRevisionId,
      itemBindings,
    });
    issues.push(...coherence);
  }

  return {
    issues,
    snapshot: {
      namespaceRevisionId,
      semanticGraphId: semanticGraph?._id || null,
      graphRevisionId,
      itemBindings,
    },
  };
}

async function checkEditorialContextReadiness({ editorialContextId, actorUserId, permissionCode = "editorial_context.view" }) {
  const { context, contentSpace } = await loadContextAndSpace({ editorialContextId, actorUserId, permissionCode });
  const result = await buildWorkingSnapshot({ context, contentSpace, actorUserId });
  return {
    context: {
      id: context._id,
      name: context.displayName,
      workingVersion: Number(context.workingVersion || 0),
      semanticGraphId: context.semanticGraphId,
      workingGraphRevisionId: result.snapshot?.graphRevisionId || null,
      activeReviewRevisionId: context.activeReviewRevisionId || null,
    },
    ready: result.issues.length === 0,
    issues: result.issues,
    snapshot: result.issues.length ? null : result.snapshot,
  };
}

async function nextRevisionVersion(editorialContextId, session) {
  const latest = await EditorialContextRevision.findOne({ editorialContextId }).sort({ version: -1 }).select("_id version").session(session).lean();
  return { version: (latest?.version || 0) + 1, basedOnRevisionId: latest?._id || null };
}

async function requestEditorialContextReview({ editorialContextId, actorUserId }) {
  const { context, contentSpace } = await loadContextAndSpace({ editorialContextId, actorUserId, permissionCode: "editorial_context.edit" });
  if (context.activeReviewRevisionId) throw new AppError("La raccolta ha già una revisione attiva", 409, [{ code: "EDITORIAL_CONTEXT_REVIEW_ALREADY_ACTIVE" }]);
  const readiness = await buildWorkingSnapshot({ context, contentSpace, actorUserId });
  if (readiness.issues.length) throw new AppError("La raccolta non è pronta per la revisione", 409, readiness.issues);
  const expectedWorkingVersion = Number(context.workingVersion || 0);
  let created = null;
  try {
    await mongoose.connection.transaction(async (session) => {
      const current = await EditorialContext.findOne({ _id: context._id, lifecycleStatus: "active" }).session(session);
      if (!current || current.activeReviewRevisionId || Number(current.workingVersion || 0) !== expectedWorkingVersion) throw reviewConflict();
      const lineage = await nextRevisionVersion(current._id, session);
      const now = new Date();
      [created] = await EditorialContextRevision.create([{
        editorialContextId: current._id,
        version: lineage.version,
        basedOnRevisionId: lineage.basedOnRevisionId,
        sourceWorkingVersion: expectedWorkingVersion,
        displayName: current.displayName,
        shortDescription: current.shortDescription || null,
        description: current.description || null,
        namespaceRevisionId: readiness.snapshot.namespaceRevisionId,
        graphRevisionId: readiness.snapshot.graphRevisionId,
        itemBindings: readiness.snapshot.itemBindings,
        integrity: { status: "valid", issues: [], checkedAt: now, checkedBy: actorUserId },
        status: "in_review",
        review: {
          requestedAt: now,
          requestedBy: actorUserId,
          decision: "pending",
          events: [{ action: "review_requested", actorUserId, at: now }],
        },
        createdBy: actorUserId,
      }], { session });
      const pointer = await EditorialContext.updateOne({
        _id: current._id,
        lifecycleStatus: "active",
        activeReviewRevisionId: null,
        workingVersion: expectedWorkingVersion,
      }, { $set: { activeReviewRevisionId: created._id } }, { session });
      if (pointer.modifiedCount !== 1) throw reviewConflict();
    });
    return created;
  } catch (error) {
    if (error?.code === 11000) throw reviewConflict();
    throw error;
  }
}

async function loadActiveRevision({ editorialContextId, revisionId, actorUserId, permissionCode, session = null }) {
  const contextQuery = EditorialContext.findOne({ _id: editorialContextId, lifecycleStatus: "active" });
  if (session) contextQuery.session(session);
  const context = await contextQuery;
  if (!context) throw new AppError("Raccolta editoriale non trovata", 404);
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId: context.contentSpaceId });
  await assertCanManageContentSpace(contentSpace, actorUserId, permissionCode);
  const resolvedRevisionId = revisionId || context.activeReviewRevisionId;
  if (!resolvedRevisionId || id(context.activeReviewRevisionId) !== id(resolvedRevisionId)) {
    throw new AppError("Revisione attiva non trovata", 404, [{ code: "EDITORIAL_CONTEXT_ACTIVE_REVIEW_NOT_FOUND" }]);
  }
  const revisionQuery = EditorialContextRevision.findOne({ _id: resolvedRevisionId, editorialContextId: context._id });
  if (session) revisionQuery.session(session);
  const revision = await revisionQuery;
  if (!revision) throw new AppError("Revisione della raccolta non trovata", 404);
  return { context, contentSpace, revision };
}

async function withdrawEditorialContextReview({ editorialContextId, revisionId = null, actorUserId }) {
  let result = null;
  await mongoose.connection.transaction(async (session) => {
    const { context, revision } = await loadActiveRevision({ editorialContextId, revisionId, actorUserId, permissionCode: "editorial_context.edit", session });
    if (revision.status !== "in_review") throw new AppError("Solo una revisione in corso può essere ritirata", 409, [{ code: "INVALID_REVIEW_TRANSITION" }]);
    const now = new Date();
    revision.status = "withdrawn";
    revision.review.decision = "withdrawn";
    revision.review.reviewedAt = now;
    revision.review.reviewedBy = actorUserId;
    revision.review.events.push({ action: "review_withdrawn", actorUserId, at: now });
    await revision.save({ session });
    context.activeReviewRevisionId = null;
    await context.save({ session });
    result = revision;
  });
  return result;
}

async function requestEditorialContextChanges({ editorialContextId, revisionId = null, message, actorUserId }) {
  const normalizedMessage = requiredMessage(message);
  let result = null;
  await mongoose.connection.transaction(async (session) => {
    const { context, revision } = await loadActiveRevision({ editorialContextId, revisionId, actorUserId, permissionCode: "editorial_context.review", session });
    if (revision.status !== "in_review") throw new AppError("Solo una revisione in corso può ricevere richieste di modifica", 409, [{ code: "INVALID_REVIEW_TRANSITION" }]);
    const now = new Date();
    revision.status = "changes_requested";
    revision.review.decision = "changes_requested";
    revision.review.reviewedAt = now;
    revision.review.reviewedBy = actorUserId;
    revision.review.message = normalizedMessage;
    revision.review.events.push({ action: "changes_requested", actorUserId, at: now, message: normalizedMessage });
    await revision.save({ session });
    context.activeReviewRevisionId = null;
    await context.save({ session });
    result = revision;
  });
  return result;
}

async function approveEditorialContextReview({ editorialContextId, revisionId = null, actorUserId }) {
  let result = null;
  await mongoose.connection.transaction(async (session) => {
    const { revision } = await loadActiveRevision({ editorialContextId, revisionId, actorUserId, permissionCode: "editorial_context.review", session });
    if (revision.status !== "in_review") throw new AppError("Solo una revisione in corso può essere approvata", 409, [{ code: "INVALID_REVIEW_TRANSITION" }]);
    const now = new Date();
    revision.status = "approved";
    revision.review.decision = "approved";
    revision.review.reviewedAt = now;
    revision.review.reviewedBy = actorUserId;
    revision.review.message = null;
    revision.review.events.push({ action: "approved", actorUserId, at: now });
    await revision.save({ session });
    result = revision;
  });
  return result;
}

async function listEditorialContextRevisions({ editorialContextId, actorUserId }) {
  const { context } = await loadContextAndSpace({ editorialContextId, actorUserId, permissionCode: "editorial_context.view" });
  return EditorialContextRevision.find({ editorialContextId: context._id }).sort({ version: -1, createdAt: -1 });
}

module.exports = {
  buildWorkingSnapshot,
  checkEditorialContextReadiness,
  requestEditorialContextReview,
  withdrawEditorialContextReview,
  requestEditorialContextChanges,
  approveEditorialContextReview,
  listEditorialContextRevisions,
};