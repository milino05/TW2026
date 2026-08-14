const Museum = require("../models/museum.model");
const MuseumVocabulary = require("../models/museumVocabulary.model");
const MuseumVocabularyRevision = require("../models/museumVocabularyRevision.model");
const Item = require("../models/item.model");
const ItemRevision = require("../models/itemRevision.model");
const Visit = require("../models/visit");
const VisitRevision = require("../models/visitRevision.model");
const AppError = require("../utils/AppError");
const { assertMuseumRole } = require("./museumAuthorization.service");
const { auditItemsAfterMuseumConfigChange } = require("./itemIntegrity.service");
const { invalidateVisitsUsingMuseumVocabulary } = require("./visitDependency.service");
const { markRevisionEdited, requestReview, withdrawReview, requestChanges, markPublished } = require("./revisionWorkflow.service");
const { materializeVocabulary } = require("./museumVocabulary.service");
const { normalizeVocabularyPayload, validateVocabularyPayload } = require("./validation/vocabulary.validation");

const FIELDS = ["languageLevels", "durationTypes", "itemTypes", "relationTypes", "presentationAspects", "selectionSignals"];
const EMPTY_VOCABULARY = Object.freeze(Object.fromEntries(FIELDS.map((field) => [field, []])));
function plain(value) { return value?.toObject ? value.toObject() : value; }
function snapshot(revision) { const source = plain(revision) || {}; return Object.fromEntries(FIELDS.map((field) => [field, source[field] || []])); }
function hasOwn(value, key) { return Object.prototype.hasOwnProperty.call(value || {}, key); }
function mergePayload(revision, rawPayload, normalizedPayload) { const merged = snapshot(revision); for (const field of FIELDS) if (hasOwn(rawPayload, field)) merged[field] = normalizedPayload[field]; return merged; }
async function nextVersion(vocabularyId) { const latest = await MuseumVocabularyRevision.findOne({ vocabularyId }).sort({ version: -1 }).select("version").lean(); return (latest?.version || 0) + 1; }
async function loadStableOrFail(museumId) { const stable = await MuseumVocabulary.findOne({ museumId }); if (!stable) throw new AppError("Vocabolario semantico non inizializzato", 404); return stable; }

async function createInitialVocabularyForMuseum({ museumId, actorUserId, initialPayload = null }) {
  if (await MuseumVocabulary.exists({ museumId })) throw new AppError("Il museo possiede gia un vocabolario semantico", 409);
  if (!(await Museum.exists({ _id: museumId }))) throw new AppError("Museo non trovato", 404);
  const normalized = initialPayload ? { ...EMPTY_VOCABULARY, ...normalizeVocabularyPayload(initialPayload) } : { ...EMPTY_VOCABULARY };
  const stable = await MuseumVocabulary.create({ museumId, createdBy: actorUserId });
  try {
    const revision = await MuseumVocabularyRevision.create({ vocabularyId: stable._id, museumId, version: 1, ...normalized, status: "draft", integrity: { status: "needs_review", issues: [] }, review: {}, publication: {}, createdBy: actorUserId, updatedBy: actorUserId });
    stable.workingRevisionId = revision._id; await stable.save(); return { stable, revision };
  } catch (error) { await stable.deleteOne().catch(() => {}); throw error; }
}
async function createWorkingFromPublished(stable, userId) {
  if (!stable.publishedRevisionId) throw new AppError("Nessuna revisione pubblicata da clonare", 409);
  const published = await MuseumVocabularyRevision.findById(stable.publishedRevisionId); if (!published) throw new AppError("Revisione pubblicata del vocabolario non trovata", 409);
  const revision = await MuseumVocabularyRevision.create({ vocabularyId: stable._id, museumId: stable.museumId, version: await nextVersion(stable._id), basedOnRevisionId: published._id, ...snapshot(published), status: "draft", integrity: { status: "needs_review", issues: [] }, review: {}, publication: {}, createdBy: userId, updatedBy: userId });
  stable.workingRevisionId = revision._id; await stable.save(); return revision;
}
async function getWorking(stable, userId, create = true) { if (stable.workingRevisionId) { const revision = await MuseumVocabularyRevision.findById(stable.workingRevisionId); if (!revision) throw new AppError("Revisione di lavoro del vocabolario non trovata", 409); return revision; } if (!create) throw new AppError("Nessuna revisione di lavoro del vocabolario", 404); return createWorkingFromPublished(stable, userId); }
async function getVocabularyRevision({ museumId, userId = null, view = "published" }) {
  if (!(await Museum.exists({ _id: museumId }))) throw new AppError("Museo non trovato", 404);
  const stable = await loadStableOrFail(museumId); if (view === "working") await assertMuseumRole({ userId, museumId, minimumRole: "operator" });
  const revisionId = view === "working" ? stable.workingRevisionId || (await createWorkingFromPublished(stable, userId))._id : stable.publishedRevisionId;
  if (!revisionId) throw new AppError("Vocabolario semantico pubblicato non disponibile", 404);
  const revision = await MuseumVocabularyRevision.findById(revisionId); if (!revision) throw new AppError("Revisione del vocabolario non trovata", 404);
  return { stable, revision, vocabulary: materializeVocabulary({ museumId, version: revision.version, revisionId: revision._id, source: revision }) };
}
async function updateVocabularyDraft({ museumId, payload, userId }) {
  await assertMuseumRole({ userId, museumId, minimumRole: "operator" }); const stable = await loadStableOrFail(museumId); const revision = await getWorking(stable, userId);
  try { markRevisionEdited(revision, userId); } catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); }
  Object.assign(revision, mergePayload(revision, payload || {}, normalizeVocabularyPayload(payload || {}))); revision.updatedBy = userId; await revision.save(); return { stable, revision };
}
function removedKeys(previous = [], next = []) { const nextSet = new Set(next.map((entry) => entry.key)); return previous.map((entry) => entry.key).filter((key) => !nextSet.has(key)); }
async function dependencyIssues({ museumId, published, working }) {
  if (!published) return [];
  const removed = Object.fromEntries(FIELDS.filter((field) => !["languageLevels", "durationTypes"].includes(field) || true).map((field) => [field, removedKeys(published[field] || [], working[field] || [])]));
  if (Object.values(removed).every((values) => !values.length)) return [];
  const statuses = ["draft", "in_review", "changes_requested", "published"];
  const [itemIds, visitIds] = await Promise.all([Item.find({ museumId, lifecycleStatus: "active" }).distinct("_id"), Visit.find({ ownerMuseumId: museumId, lifecycleStatus: "active" }).distinct("_id")]);
  const [variantLanguages, variantDurations, relationKeys, aspectKeys, signalKeys, itemTypes, visitLanguages, visitDurations] = await Promise.all([
    ItemRevision.find({ itemId: { $in: itemIds }, status: { $in: statuses } }).distinct("presentationVariants.representations.languageLevelKey"),
    ItemRevision.find({ itemId: { $in: itemIds }, status: { $in: statuses } }).distinct("presentationVariants.representations.durationKey"),
    ItemRevision.find({ itemId: { $in: itemIds }, status: { $in: statuses } }).distinct("relations.relationTypeKey"),
    ItemRevision.find({ itemId: { $in: itemIds }, status: { $in: statuses } }).distinct("presentationVariants.presentationAspects.key"),
    ItemRevision.find({ itemId: { $in: itemIds }, status: { $in: statuses } }).distinct("selectionSignals.key"),
    Item.find({ museumId, lifecycleStatus: "active" }).distinct("itemType"),
    VisitRevision.find({ visitId: { $in: visitIds }, status: { $in: statuses } }).distinct("defaultPresentationPolicy.languageLevelKey"),
    VisitRevision.find({ visitId: { $in: visitIds }, status: { $in: statuses } }).distinct("defaultPresentationPolicy.durationKey"),
  ]);
  const used = { languageLevels: new Set([...variantLanguages, ...visitLanguages]), durationTypes: new Set([...variantDurations, ...visitDurations]), itemTypes: new Set(itemTypes), relationTypes: new Set(relationKeys), presentationAspects: new Set(aspectKeys), selectionSignals: new Set(signalKeys) };
  const issues = [];
  for (const [group, keys] of Object.entries(removed)) for (const key of keys) if (used[group]?.has(key)) issues.push({ field: group, code: "VOCABULARY_KEY_IN_USE", severity: "error", message: `La chiave ${key} e ancora utilizzata da contenuti attivi`, context: { group, key } });
  return issues;
}
async function evaluateVocabulary({ museumId, userId, allowInReview = false }) {
  await assertMuseumRole({ userId, museumId, minimumRole: "operator" }); const stable = await loadStableOrFail(museumId); const revision = await getWorking(stable, userId, false);
  if (revision.status === "in_review" && !allowInReview) throw new AppError("Una revisione in_review e bloccata", 409);
  const schemaIssues = validateVocabularyPayload(snapshot(revision)).map((issue) => ({ ...issue, severity: "error" }));
  const published = stable.publishedRevisionId ? await MuseumVocabularyRevision.findById(stable.publishedRevisionId).lean() : null;
  const issues = [...schemaIssues, ...(await dependencyIssues({ museumId, published, working: revision.toObject() }))];
  revision.integrity = { status: issues.some((issue) => issue.severity !== "warning") ? "needs_review" : "valid", issues, checkedAt: new Date(), checkedBy: userId }; await revision.save(); return { stable, revision, issues };
}
async function requestVocabularyReview({ museumId, userId }) { const result = await evaluateVocabulary({ museumId, userId }); if (result.issues.some((issue) => issue.severity !== "warning")) throw new AppError("Il vocabolario contiene problemi bloccanti", 400, result.issues); try { requestReview(result.revision, userId); } catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); } await result.revision.save(); return result; }
async function withdrawVocabularyReview({ museumId, userId }) { await assertMuseumRole({ userId, museumId, minimumRole: "operator" }); const stable = await loadStableOrFail(museumId); const revision = await getWorking(stable, userId, false); try { withdrawReview(revision, userId); } catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); } await revision.save(); return { stable, revision }; }
async function requestVocabularyChanges({ museumId, userId, message }) { await assertMuseumRole({ userId, museumId, minimumRole: "manager" }); const stable = await loadStableOrFail(museumId); const revision = await getWorking(stable, userId, false); try { requestChanges(revision, userId, message); } catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); } await revision.save(); return { stable, revision }; }
async function publishVocabulary({ museumId, userId }) {
  await assertMuseumRole({ userId, museumId, minimumRole: "manager" }); const result = await evaluateVocabulary({ museumId, userId, allowInReview: true }); if (result.issues.some((issue) => issue.severity !== "warning")) throw new AppError("Impossibile pubblicare il vocabolario", 400, result.issues);
  const { stable, revision } = result, previousId = stable.publishedRevisionId; try { markPublished(revision, userId); } catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); } await revision.save();
  const pointer = await MuseumVocabulary.updateOne({ _id: stable._id, workingRevisionId: revision._id }, { $set: { publishedRevisionId: revision._id, workingRevisionId: null } }); if (pointer.modifiedCount !== 1) throw new AppError("Il vocabolario di lavoro e cambiato durante la pubblicazione", 409);
  if (previousId) await MuseumVocabularyRevision.updateOne({ _id: previousId, status: "published" }, { $set: { status: "superseded" } });
  const vocabulary = materializeVocabulary({ museumId, version: revision.version, revisionId: revision._id, source: revision });
  const [itemAudit, visitAudit] = await Promise.all([auditItemsAfterMuseumConfigChange({ museumId, vocabulary }), invalidateVisitsUsingMuseumVocabulary({ museumId, vocabularyRevision: revision.version })]);
  return { stable: await MuseumVocabulary.findById(stable._id), revision, audit: { itemAudit, visitAudit } };
}
async function deleteVocabularyForMuseum({ museumId }) { const stable = await MuseumVocabulary.findOne({ museumId }).lean(); if (!stable) return { deletedRevisionCount: 0 }; const result = await MuseumVocabularyRevision.deleteMany({ vocabularyId: stable._id }); await MuseumVocabulary.deleteOne({ _id: stable._id }); return { deletedRevisionCount: result.deletedCount || 0 }; }
module.exports = { createInitialVocabularyForMuseum, getVocabularyRevision, updateVocabularyDraft, evaluateVocabulary, requestVocabularyReview, withdrawVocabularyReview, requestVocabularyChanges, publishVocabulary, deleteVocabularyForMuseum };
