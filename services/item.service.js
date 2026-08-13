const Item = require("../models/item.model");
const ItemRevision = require("../models/itemRevision.model");
const VisitRevision = require("../models/visitRevision.model");
const User = require("../models/user");
const AppError = require("../utils/AppError");
const { getMuseumVocabulary } = require("./museumVocabulary.service");
const { assertMuseumRole, hasMuseumRole } = require("./museumAuthorization.service");
const { normalizeItemPayload, validateItemDraftPayload } = require("./validation/item.validation");
const { markRevisionEdited } = require("./revisionWorkflow.service");
const { invalidateVisitsUsingItem } = require("./visitDependency.service");

const REVISION_FIELDS = [
  "label", "recognitionImage", "tags", "metadata", "semanticRefs", "relations",
  "presentationVariants", "defaultPresentation", "representations", "jsonld",
];

function hasOwn(object, key) { return Object.prototype.hasOwnProperty.call(object || {}, key); }
function rejectManagedFields(payload = {}) {
  const forbidden = ["status", "integrity", "review", "publication", "version", "itemId"];
  const errors = forbidden.filter((field) => hasOwn(payload, field)).map((field) => ({ field, code: "FORBIDDEN_FIELD", message: `${field} e gestito dal backend` }));
  if (hasOwn(payload, "relationCommands")) errors.push({ field: "relationCommands", code: "REMOVED_FIELD", message: "Le relazioni si modificano tramite l'array relations della revisione" });
  if (errors.length) throw new AppError("Payload non valido", 400, errors);
}
function revisionSnapshot(revision) {
  const source = revision?.toObject ? revision.toObject() : revision || {};
  return Object.fromEntries(REVISION_FIELDS.map((field) => [field, source[field]]));
}
function mergeRevisionPayload(revision, rawPayload, normalizedPayload) {
  const source = revisionSnapshot(revision);
  for (const field of REVISION_FIELDS) if (hasOwn(rawPayload, field)) source[field] = normalizedPayload[field];
  return source;
}
async function findItemOrFail({ museumId, itemId, includeTrashed = false }) {
  const query = { _id: itemId, museumId }; if (!includeTrashed) query.lifecycleStatus = "active";
  const item = await Item.findOne(query); if (!item) throw new AppError("Item non trovato", 404); return item;
}
async function nextVersion(itemId) { const latest = await ItemRevision.findOne({ itemId }).sort({ version: -1 }).select("version").lean(); return (latest?.version || 0) + 1; }
async function createWorkingRevisionFromPublished(item, actorUserId) {
  if (!item.publishedRevisionId) throw new AppError("Nessuna revisione pubblicata da clonare", 409);
  const published = await ItemRevision.findById(item.publishedRevisionId); if (!published) throw new AppError("Revisione pubblicata non trovata", 409);
  const revision = new ItemRevision({ itemId: item._id, version: await nextVersion(item._id), basedOnRevisionId: published._id, ...revisionSnapshot(published), status: "draft", integrity: { status: "needs_review", issues: [] }, review: {}, publication: {}, createdBy: actorUserId, updatedBy: actorUserId });
  await revision.save(); item.workingRevisionId = revision._id; await item.save(); return revision;
}
async function getWorkingRevision(item, actorUserId, { createFromPublished = true } = {}) {
  if (item.workingRevisionId) { const revision = await ItemRevision.findById(item.workingRevisionId); if (!revision) throw new AppError("Revisione di lavoro non trovata", 409); return revision; }
  if (createFromPublished && item.publishedRevisionId) return createWorkingRevisionFromPublished(item, actorUserId);
  throw new AppError("L'item non ha una revisione di lavoro", 409);
}

async function createItem({ museumId, payload, userId }) {
  await assertMuseumRole({ userId, museumId, minimumRole: "operator" }); rejectManagedFields(payload);
  const vocabulary = await getMuseumVocabulary(museumId); const normalized = normalizeItemPayload(payload);
  const errors = await validateItemDraftPayload({ museumId, itemType: normalized.itemType, payload: normalized, vocabulary, mode: "create" });
  if (errors.length) throw new AppError("Payload non valido", 400, errors);
  const item = new Item({ externalId: normalized.externalId, museumId, itemType: normalized.itemType, createdBy: userId }); await item.save();
  try {
    const revisionData = Object.fromEntries(REVISION_FIELDS.filter((field) => normalized[field] !== undefined).map((field) => [field, normalized[field]]));
    const revision = new ItemRevision({ itemId: item._id, version: 1, ...revisionData, status: "draft", integrity: { status: "needs_review", issues: [] }, createdBy: userId, updatedBy: userId });
    await revision.save(); item.workingRevisionId = revision._id; await item.save(); return { item, revision };
  } catch (error) { await item.deleteOne().catch(() => {}); throw error; }
}

async function updateItem({ museumId, itemId, payload, userId }) {
  await assertMuseumRole({ userId, museumId, minimumRole: "operator" }); rejectManagedFields(payload);
  const item = await findItemOrFail({ museumId, itemId }); const revision = await getWorkingRevision(item, userId);
  try { markRevisionEdited(revision, userId); } catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); }
  const normalized = normalizeItemPayload(payload);
  if (item.publishedRevisionId && (hasOwn(payload, "externalId") || hasOwn(payload, "itemType"))) throw new AppError("Payload non valido", 409, [{ field: hasOwn(payload, "itemType") ? "itemType" : "externalId", code: "IMMUTABLE_AFTER_PUBLICATION", message: "externalId e itemType non possono cambiare dopo la prima pubblicazione" }]);
  const effectiveItemType = hasOwn(payload, "itemType") ? normalized.itemType : item.itemType;
  const merged = mergeRevisionPayload(revision, payload, normalized);
  const vocabulary = await getMuseumVocabulary(museumId);
  const errors = await validateItemDraftPayload({ museumId, itemId, itemType: effectiveItemType, payload: { ...merged, itemType: effectiveItemType }, vocabulary, mode: "create" });
  if (errors.length) throw new AppError("Payload non valido", 400, errors);
  if (hasOwn(payload, "externalId")) item.externalId = normalized.externalId;
  if (hasOwn(payload, "itemType")) item.itemType = normalized.itemType;
  Object.assign(revision, merged); revision.updatedBy = userId; await Promise.all([revision.save(), item.save()]); return { item, revision };
}

async function actorCanManage(actorUserId, museumId) {
  if (!actorUserId) return false; const user = await User.findOne({ _id: actorUserId, status: "active" }).lean(); return Boolean(user && hasMuseumRole(user, museumId, "operator"));
}
async function getItemById({ museumId, itemId, actorUserId = null, view = "published" }) {
  const item = await findItemOrFail({ museumId, itemId, includeTrashed: view === "working" }); const canManage = await actorCanManage(actorUserId, museumId);
  if (view === "working" && !canManage) throw new AppError("Accesso alla revisione di lavoro non autorizzato", 403);
  const revisionId = view === "working" && item.workingRevisionId ? item.workingRevisionId : item.publishedRevisionId; if (!revisionId) throw new AppError("Nessuna revisione disponibile", 404);
  const revision = await ItemRevision.findById(revisionId); if (!revision) throw new AppError("Revisione non trovata", 404); if (!canManage && revision.integrity.status !== "valid") throw new AppError("Item non disponibile", 404); return { item, revision };
}
async function listItems({ museumId, filters = {}, actorUserId = null, view = "published" }) {
  const canManage = await actorCanManage(actorUserId, museumId); if (view === "working" && !canManage) throw new AppError("Accesso alle bozze non autorizzato", 403);
  const query = { museumId }; if (!canManage || !filters.includeTrashed) query.lifecycleStatus = "active"; if (filters.itemType) query.itemType = filters.itemType;
  const items = await Item.find(query).sort({ updatedAt: -1 }).lean(); const results = [];
  for (const item of items) { const revisionId = view === "working" && item.workingRevisionId ? item.workingRevisionId : item.publishedRevisionId; if (!revisionId) continue; const revision = await ItemRevision.findById(revisionId).lean(); if (!revision) continue; if (filters.status && revision.status !== filters.status) continue; if (filters.integrity && revision.integrity?.status !== filters.integrity) continue; if (!canManage && revision.integrity?.status !== "valid") continue; results.push({ item, revision }); }
  return results;
}
async function trashItem({ museumId, itemId, userId }) { await assertMuseumRole({ userId, museumId, minimumRole: "operator" }); const item = await findItemOrFail({ museumId, itemId }); item.lifecycleStatus = "trashed"; item.trashedAt = new Date(); item.trashedBy = userId; await item.save(); await invalidateVisitsUsingItem({ itemId: item._id, code: "VISIT_ITEM_TRASHED", message: "Un item della visita e stato spostato nel cestino", blocking: true }); return item; }
async function restoreItem({ museumId, itemId, userId }) { await assertMuseumRole({ userId, museumId, minimumRole: "manager" }); const item = await findItemOrFail({ museumId, itemId, includeTrashed: true }); item.lifecycleStatus = "active"; item.trashedAt = null; item.trashedBy = null; await item.save(); return item; }
async function hardDeleteItem({ museumId, itemId, userId }) {
  await assertMuseumRole({ userId, museumId, minimumRole: "manager" }); const item = await findItemOrFail({ museumId, itemId, includeTrashed: true }); if (item.lifecycleStatus !== "trashed") throw new AppError("L'item deve essere nel cestino prima della cancellazione definitiva", 409);
  const [visitDependency, relationDependency, focusDependency] = await Promise.all([VisitRevision.exists({ "stops.itemId": item._id }), ItemRevision.exists({ "relations.target": item._id }), ItemRevision.exists({ "presentationVariants.semanticFocus.itemId": item._id })]);
  if (visitDependency || relationDependency || focusDependency) throw new AppError("Impossibile eliminare definitivamente: esistono dipendenze attive", 409);
  await ItemRevision.deleteMany({ itemId: item._id }); await item.deleteOne(); return item;
}

module.exports = { REVISION_FIELDS, findItemOrFail, getWorkingRevision, createItem, updateItem, listItems, getItemById, trashItem, restoreItem, hardDeleteItem };
