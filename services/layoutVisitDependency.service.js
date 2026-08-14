const Visit = require("../models/visit");
const VisitRevision = require("../models/visitRevision.model");
const Item = require("../models/item.model");
const MuseumLayoutRevision = require("../models/museumLayoutRevision.model");
const { resolveRoute } = require("./graphRouting.service");

function cloneRevisionData(source) {
  const object = source.toObject ? source.toObject() : source;
  return { title: object.title, description: object.description, defaultPresentationPolicy: object.defaultPresentationPolicy, contentEntries: object.contentEntries, museumIds: object.museumIds, logistics: object.logistics, baselineTiming: {} };
}
function appendIssue(revision, issue) { const issues = Array.isArray(revision.integrity?.issues) ? revision.integrity.issues : []; const duplicate = issues.some((entry) => entry.code === issue.code && String(entry.context?.layoutRevisionId || "") === String(issue.context?.layoutRevisionId || "")); revision.integrity = { status: "needs_review", issues: duplicate ? issues : [...issues, issue], checkedAt: null, checkedBy: null }; }
async function nextVersion(visitId) { const latest = await VisitRevision.findOne({ visitId }).sort({ version: -1 }).select("version").lean(); return (latest?.version || 0) + 1; }
async function ensureRepairDraft({ visit, publishedRevision, issue }) { if (visit.workingRevisionId) { const working = await VisitRevision.findById(visit.workingRevisionId); if (working) { appendIssue(working, issue); working.baselineTiming = {}; await working.save(); return working; } } const working = await VisitRevision.create({ visitId: visit._id, version: await nextVersion(visit._id), basedOnRevisionId: publishedRevision._id, ...cloneRevisionData(publishedRevision), status: "draft", integrity: { status: "needs_review", issues: [issue] }, createdBy: publishedRevision.updatedBy || publishedRevision.createdBy, updatedBy: publishedRevision.updatedBy || publishedRevision.createdBy }); visit.workingRevisionId = working._id; return working; }

async function checkAgainstLayout({ revision, museumId, layoutRevision }) {
  const entries = revision.contentEntries || [];
  const items = await Item.find({ _id: { $in: entries.map((entry) => entry.itemId) } }).lean();
  const byId = new Map(items.map((item) => [String(item._id), item]));
  const placements = new Map((layoutRevision.itemPlacements || []).map((entry) => [String(entry.itemId), entry]));
  const targets = entries.map((entry, index) => ({ entry, index, item: byId.get(String(entry.itemId)) })).filter(({ entry, item }) => entry.spatialMode === "target" && item && String(item.museumId) === String(museumId));
  const problems = [];
  for (const { entry, index, item } of targets) if (!placements.has(String(item._id))) problems.push({ code: "ITEM_PLACEMENT_MISSING", contentEntryId: entry._id, contentEntryIndex: index, itemId: item._id });
  for (let i = 0; i < targets.length - 1; i += 1) {
    const left = targets[i], right = targets[i + 1], from = placements.get(String(left.item._id)), to = placements.get(String(right.item._id));
    if (!from || !to) continue;
    const route = resolveRoute({ connections: layoutRevision.connections || [], fromPlaceId: from.primaryPlaceId, toPlaceId: to.primaryPlaceId });
    if (!route.reachable) problems.push({ code: "ROUTE_NOT_AVAILABLE", fromTargetEntryId: left.entry._id, toTargetEntryId: right.entry._id });
  }
  return problems;
}

async function propagateLayoutPublication({ museumId, newLayoutRevisionId, previousLayoutRevisionId = null }) {
  const layoutRevision = await MuseumLayoutRevision.findById(newLayoutRevisionId).lean(); if (!layoutRevision) throw new Error("Nuova revisione layout non trovata durante la propagazione");
  const revisions = await VisitRevision.find({ museumIds: museumId, status: { $in: ["draft", "changes_requested", "in_review", "published"] } });
  let affectedCount = 0, blockingCount = 0, unpublishedCount = 0;
  for (const revision of revisions) {
    const problems = await checkAgainstLayout({ revision: revision.toObject(), museumId, layoutRevision }), blocking = problems.length > 0;
    const issue = { field: "logistics", code: blocking ? "LAYOUT_REVISION_INCOMPATIBLE" : "LAYOUT_REVISION_CHANGED", message: blocking ? "Il nuovo layout non consente piu di eseguire questa visita senza modifiche" : "Il layout del museo e cambiato: il percorso fisico deve essere ricontrollato sul nuovo grafo", severity: blocking ? "error" : "warning", context: { museumId, layoutRevisionId: newLayoutRevisionId, previousLayoutRevisionId, problems } };
    appendIssue(revision, issue); if (revision.status !== "published") revision.baselineTiming = {}; await revision.save(); affectedCount += 1; if (blocking) blockingCount += 1;
    if (blocking && revision.status === "published") { const visit = await Visit.findOne({ _id: revision.visitId, publishedRevisionId: revision._id, lifecycleStatus: "active" }); if (visit) { await ensureRepairDraft({ visit, publishedRevision: revision, issue }); visit.publishedRevisionId = null; await visit.save(); unpublishedCount += 1; } }
  }
  return { affectedCount, blockingCount, unpublishedCount };
}
module.exports = { checkAgainstLayout, propagateLayoutPublication };
