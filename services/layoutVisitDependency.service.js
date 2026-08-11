const Visit = require("../models/visit");
const VisitRevision = require("../models/visitRevision.model");
const Item = require("../models/item.model");
const MuseumLayoutRevision = require("../models/museumLayoutRevision.model");
const { resolveRoute } = require("./graphRouting.service");

function cloneRevisionData(source) {
  const object = source.toObject ? source.toObject() : source;
  return { title: object.title, description: object.description, defaultPresentationPolicy: object.defaultPresentationPolicy, stops: object.stops, museumIds: object.museumIds, logistics: object.logistics, baselineTiming: {} };
}
function appendIssue(revision, issue) { const issues = Array.isArray(revision.integrity?.issues) ? revision.integrity.issues : []; const duplicate = issues.some((entry) => entry.code === issue.code && String(entry.context?.layoutRevisionId || "") === String(issue.context?.layoutRevisionId || "")); revision.integrity = { status: "needs_review", issues: duplicate ? issues : [...issues, issue], checkedAt: null, checkedBy: null }; }
async function nextVersion(visitId) { const latest = await VisitRevision.findOne({ visitId }).sort({ version: -1 }).select("version").lean(); return (latest?.version || 0) + 1; }
async function ensureRepairDraft({ visit, publishedRevision, issue }) { if (visit.workingRevisionId) { const working = await VisitRevision.findById(visit.workingRevisionId); if (working) { appendIssue(working, issue); working.baselineTiming = {}; await working.save(); return working; } } const working = new VisitRevision({ visitId: visit._id, version: await nextVersion(visit._id), basedOnRevisionId: publishedRevision._id, ...cloneRevisionData(publishedRevision), status: "draft", integrity: { status: "needs_review", issues: [issue] }, createdBy: publishedRevision.updatedBy || publishedRevision.createdBy, updatedBy: publishedRevision.updatedBy || publishedRevision.createdBy }); await working.save(); visit.workingRevisionId = working._id; return working; }

async function checkAgainstLayout({ revision, museumId, layoutRevision }) {
  const stopItems = await Promise.all((revision.stops || []).map((stop) => Item.findById(stop.itemId).lean()));
  const placements = new Map((layoutRevision.itemPlacements || []).map((entry) => [String(entry.itemId), entry]));
  const problems = [];
  for (let index = 0; index < stopItems.length; index += 1) { const item = stopItems[index]; if (!item || String(item.museumId) !== String(museumId)) continue; if (!placements.has(String(item._id))) problems.push({ code: "ITEM_PLACEMENT_MISSING", stopIndex: index, itemId: item._id }); }
  for (let index = 0; index < stopItems.length - 1; index += 1) { const from = stopItems[index]; const to = stopItems[index + 1]; if (!from || !to || String(from.museumId) !== String(museumId) || String(to.museumId) !== String(museumId)) continue; const fromPlacement = placements.get(String(from._id)); const toPlacement = placements.get(String(to._id)); if (!fromPlacement || !toPlacement) continue; const route = resolveRoute({ connections: layoutRevision.connections || [], fromPlaceId: fromPlacement.primaryPlaceId, toPlaceId: toPlacement.primaryPlaceId }); if (!route.reachable) problems.push({ code: "ROUTE_NOT_AVAILABLE", fromStopIndex: index, toStopIndex: index + 1 }); }
  return problems;
}

async function propagateLayoutPublication({ museumId, newLayoutRevisionId, previousLayoutRevisionId = null }) {
  const layoutRevision = await MuseumLayoutRevision.findById(newLayoutRevisionId).lean();
  if (!layoutRevision) throw new Error("Nuova revisione layout non trovata durante la propagazione");
  const revisions = await VisitRevision.find({ museumIds: museumId, status: { $in: ["draft", "changes_requested", "in_review", "published"] } });
  let affectedCount = 0; let blockingCount = 0; let unpublishedCount = 0;
  for (const revision of revisions) {
    const problems = await checkAgainstLayout({ revision: revision.toObject(), museumId, layoutRevision });
    const blocking = problems.length > 0;
    const issue = { field: "logistics", code: blocking ? "LAYOUT_REVISION_INCOMPATIBLE" : "LAYOUT_REVISION_CHANGED", message: blocking ? "Il nuovo layout non consente piu di eseguire questa visita senza modifiche" : "Il layout del museo e cambiato: i percorsi pianificati devono essere ricontrollati sul nuovo grafo", severity: blocking ? "error" : "warning", context: { museumId, layoutRevisionId: newLayoutRevisionId, previousLayoutRevisionId, problems } };
    appendIssue(revision, issue);
    if (revision.status !== "published") revision.baselineTiming = {};
    await revision.save();
    affectedCount += 1;
    if (blocking) blockingCount += 1;
    if (blocking && revision.status === "published") { const visit = await Visit.findOne({ _id: revision.visitId, publishedRevisionId: revision._id, lifecycleStatus: "active" }); if (visit) { await ensureRepairDraft({ visit, publishedRevision: revision, issue }); visit.publishedRevisionId = null; await visit.save(); unpublishedCount += 1; } }
  }
  return { affectedCount, blockingCount, unpublishedCount };
}

module.exports = { checkAgainstLayout, propagateLayoutPublication };
