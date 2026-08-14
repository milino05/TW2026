const MuseumLayout = require("../models/museumLayout.model");
const MuseumLayoutRevision = require("../models/museumLayoutRevision.model");
const Item = require("../models/item.model");
const AppError = require("../utils/AppError");
const { assertMuseumRole } = require("./museumAuthorization.service");
const { markRevisionEdited, requestReview, withdrawReview, requestChanges, markPublished } = require("./revisionWorkflow.service");
const { getCanonicalAttribute, GLOBAL_PLACE_INTENTS } = require("./routingAttributeCatalog.service");
const { propagateLayoutPublication } = require("./layoutVisitDependency.service");
const { runPostCommitAudit } = require("./postCommitAudit.service");

function duplicateKeys(values = []) { const seen = new Set(); const duplicates = new Set(); for (const entry of values) { if (!entry?.key) continue; if (seen.has(entry.key)) duplicates.add(entry.key); seen.add(entry.key); } return [...duplicates]; }
function valueMatchesDefinition(definition, value) { if (!definition) return false; if (definition.dataType === "boolean") return typeof value === "boolean"; if (definition.dataType === "number") return typeof value === "number" && Number.isFinite(value); if (definition.dataType === "string") return typeof value === "string"; if (definition.dataType === "choice") return typeof value === "string" && (definition.options || []).includes(value); return false; }
function validateAttributeBag({ values, field, target, attributeByKey, add }) { for (const [key, value] of Object.entries(values || {})) { const definition = attributeByKey.get(key); if (!definition) { add(`${field}.${key}`, "UNKNOWN_ROUTING_ATTRIBUTE", "Routing attribute non definito"); continue; } if (![target, "both"].includes(definition.appliesTo)) add(`${field}.${key}`, "ATTRIBUTE_TARGET_MISMATCH", `L'attributo ${key} non e applicabile a ${target}`); if (!valueMatchesDefinition(definition, value)) add(`${field}.${key}`, "ATTRIBUTE_VALUE_TYPE_MISMATCH", `Valore non compatibile con dataType ${definition.dataType}`); } }
function validateRequirement({ requirement, field, attributeByKey, add }) { const definition = attributeByKey.get(requirement.attributeKey); if (!definition) { add(`${field}.attributeKey`, "UNKNOWN_ROUTING_ATTRIBUTE", "Preset riferisce un attributo non definito"); return; } const numericOperators = new Set(["gte", "lte", "gt", "lt"]); if (numericOperators.has(requirement.operator) && definition.dataType !== "number") add(`${field}.operator`, "OPERATOR_TYPE_MISMATCH", "Gli operatori numerici richiedono un routingAttribute number"); if (requirement.operator !== "in" && !valueMatchesDefinition(definition, requirement.value)) add(`${field}.value`, "REQUIREMENT_VALUE_TYPE_MISMATCH", `Valore non compatibile con ${definition.dataType}`); if (requirement.operator === "in" && !Array.isArray(requirement.value)) add(`${field}.value`, "IN_REQUIRES_ARRAY", "L'operatore in richiede un array"); }
function workflowSnapshot(revision) { const source = revision?.toObject ? revision.toObject() : revision || {}; return { status: source.status, review: source.review, publication: source.publication }; }

async function computeLayoutIssues(revision, museumId) {
  const issues = []; const add = (field, code, message, severity = "error", context = {}) => issues.push({ field, code, message, severity, context });
  for (const [field, values] of [["placeTypes", revision.placeTypes], ["routingAttributes", revision.routingAttributes], ["routingPresets", revision.routingPresets], ["floors", revision.floors]]) duplicateKeys(values).forEach((key) => add(field, "DUPLICATE_KEY", `Chiave duplicata: ${key}`));
  const floorKeys = new Set((revision.floors || []).map((entry) => entry.key)); const placeTypeKeys = new Set((revision.placeTypes || []).map((entry) => entry.key)); const placeIds = new Set((revision.places || []).map((entry) => String(entry._id))); const attributeByKey = new Map((revision.routingAttributes || []).map((entry) => [entry.key, entry])); const allowedIntents = new Set(GLOBAL_PLACE_INTENTS);
  (revision.placeTypes || []).forEach((placeType, index) => (placeType.userIntents || []).forEach((intent, intentIndex) => { if (!allowedIntents.has(intent)) add(`placeTypes[${index}].userIntents[${intentIndex}]`, "UNKNOWN_PLACE_INTENT", `Intento globale non riconosciuto: ${intent}`); }));
  (revision.routingAttributes || []).forEach((attribute, index) => { if (attribute.dataType === "choice" && !(attribute.options || []).length) add(`routingAttributes[${index}].options`, "CHOICE_OPTIONS_REQUIRED", "Un attributo choice deve definire almeno una option"); if (attribute.canonicalKey) { const canonical = getCanonicalAttribute(attribute.canonicalKey); if (!canonical) add(`routingAttributes[${index}].canonicalKey`, "UNKNOWN_CANONICAL_ATTRIBUTE", "Attributo globale sconosciuto"); else { if (canonical.dataType !== attribute.dataType) add(`routingAttributes[${index}].dataType`, "CANONICAL_TYPE_MISMATCH", "Il dataType non coincide con il catalogo globale"); if (canonical.appliesTo !== "both" && attribute.appliesTo !== canonical.appliesTo) add(`routingAttributes[${index}].appliesTo`, "CANONICAL_TARGET_MISMATCH", "appliesTo non coincide con il catalogo globale"); } } });
  (revision.places || []).forEach((place, index) => { if (!floorKeys.has(place.floorKey)) add(`places[${index}].floorKey`, "UNKNOWN_FLOOR", "Piano non definito"); if (!placeTypeKeys.has(place.typeKey)) add(`places[${index}].typeKey`, "UNKNOWN_PLACE_TYPE", "PlaceType non definito"); validateAttributeBag({ values: place.attributes, field: `places[${index}].attributes`, target: "place", attributeByKey, add }); });
  const placementItems = new Set();
  for (let index = 0; index < (revision.itemPlacements || []).length; index += 1) { const placement = revision.itemPlacements[index]; if (placementItems.has(String(placement.itemId))) add(`itemPlacements[${index}].itemId`, "DUPLICATE_ITEM_PLACEMENT", "Un item puo avere un solo ItemPlacement"); placementItems.add(String(placement.itemId)); const item = await Item.findOne({ _id: placement.itemId, museumId, lifecycleStatus: "active" }).lean(); if (!item) add(`itemPlacements[${index}].itemId`, "ITEM_NOT_AVAILABLE", "Item non appartenente al museo o nel cestino"); if (!placeIds.has(String(placement.primaryPlaceId))) add(`itemPlacements[${index}].primaryPlaceId`, "UNKNOWN_PLACE", "Posizione primaria non presente nel layout"); if (!(placement.placeIds || []).some((id) => String(id) === String(placement.primaryPlaceId))) add(`itemPlacements[${index}].placeIds`, "PRIMARY_PLACE_MISSING", "primaryPlaceId deve comparire in placeIds"); (placement.placeIds || []).forEach((id) => { if (!placeIds.has(String(id))) add(`itemPlacements[${index}].placeIds`, "UNKNOWN_PLACE", "Posizione secondaria non presente nel layout"); }); }
  (revision.connections || []).forEach((connection, index) => { if (!placeIds.has(String(connection.fromPlaceId)) || !placeIds.has(String(connection.toPlaceId))) add(`connections[${index}]`, "UNKNOWN_PLACE", "Una connection riferisce un Place inesistente"); if (String(connection.fromPlaceId) === String(connection.toPlaceId)) add(`connections[${index}]`, "SELF_CONNECTION", "Una connection non puo collegare un Place a se stesso"); validateAttributeBag({ values: connection.attributes, field: `connections[${index}].attributes`, target: "connection", attributeByKey, add }); });
  (revision.routingPresets || []).forEach((preset, presetIndex) => (preset.requirements || []).forEach((requirement, requirementIndex) => validateRequirement({ requirement, field: `routingPresets[${presetIndex}].requirements[${requirementIndex}]`, attributeByKey, add })));
  return issues;
}

async function ensureLayout(museumId, actorUserId) { let layout = await MuseumLayout.findOne({ museumId }); if (layout) return layout; return MuseumLayout.create({ museumId, createdBy: actorUserId }); }
async function getWorkingRevision(layout, actorUserId) { if (layout.workingRevisionId) return MuseumLayoutRevision.findById(layout.workingRevisionId); let revision; if (layout.publishedRevisionId) { const published = await MuseumLayoutRevision.findById(layout.publishedRevisionId).lean(); revision = new MuseumLayoutRevision({ ...published, _id: undefined, version: published.version + 1, basedOnRevisionId: published._id, status: "draft", integrity: { status: "needs_review", issues: [], checkedAt: null, checkedBy: null }, review: {}, publication: {}, createdBy: actorUserId, updatedBy: actorUserId }); } else revision = new MuseumLayoutRevision({ layoutId: layout._id, version: 1, createdBy: actorUserId, updatedBy: actorUserId }); await revision.save(); layout.workingRevisionId = revision._id; await layout.save(); return revision; }
async function getLayout({ museumId, actorUserId = null, view = "published" }) { const layout = await MuseumLayout.findOne({ museumId, lifecycleStatus: "active" }); if (!layout) throw new AppError("Layout non trovato", 404); if (view === "working") { await assertMuseumRole({ userId: actorUserId, museumId, minimumRole: "operator" }); if (!layout.workingRevisionId) throw new AppError("Nessuna revisione di lavoro", 404); return { layout, revision: await MuseumLayoutRevision.findById(layout.workingRevisionId) }; } if (!layout.publishedRevisionId) throw new AppError("Layout pubblicato non disponibile", 404); return { layout, revision: await MuseumLayoutRevision.findById(layout.publishedRevisionId) }; }
async function updateLayout({ museumId, actorUserId, payload }) { await assertMuseumRole({ userId: actorUserId, museumId, minimumRole: "operator" }); const layout = await ensureLayout(museumId, actorUserId); const revision = await getWorkingRevision(layout, actorUserId); try { markRevisionEdited(revision, actorUserId); } catch (error) { throw new AppError(error.message, 409); } for (const field of ["placeTypes", "routingAttributes", "routingPresets", "floors", "places", "itemPlacements", "connections", "preVisitInformation"]) if (Object.prototype.hasOwnProperty.call(payload, field)) revision[field] = payload[field]; await revision.save(); return { layout, revision }; }
async function checkConsistency({ museumId, actorUserId }) { await assertMuseumRole({ userId: actorUserId, museumId, minimumRole: "operator" }); const layout = await ensureLayout(museumId, actorUserId); const revision = await getWorkingRevision(layout, actorUserId); const issues = await computeLayoutIssues(revision, museumId); revision.integrity = { status: issues.some((entry) => entry.severity !== "warning") ? "needs_review" : "valid", issues, checkedAt: new Date(), checkedBy: actorUserId }; await revision.save(); return { layout, revision }; }
async function submitReview({ museumId, actorUserId }) { await checkConsistency({ museumId, actorUserId }); const layout = await MuseumLayout.findOne({ museumId }); const revision = await MuseumLayoutRevision.findById(layout.workingRevisionId); try { requestReview(revision, actorUserId); } catch (error) { throw new AppError(error.message, 409); } await revision.save(); return { layout, revision }; }
async function withdraw({ museumId, actorUserId }) { await assertMuseumRole({ userId: actorUserId, museumId, minimumRole: "operator" }); const layout = await MuseumLayout.findOne({ museumId }); const revision = await MuseumLayoutRevision.findById(layout?.workingRevisionId); if (!revision) throw new AppError("Nessuna revisione di lavoro", 404); try { withdrawReview(revision, actorUserId); } catch (error) { throw new AppError(error.message, 409); } await revision.save(); return { layout, revision }; }
async function changes({ museumId, actorUserId, message }) { await assertMuseumRole({ userId: actorUserId, museumId, minimumRole: "manager" }); const layout = await MuseumLayout.findOne({ museumId }); const revision = await MuseumLayoutRevision.findById(layout?.workingRevisionId); if (!revision) throw new AppError("Nessuna revisione di lavoro", 404); try { requestChanges(revision, actorUserId, message); } catch (error) { throw new AppError(error.message, 409); } await revision.save(); return { layout, revision }; }

async function compensateLayoutPublish({ layout, revision, oldId, previousRevisionState, previousSuperseded }) {
  const pointer = await MuseumLayout.updateOne({ _id: layout._id, publishedRevisionId: revision._id, workingRevisionId: null }, { $set: { publishedRevisionId: oldId || null, workingRevisionId: revision._id } });
  let previous = { modifiedCount: 1 };
  if (oldId && previousSuperseded) previous = await MuseumLayoutRevision.updateOne({ _id: oldId, status: "superseded" }, { $set: { status: "published" } });
  await MuseumLayoutRevision.updateOne({ _id: revision._id }, { $set: previousRevisionState });
  if (pointer.modifiedCount !== 1 || previous.modifiedCount !== 1) throw new AppError("Rollback pubblicazione layout incompleto", 500, [{ code: "LAYOUT_PUBLISH_ROLLBACK_FAILED" }]);
}

async function publish({ museumId, actorUserId }) {
  await assertMuseumRole({ userId: actorUserId, museumId, minimumRole: "manager" });
  const layout = await MuseumLayout.findOne({ museumId });
  if (!layout?.workingRevisionId) throw new AppError("Nessuna revisione da pubblicare", 404);
  const revision = await MuseumLayoutRevision.findById(layout.workingRevisionId);
  const issues = await computeLayoutIssues(revision, museumId);
  revision.integrity = { status: issues.some((entry) => entry.severity !== "warning") ? "needs_review" : "valid", issues, checkedAt: new Date(), checkedBy: actorUserId };
  if (revision.integrity.status !== "valid") { await revision.save(); throw new AppError("Layout non consistente", 409, issues); }
  const oldId = layout.publishedRevisionId, previousRevisionState = workflowSnapshot(revision);
  try { markPublished(revision, actorUserId); } catch (error) { throw new AppError(error.message, 409); }
  await revision.save();
  let pointerSwitched = false, previousSuperseded = false;
  try {
    const pointer = await MuseumLayout.updateOne({ _id: layout._id, workingRevisionId: revision._id, lifecycleStatus: "active" }, { $set: { publishedRevisionId: revision._id, workingRevisionId: null } });
    if (pointer.modifiedCount !== 1) throw new AppError("La revisione di layout e cambiata durante la pubblicazione", 409);
    pointerSwitched = true;
    if (oldId) {
      const previous = await MuseumLayoutRevision.updateOne({ _id: oldId, status: "published" }, { $set: { status: "superseded" } });
      if (previous.modifiedCount !== 1) throw new Error("Impossibile supersedere il layout precedente");
      previousSuperseded = true;
    }
  } catch (error) {
    if (pointerSwitched) {
      try { await compensateLayoutPublish({ layout, revision, oldId, previousRevisionState, previousSuperseded }); }
      catch (rollbackError) { if (rollbackError instanceof AppError) throw rollbackError; throw new AppError("Rollback pubblicazione layout incompleto", 500, [{ code: "LAYOUT_PUBLISH_ROLLBACK_FAILED", message: rollbackError.message }, { code: "ORIGINAL_ERROR", message: error.message }]); }
    } else await MuseumLayoutRevision.updateOne({ _id: revision._id }, { $set: previousRevisionState }).catch(() => {});
    if (error instanceof AppError) throw error;
    throw new AppError("Pubblicazione layout annullata per errore di consistenza", 500, [{ code: "LAYOUT_PUBLISH_FAILED", message: error.message }]);
  }
  layout.publishedRevisionId = revision._id; layout.workingRevisionId = null;
  const auditResult = await runPostCommitAudit({ dependencyAudit: () => propagateLayoutPublication({ museumId, newLayoutRevisionId: revision._id, previousLayoutRevisionId: oldId }) });
  return { layout, revision, dependencyAudit: auditResult.results.dependencyAudit, audit: { status: auditResult.status, failures: auditResult.failures } };
}

module.exports = { computeLayoutIssues, getLayout, updateLayout, checkConsistency, submitReview, withdraw, changes, compensateLayoutPublish, publish };
