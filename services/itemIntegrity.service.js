const Item = require("../models/item.model");
const ItemRevision = require("../models/itemRevision.model");
const AppError = require("../utils/AppError");
const { getMuseumVocabulary } = require("./museumVocabulary.service");
const { computeItemIntegrityIssues } = require("./validation/itemIntegrity.validation");
const { assertMuseumRole } = require("./museumAuthorization.service");
const { getRevisionSemanticEdges } = require("./semanticEdge.service");
const { invalidateMuseumSemanticGraphCache } = require("./semanticGraph.service");
const { bumpPublishedGraphEpoch } = require("./semanticGraphState.service");
const { requestReview, withdrawReview, requestChanges, markPublished } = require("./revisionWorkflow.service");
const { auditVisitsUsingPublishedItem, invalidateVisitsUsingItem } = require("./visitDependency.service");

async function loadItemAndWorking({ museumId, itemId }) { const item = await Item.findOne({ _id: itemId, museumId, lifecycleStatus: "active" }); if (!item) throw new AppError("Item non trovato", 404); if (!item.workingRevisionId) throw new AppError("L'Item non ha una revisione di lavoro", 409); const revision = await ItemRevision.findById(item.workingRevisionId); if (!revision) throw new AppError("Revisione di lavoro non trovata", 409); return { item, revision }; }
async function evaluateItemConsistency({ museumId, itemId, userId, allowInReview = false }) { const { item, revision } = await loadItemAndWorking({ museumId, itemId }); if (revision.status === "in_review" && !allowInReview) throw new AppError("Una revisione in_review e bloccata; ritirare prima la richiesta", 409); const [vocabulary, semanticEdges] = await Promise.all([getMuseumVocabulary(museumId), getRevisionSemanticEdges(revision._id)]); const issues = await computeItemIntegrityIssues({ item: item.toObject(), revision: revision.toObject(), semanticEdges, museumId, vocabulary }); revision.integrity = { status: issues.some((issue) => issue.severity !== "warning") ? "needs_review" : "valid", issues, checkedAt: new Date(), checkedBy: userId }; revision.updatedBy = userId; await revision.save(); return { item, revision, semanticEdges, issues, integrity: revision.integrity }; }
async function checkItemConsistency({ museumId, itemId, userId }) { await assertMuseumRole({ userId, museumId, minimumRole: "operator" }); return evaluateItemConsistency({ museumId, itemId, userId, allowInReview: false }); }
async function requestItemReview({ museumId, itemId, userId }) { const consistency = await checkItemConsistency({ museumId, itemId, userId }); if (consistency.issues.some((issue) => issue.severity !== "warning")) throw new AppError("Impossibile richiedere la revisione con problemi di integrita", 400, consistency.issues); try { requestReview(consistency.revision, userId); } catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); } await consistency.revision.save(); return consistency; }
async function withdrawItemReview({ museumId, itemId, userId }) { await assertMuseumRole({ userId, museumId, minimumRole: "operator" }); const { item, revision } = await loadItemAndWorking({ museumId, itemId }); try { withdrawReview(revision, userId); } catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); } await revision.save(); return { item, revision, semanticEdges: await getRevisionSemanticEdges(revision._id) }; }
async function requestItemChanges({ museumId, itemId, userId, message }) { await assertMuseumRole({ userId, museumId, minimumRole: "manager" }); const { item, revision } = await loadItemAndWorking({ museumId, itemId }); try { requestChanges(revision, userId, message); } catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); } await revision.save(); return { item, revision, semanticEdges: await getRevisionSemanticEdges(revision._id) }; }

async function compensateFailedItemPublish({ item, revision, previousPublishedId, previousRevisionState }) {
  const pointerRollback = await Item.updateOne(
    { _id: item._id, publishedRevisionId: revision._id, workingRevisionId: null },
    { $set: { publishedRevisionId: previousPublishedId || null, workingRevisionId: revision._id } },
  );
  if (pointerRollback.modifiedCount !== 1) throw new Error("Impossibile ripristinare i pointer Item dopo il fallimento della pubblicazione");
  revision.status = previousRevisionState.status;
  revision.review = previousRevisionState.review;
  revision.publication = previousRevisionState.publication;
  await revision.save();
  if (previousPublishedId) await ItemRevision.updateOne({ _id: previousPublishedId, status: "superseded" }, { $set: { status: "published" } });
  invalidateMuseumSemanticGraphCache(item.museumId);
}

async function publishItem({ museumId, itemId, userId }) {
  await assertMuseumRole({ userId, museumId, minimumRole: "manager" });
  const consistency = await evaluateItemConsistency({ museumId, itemId, userId, allowInReview: true });
  if (consistency.issues.some((issue) => issue.severity !== "warning")) throw new AppError("Impossibile pubblicare un Item con problemi di integrita", 400, consistency.issues);
  const { item, revision, semanticEdges } = consistency, previousPublishedId = item.publishedRevisionId;
  const previousRevisionState = { status: revision.status, review: revision.review?.toObject ? revision.review.toObject() : { ...revision.review }, publication: revision.publication?.toObject ? revision.publication.toObject() : { ...revision.publication } };
  try { markPublished(revision, userId); } catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); }
  await revision.save();
  const pointerUpdate = await Item.updateOne({ _id: item._id, workingRevisionId: revision._id, lifecycleStatus: "active" }, { $set: { publishedRevisionId: revision._id, workingRevisionId: null } });
  if (pointerUpdate.modifiedCount !== 1) { revision.status = previousRevisionState.status; revision.review = previousRevisionState.review; revision.publication = previousRevisionState.publication; await revision.save(); throw new AppError("La revisione di lavoro e cambiata durante la pubblicazione", 409); }

  try {
    if (previousPublishedId) await ItemRevision.updateOne({ _id: previousPublishedId, status: "published" }, { $set: { status: "superseded" } });
    await bumpPublishedGraphEpoch(museumId);
  } catch (error) {
    try { await compensateFailedItemPublish({ item, revision, previousPublishedId, previousRevisionState }); }
    catch (rollbackError) { throw new AppError("Pubblicazione Item fallita con rollback incompleto", 500, [{ code: "ITEM_GRAPH_PUBLISH_ROLLBACK_FAILED", message: rollbackError.message }, { code: "ORIGINAL_ERROR", message: error.message }]); }
    throw new AppError("Pubblicazione Item annullata: impossibile aggiornare coerentemente il grafo pubblicato", 500, [{ code: "GRAPH_PUBLICATION_FAILED", message: error.message }]);
  }

  invalidateMuseumSemanticGraphCache(museumId);
  item.publishedRevisionId = revision._id; item.workingRevisionId = null;
  const dependencyAudit = await auditVisitsUsingPublishedItem({ item, revision });
  return { item, revision, semanticEdges, dependencyAudit };
}

async function auditItemsAfterMuseumConfigChange({ museumId, vocabulary }) {
  const items = await Item.find({ museumId, lifecycleStatus: "active" }); let checkedRevisionCount = 0, invalidRevisionCount = 0, affectedVisitCount = 0;
  for (const item of items) for (const revisionId of [item.publishedRevisionId, item.workingRevisionId].filter(Boolean)) {
    const revision = await ItemRevision.findById(revisionId); if (!revision) continue;
    const semanticEdges = await getRevisionSemanticEdges(revisionId), issues = await computeItemIntegrityIssues({ item, revision, semanticEdges, museumId, vocabulary }), blocking = issues.some((issue) => issue.severity !== "warning");
    revision.integrity = { status: blocking ? "needs_review" : "valid", issues, checkedAt: new Date(), checkedBy: null }; await revision.save(); checkedRevisionCount += 1; if (blocking) invalidRevisionCount += 1;
    if (blocking && String(item.publishedRevisionId) === String(revision._id)) { const result = await invalidateVisitsUsingItem({ itemId: item._id, code: "MUSEUM_VOCABULARY_CHANGED", message: "Il nuovo vocabolario ha reso incompatibile un Item della visita", blocking: true, context: { vocabularyRevision: vocabulary.vocabularyRevision } }); affectedVisitCount += result.affectedCount; }
  }
  invalidateMuseumSemanticGraphCache(museumId);
  return { checkedRevisionCount, invalidRevisionCount, affectedVisitCount };
}
module.exports = { checkItemConsistency, requestItemReview, withdrawItemReview, requestItemChanges, publishItem, auditItemsAfterMuseumConfigChange, compensateFailedItemPublish };
