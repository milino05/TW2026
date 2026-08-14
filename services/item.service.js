const Item = require("../models/item.model");
const ItemRevision = require("../models/itemRevision.model");
const SemanticEdge = require("../models/semanticEdge.model");
const VisitRevision = require("../models/visitRevision.model");
const User = require("../models/user");
const AppError = require("../utils/AppError");
const { getMuseumVocabulary } = require("./museumVocabulary.service");
const { assertMuseumRole, hasMuseumRole } = require("./museumAuthorization.service");
const { normalizeItemPayload, validateItemDraftPayload } = require("./validation/item.validation");
const { normalizeSemanticEdges, validateSemanticEdges } = require("./validation/semanticEdge.validation");
const { markRevisionEdited } = require("./revisionWorkflow.service");
const { invalidateVisitsUsingItem } = require("./visitDependency.service");
const { getEdgesForRevision, replaceEdgesForRevision, cloneEdgesForRevision, deleteEdgesForItemRevisions } = require("./semanticEdge.service");

const REVISION_FIELDS = ["label", "recognitionImage", "tags", "metadata", "semanticRefs", "selectionSignals", "presentationVariants", "defaultPresentation", "jsonld"];
function hasOwn(object, key) { return Object.prototype.hasOwnProperty.call(object || {}, key); }
function rejectManagedFields(payload = {}) {
  const forbidden = ["status", "integrity", "review", "publication", "version", "itemId", "representations"];
  const errors = forbidden.filter((field) => hasOwn(payload, field)).map((field) => ({ field, code: field === "representations" ? "REMOVED_FIELD" : "FORBIDDEN_FIELD", message: field === "representations" ? "representations non e piu un campo diretto: usare presentationVariants" : `${field} e gestito dal backend` }));
  if (hasOwn(payload, "relations")) errors.push({ field: "relations", code: "REMOVED_FIELD", message: "relations non e piu embedded in ItemRevision: usare semanticEdges" });
  if (hasOwn(payload, "relationCommands")) errors.push({ field: "relationCommands", code: "REMOVED_FIELD", message: "Le relazioni si modificano tramite semanticEdges" });
  if (errors.length) throw new AppError("Payload non valido", 400, errors);
}
function normalizeSelectionSignals(values) { if (!Array.isArray(values)) return values; return values.map((signal) => signal && typeof signal === "object" ? { key: String(signal.key || "").trim().toLowerCase(), weight: signal.weight === undefined ? 1 : Number(signal.weight) } : signal); }
function normalizedPayload(payload) { const normalized = normalizeItemPayload(payload); if (hasOwn(payload, "selectionSignals")) normalized.selectionSignals = normalizeSelectionSignals(payload.selectionSignals); if (hasOwn(payload, "semanticEdges")) normalized.semanticEdges = normalizeSemanticEdges(payload.semanticEdges); return normalized; }
function revisionSnapshot(revision) { const source = revision?.toObject ? revision.toObject() : revision || {}; return Object.fromEntries(REVISION_FIELDS.map((field) => [field, source[field]])); }
function mergeRevisionPayload(revision, rawPayload, normalized) { const source = revisionSnapshot(revision); for (const field of REVISION_FIELDS) if (hasOwn(rawPayload, field)) source[field] = normalized[field]; return source; }
async function findItemOrFail({ museumId, itemId, includeTrashed = false }) { const query = { _id: itemId, museumId }; if (!includeTrashed) query.lifecycleStatus = "active"; const item = await Item.findOne(query); if (!item) throw new AppError("Item non trovato", 404); return item; }
async function nextVersion(itemId) { const latest = await ItemRevision.findOne({ itemId }).sort({ version: -1 }).select("version").lean(); return (latest?.version || 0) + 1; }
async function createWorkingRevisionFromPublished(item, actorUserId) {
  if (!item.publishedRevisionId) throw new AppError("Nessuna revisione pubblicata da clonare", 409);
  const published = await ItemRevision.findById(item.publishedRevisionId); if (!published) throw new AppError("Revisione pubblicata non trovata", 409);
  const revision = await ItemRevision.create({ itemId: item._id, version: await nextVersion(item._id), basedOnRevisionId: published._id, ...revisionSnapshot(published), status: "draft", integrity: { status: "needs_review", issues: [] }, review: {}, publication: {}, createdBy: actorUserId, updatedBy: actorUserId });
  try { await cloneEdgesForRevision({ fromRevisionId: published._id, toRevisionId: revision._id, sourceItemId: item._id, museumId: item.museumId }); } catch (error) { await revision.deleteOne().catch(() => {}); throw error; }
  item.workingRevisionId = revision._id; await item.save(); return revision;
}
async function getWorkingRevision(item, actorUserId, { createFromPublished = true } = {}) { if (item.workingRevisionId) { const revision = await ItemRevision.findById(item.workingRevisionId); if (!revision) throw new AppError("Revisione di lavoro non trovata", 409); return revision; } if (createFromPublished && item.publishedRevisionId) return createWorkingRevisionFromPublished(item, actorUserId); throw new AppError("L'item non ha una revisione di lavoro", 409); }
async function validateDraft({ museumId, itemId = null, itemType, payload, vocabulary, mode, semanticEdges }) {
  const errors = await validateItemDraftPayload({ museumId, itemId, itemType, payload, vocabulary, mode });
  if (semanticEdges !== undefined) await validateSemanticEdges({ museumId, itemType, itemId, edges: semanticEdges, vocabulary, errors });
  if (Array.isArray(payload.selectionSignals)) { const keys = new Set((vocabulary.selectionSignals || []).map((entry) => entry.key)), seen = new Set(); payload.selectionSignals.forEach((signal, index) => { const path = `selectionSignals[${index}]`; if (!signal || typeof signal !== "object" || !keys.has(signal.key)) errors.push({ field: `${path}.key`, code: "UNKNOWN_SELECTION_SIGNAL", message: `SelectionSignal non presente nel vocabolario: ${signal?.key || ""}` }); if (seen.has(signal?.key)) errors.push({ field: `${path}.key`, code: "DUPLICATE_KEY", message: "SelectionSignal duplicato" }); seen.add(signal?.key); if (!Number.isFinite(signal?.weight) || signal.weight < 0 || signal.weight > 1) errors.push({ field: `${path}.weight`, code: "INVALID_NUMBER", message: "weight deve essere tra 0 e 1" }); }); }
  return errors;
}
async function createItem({ museumId, payload, userId }) {
  await assertMuseumRole({ userId, museumId, minimumRole: "operator" }); rejectManagedFields(payload); const vocabulary = await getMuseumVocabulary(museumId); const normalized = normalizedPayload(payload);
  const errors = await validateDraft({ museumId, itemType: normalized.itemType, payload: normalized, semanticEdges: normalized.semanticEdges || [], vocabulary, mode: "create" }); if (errors.length) throw new AppError("Payload non valido", 400, errors);
  const item = await Item.create({ externalId: normalized.externalId, museumId, itemType: normalized.itemType, createdBy: userId });
  try {
    const revisionData = Object.fromEntries(REVISION_FIELDS.filter((field) => normalized[field] !== undefined).map((field) => [field, normalized[field]]));
    const revision = await ItemRevision.create({ itemId: item._id, version: 1, ...revisionData, status: "draft", integrity: { status: "needs_review", issues: [] }, createdBy: userId, updatedBy: userId });
    await replaceEdgesForRevision({ museumId, sourceItemId: item._id, sourceItemRevisionId: revision._id, edges: normalized.semanticEdges || [] });
    item.workingRevisionId = revision._id; await item.save(); return { item, revision, semanticEdges: await getEdgesForRevision(revision._id) };
  } catch (error) { await deleteEdgesForItemRevisions(item._id).catch(() => {}); await ItemRevision.deleteMany({ itemId: item._id }).catch(() => {}); await item.deleteOne().catch(() => {}); throw error; }
}
async function updateItem({ museumId, itemId, payload, userId }) {
  await assertMuseumRole({ userId, museumId, minimumRole: "operator" }); rejectManagedFields(payload); const item = await findItemOrFail({ museumId, itemId }); const revision = await getWorkingRevision(item, userId);
  try { markRevisionEdited(revision, userId); } catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); }
  const normalized = normalizedPayload(payload); if (item.publishedRevisionId && (hasOwn(payload, "externalId") || hasOwn(payload, "itemType"))) throw new AppError("Payload non valido", 409, [{ field: hasOwn(payload, "itemType") ? "itemType" : "externalId", code: "IMMUTABLE_AFTER_PUBLICATION", message: "externalId e itemType non possono cambiare dopo la prima pubblicazione" }]);
  const effectiveItemType = hasOwn(payload, "itemType") ? normalized.itemType : item.itemType, merged = mergeRevisionPayload(revision, payload, normalized), vocabulary = await getMuseumVocabulary(museumId);
  const errors = await validateDraft({ museumId, itemId, itemType: effectiveItemType, payload: { ...merged, itemType: effectiveItemType }, semanticEdges: hasOwn(payload, "semanticEdges") ? normalized.semanticEdges : undefined, vocabulary, mode: "create" }); if (errors.length) throw new AppError("Payload non valido", 400, errors);
  if (hasOwn(payload, "externalId")) item.externalId = normalized.externalId; if (hasOwn(payload, "itemType")) item.itemType = normalized.itemType; Object.assign(revision, merged); revision.updatedBy = userId;
  await Promise.all([revision.save(), item.save()]);
  if (hasOwn(payload, "semanticEdges")) await replaceEdgesForRevision({ museumId, sourceItemId: item._id, sourceItemRevisionId: revision._id, edges: normalized.semanticEdges });
  return { item, revision, semanticEdges: await getEdgesForRevision(revision._id) };
}
async function actorCanManage(actorUserId, museumId) { if (!actorUserId) return false; const user = await User.findOne({ _id: actorUserId, status: "active" }).lean(); return Boolean(user && hasMuseumRole(user, museumId, "operator")); }
async function getItemById({ museumId, itemId, actorUserId = null, view = "published" }) { const item = await findItemOrFail({ museumId, itemId, includeTrashed: view === "working" }); const canManage = await actorCanManage(actorUserId, museumId); if (view === "working" && !canManage) throw new AppError("Accesso alla revisione di lavoro non autorizzato", 403); const revisionId = view === "working" && item.workingRevisionId ? item.workingRevisionId : item.publishedRevisionId; if (!revisionId) throw new AppError("Nessuna revisione disponibile", 404); const revision = await ItemRevision.findById(revisionId); if (!revision) throw new AppError("Revisione non trovata", 404); if (!canManage && revision.integrity.status !== "valid") throw new AppError("Item non disponibile", 404); return { item, revision, semanticEdges: await getEdgesForRevision(revisionId) }; }
async function listItems({ museumId, filters = {}, actorUserId = null, view = "published" }) { const canManage = await actorCanManage(actorUserId, museumId); if (view === "working" && !canManage) throw new AppError("Accesso alle bozze non autorizzato", 403); const query = { museumId }; if (!canManage || !filters.includeTrashed) query.lifecycleStatus = "active"; if (filters.itemType) query.itemType = filters.itemType; const items = await Item.find(query).sort({ updatedAt: -1 }).lean(), results = []; for (const item of items) { const revisionId = view === "working" && item.workingRevisionId ? item.workingRevisionId : item.publishedRevisionId; if (!revisionId) continue; const revision = await ItemRevision.findById(revisionId).lean(); if (!revision) continue; if (filters.status && revision.status !== filters.status) continue; if (filters.integrity && revision.integrity?.status !== filters.integrity) continue; if (!canManage && revision.integrity?.status !== "valid") continue; results.push({ item, revision, semanticEdges: await getEdgesForRevision(revisionId) }); } return results; }
async function trashItem({ museumId, itemId, userId }) { await assertMuseumRole({ userId, museumId, minimumRole: "operator" }); const item = await findItemOrFail({ museumId, itemId }); item.lifecycleStatus = "trashed"; item.trashedAt = new Date(); item.trashedBy = userId; await item.save(); await invalidateVisitsUsingItem({ itemId: item._id, code: "VISIT_ITEM_TRASHED", message: "Un item della visita e stato spostato nel cestino", blocking: true }); return item; }
async function restoreItem({ museumId, itemId, userId }) { await assertMuseumRole({ userId, museumId, minimumRole: "manager" }); const item = await findItemOrFail({ museumId, itemId, includeTrashed: true }); item.lifecycleStatus = "active"; item.trashedAt = null; item.trashedBy = null; await item.save(); return item; }
async function hardDeleteItem({ museumId, itemId, userId }) { await assertMuseumRole({ userId, museumId, minimumRole: "manager" }); const item = await findItemOrFail({ museumId, itemId, includeTrashed: true }); if (item.lifecycleStatus !== "trashed") throw new AppError("L'item deve essere nel cestino prima della cancellazione definitiva", 409); const [visitDependency, edgeDependency, focusDependency] = await Promise.all([VisitRevision.exists({ "contentEntries.itemId": item._id }), SemanticEdge.exists({ targetItemId: item._id }), ItemRevision.exists({ "presentationVariants.semanticFocus.itemId": item._id })]); if (visitDependency || edgeDependency || focusDependency) throw new AppError("Impossibile eliminare definitivamente: esistono dipendenze attive", 409); await deleteEdgesForItemRevisions(item._id); await ItemRevision.deleteMany({ itemId: item._id }); await item.deleteOne(); return item; }
module.exports = { REVISION_FIELDS, findItemOrFail, getWorkingRevision, createItem, updateItem, listItems, getItemById, trashItem, restoreItem, hardDeleteItem };
