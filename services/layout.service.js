const MuseumLayout = require("../models/museumLayout.model");
const MuseumLayoutRevision = require("../models/museumLayoutRevision.model");
const Item = require("../models/item.model");
const AppError = require("../utils/AppError");
const { assertMuseumRole } = require("./museumAuthorization.service");
const { markRevisionEdited, requestReview, withdrawReview, requestChanges, markPublished } = require("./revisionWorkflow.service");
const { getCanonicalAttribute } = require("./routingAttributeCatalog.service");
const { propagateLayoutPublication } = require("./layoutVisitDependency.service");

function duplicateKeys(values = []) { const seen = new Set(); const duplicates = new Set(); for (const entry of values) { if (!entry?.key) continue; if (seen.has(entry.key)) duplicates.add(entry.key); seen.add(entry.key); } return [...duplicates]; }

async function computeLayoutIssues(revision, museumId) {
  const issues = [];
  const add = (field, code, message, severity = "error", context = {}) => issues.push({ field, code, message, severity, context });
  for (const [field, values] of [["placeTypes", revision.placeTypes], ["routingAttributes", revision.routingAttributes], ["routingPresets", revision.routingPresets], ["floors", revision.floors]]) duplicateKeys(values).forEach((key) => add(field, "DUPLICATE_KEY", `Chiave duplicata: ${key}`));
  const floorKeys = new Set((revision.floors || []).map((entry) => entry.key));
  const placeTypeKeys = new Set((revision.placeTypes || []).map((entry) => entry.key));
  const placeIds = new Set((revision.places || []).map((entry) => String(entry._id)));
  const attributeByKey = new Map((revision.routingAttributes || []).map((entry) => [entry.key, entry]));
  (revision.routingAttributes || []).forEach((attribute, index) => { if (attribute.canonicalKey) { const canonical = getCanonicalAttribute(attribute.canonicalKey); if (!canonical) add(`routingAttributes[${index}].canonicalKey`, "UNKNOWN_CANONICAL_ATTRIBUTE", "Attributo globale sconosciuto"); else if (canonical.dataType !== attribute.dataType) add(`routingAttributes[${index}].dataType`, "CANONICAL_TYPE_MISMATCH", "Il dataType non coincide con il catalogo globale"); } });
  (revision.places || []).forEach((place, index) => { if (!floorKeys.has(place.floorKey)) add(`places[${index}].floorKey`, "UNKNOWN_FLOOR", "Piano non definito"); if (!placeTypeKeys.has(place.typeKey)) add(`places[${index}].typeKey`, "UNKNOWN_PLACE_TYPE", "PlaceType non definito"); });
  const placementItems = new Set();
  for (let index = 0; index < (revision.itemPlacements || []).length; index += 1) { const placement = revision.itemPlacements[index]; if (placementItems.has(String(placement.itemId))) add(`itemPlacements[${index}].itemId`, "DUPLICATE_ITEM_PLACEMENT", "Un item puo avere un solo ItemPlacement"); placementItems.add(String(placement.itemId)); const item = await Item.findOne({ _id: placement.itemId, museumId, lifecycleStatus: "active" }).lean(); if (!item) add(`itemPlacements[${index}].itemId`, "ITEM_NOT_AVAILABLE", "Item non appartenente al museo o nel cestino"); if (!placeIds.has(String(placement.primaryPlaceId))) add(`itemPlacements[${index}].primaryPlaceId`, "UNKNOWN_PLACE", "Posizione primaria non presente nel layout"); if (!(placement.placeIds || []).some((id) => String(id) === String(placement.primaryPlaceId))) add(`itemPlacements[${index}].placeIds`, "PRIMARY_PLACE_MISSING", "primaryPlaceId deve comparire in placeIds"); (placement.placeIds || []).forEach((id) => { if (!placeIds.has(String(id))) add(`itemPlacements[${index}].placeIds`, "UNKNOWN_PLACE", "Posizione secondaria non presente nel layout"); }); }
  (revision.connections || []).forEach((connection, index) => { if (!placeIds.has(String(connection.fromPlaceId)) || !placeIds.has(String(connection.toPlaceId))) add(`connections[${index}]`, "UNKNOWN_PLACE", "Una connection riferisce un Place inesistente"); if (String(connection.fromPlaceId) === String(connection.toPlaceId)) add(`connections[${index}]`, "SELF_CONNECTION", "Una connection non puo collegare un Place a se stesso"); for (const key of Object.keys(connection.attributes || {})) if (!attributeByKey.has(key)) add(`connections[${index}].attributes.${key}`, "UNKNOWN_ROUTING_ATTRIBUTE", "Routing attribute non definito"); });
  (revision.routingPresets || []).forEach((preset, presetIndex) => (preset.requirements || []).forEach((requirement, requirementIndex) => { if (!attributeByKey.has(requirement.attributeKey)) add(`routingPresets[${presetIndex}].requirements[${requirementIndex}]`, "UNKNOWN_ROUTING_ATTRIBUTE", "Preset riferisce un attributo non definito"); }));
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

async function publish({ museumId, actorUserId }) {
  await assertMuseumRole({ userId: actorUserId, museumId, minimumRole: "manager" });
  const layout = await MuseumLayout.findOne({ museumId });
  if (!layout?.workingRevisionId) throw new AppError("Nessuna revisione da pubblicare", 404);
  const revision = await MuseumLayoutRevision.findById(layout.workingRevisionId);
  const issues = await computeLayoutIssues(revision, museumId);
  revision.integrity = { status: issues.some((entry) => entry.severity !== "warning") ? "needs_review" : "valid", issues, checkedAt: new Date(), checkedBy: actorUserId };
  if (revision.integrity.status !== "valid") { await revision.save(); throw new AppError("Layout non consistente", 409, issues); }
  const oldId = layout.publishedRevisionId;
  try { markPublished(revision, actorUserId); } catch (error) { throw new AppError(error.message, 409); }
  await revision.save();
  if (oldId) await MuseumLayoutRevision.updateOne({ _id: oldId }, { $set: { status: "superseded" } });
  layout.publishedRevisionId = revision._id; layout.workingRevisionId = null; await layout.save();
  const dependencyAudit = await propagateLayoutPublication({ museumId, newLayoutRevisionId: revision._id, previousLayoutRevisionId: oldId });
  return { layout, revision, dependencyAudit };
}

module.exports = { computeLayoutIssues, getLayout, updateLayout, checkConsistency, submitReview, withdraw, changes, publish };
