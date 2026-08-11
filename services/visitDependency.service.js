const Item = require("../models/item.model");
const ItemRevision = require("../models/itemRevision.model");
const Visit = require("../models/visit");
const VisitRevision = require("../models/visitRevision.model");
const { resolveRoute } = require("./graphRouting.service");

function cloneVisitRevisionData(source) {
  const object = source.toObject ? source.toObject() : source;
  return {
    title: object.title,
    description: object.description,
    defaultPresentationPolicy: object.defaultPresentationPolicy,
    stops: object.stops,
    museumIds: object.museumIds,
    logistics: object.logistics,
    estimatedContentSeconds: object.estimatedContentSeconds,
    estimatedObservationSeconds: object.estimatedObservationSeconds,
    estimatedLogisticsSeconds: object.estimatedLogisticsSeconds,
    estimatedTotalSeconds: object.estimatedTotalSeconds,
  };
}

async function nextVisitVersion(visitId) {
  const latest = await VisitRevision.findOne({ visitId }).sort({ version: -1 }).select("version").lean();
  return (latest?.version || 0) + 1;
}

function appendIssue(revision, issue) {
  const issues = Array.isArray(revision.integrity?.issues) ? revision.integrity.issues : [];
  const duplicate = issues.some((entry) =>
    entry.code === issue.code &&
    String(entry.context?.itemId || "") === String(issue.context?.itemId || "") &&
    String(entry.context?.museumId || "") === String(issue.context?.museumId || ""));
  revision.integrity = {
    status: "needs_review",
    issues: duplicate ? issues : [...issues, issue],
    checkedAt: null,
    checkedBy: null,
  };
}

async function createRepairDraft({ visit, publishedRevision, issue }) {
  if (visit.workingRevisionId) {
    const working = await VisitRevision.findById(visit.workingRevisionId);
    if (working) {
      appendIssue(working, issue);
      await working.save();
      return working;
    }
  }
  const working = new VisitRevision({
    visitId: visit._id,
    version: await nextVisitVersion(visit._id),
    basedOnRevisionId: publishedRevision._id,
    ...cloneVisitRevisionData(publishedRevision),
    status: "draft",
    integrity: { status: "needs_review", issues: [issue] },
    createdBy: publishedRevision.updatedBy || publishedRevision.createdBy,
    updatedBy: publishedRevision.updatedBy || publishedRevision.createdBy,
  });
  await working.save();
  visit.workingRevisionId = working._id;
  return working;
}

async function invalidateVisitsUsingItem({ itemId, code, message, blocking = false, context = {} }) {
  const revisions = await VisitRevision.find({ "stops.itemId": itemId, status: { $in: ["draft", "changes_requested", "in_review", "published"] } });
  let affectedCount = 0;
  let unpublishedCount = 0;
  for (const revision of revisions) {
    const issue = { field: "stops", code, message, severity: blocking ? "error" : "warning", context: { ...context, itemId } };
    appendIssue(revision, issue);
    await revision.save();
    affectedCount += 1;
    if (blocking && revision.status === "published") {
      const visit = await Visit.findOne({ _id: revision.visitId, publishedRevisionId: revision._id });
      if (visit) {
        await createRepairDraft({ visit, publishedRevision: revision, issue });
        visit.publishedRevisionId = null;
        await visit.save();
        unpublishedCount += 1;
      }
    }
  }
  return { affectedCount, unpublishedCount };
}

async function invalidateSinglePublishedVisit({ visit, revision, issue, blocking }) {
  appendIssue(revision, issue);
  await revision.save();
  if (!blocking) return { unpublished: false };
  await createRepairDraft({ visit, publishedRevision: revision, issue });
  visit.publishedRevisionId = null;
  await visit.save();
  return { unpublished: true };
}

async function auditVisitsUsingPublishedItem({ item, revision }) {
  const publishedVisitRevisions = await VisitRevision.find({ "stops.itemId": item._id, status: "published" });
  let warningCount = 0;
  let blockingCount = 0;
  let unpublishedCount = 0;
  for (const visitRevision of publishedVisitRevisions) {
    const visit = await Visit.findOne({ _id: visitRevision.visitId, publishedRevisionId: visitRevision._id, lifecycleStatus: "active" });
    if (!visit) continue;
    let blocking = item.lifecycleStatus !== "active" || revision.integrity?.status !== "valid";
    if (!blocking && visit.kind === "official") {
      const policy = visitRevision.defaultPresentationPolicy;
      blocking = !revision.representations?.some((entry) => entry.durationKey === policy?.durationKey && entry.languageLevelKey === policy?.languageLevelKey);
    }
    if (!blocking && visit.kind === "community") blocking = !revision.representations?.some((entry) => entry.isDefault === true);
    const issue = {
      field: "stops",
      code: blocking ? "ITEM_REVISION_INCOMPATIBLE" : "ITEM_REVISION_CHANGED",
      message: blocking ? "La nuova revisione dell'item non e compatibile con la visita" : "L'item ha una nuova revisione pubblicata; la visita dovrebbe essere ricontrollata",
      severity: blocking ? "error" : "warning",
      context: { itemId: item._id, itemRevisionId: revision._id },
    };
    const result = await invalidateSinglePublishedVisit({ visit, revision: visitRevision, issue, blocking });
    if (blocking) blockingCount += 1;
    else warningCount += 1;
    if (result.unpublished) unpublishedCount += 1;
  }
  return { warningCount, blockingCount, unpublishedCount };
}

async function invalidateVisitsUsingMuseumVocabulary({ museumId, vocabularyRevision }) {
  const revisions = await VisitRevision.find({ museumIds: museumId, status: { $in: ["draft", "changes_requested", "in_review", "published"] } });
  let affectedCount = 0;
  for (const revision of revisions) {
    appendIssue(revision, {
      field: "museumIds",
      code: "MUSEUM_VOCABULARY_REORDERED",
      message: "Il vocabolario di un museo coinvolto e cambiato; selezioni e durata devono essere ricalcolate",
      severity: "warning",
      context: { museumId, vocabularyRevision },
    });
    revision.estimatedContentSeconds = 0;
    await revision.save();
    affectedCount += 1;
  }
  return { affectedCount };
}

async function layoutCompatibleWithVisitRevision({ revision, museumId, layoutRevision }) {
  const stopItems = await Promise.all((revision.stops || []).map((stop) => Item.findById(stop.itemId).lean()));
  const placements = new Map((layoutRevision.itemPlacements || []).map((entry) => [String(entry.itemId), entry]));
  for (let index = 0; index < stopItems.length; index += 1) {
    const item = stopItems[index];
    if (item && String(item.museumId) === String(museumId) && !placements.has(String(item._id))) return false;
  }
  for (let index = 0; index < stopItems.length - 1; index += 1) {
    const from = stopItems[index];
    const to = stopItems[index + 1];
    if (!from || !to || String(from.museumId) !== String(museumId) || String(to.museumId) !== String(museumId)) continue;
    const fromPlacement = placements.get(String(from._id));
    const toPlacement = placements.get(String(to._id));
    const route = resolveRoute({ connections: layoutRevision.connections, fromPlaceId: fromPlacement.primaryPlaceId, toPlaceId: toPlacement.primaryPlaceId });
    if (!route.reachable) return false;
  }
  return true;
}

async function invalidateVisitsUsingMuseumLayout({ museumId, layoutRevision }) {
  const revisions = await VisitRevision.find({ museumIds: museumId, status: { $in: ["draft", "changes_requested", "in_review", "published"] } });
  let warningCount = 0;
  let blockingCount = 0;
  let unpublishedCount = 0;
  for (const revision of revisions) {
    const compatible = await layoutCompatibleWithVisitRevision({ revision, museumId, layoutRevision });
    const blocking = !compatible;
    const issue = {
      field: "logistics",
      code: blocking ? "MUSEUM_LAYOUT_INCOMPATIBLE" : "MUSEUM_LAYOUT_CHANGED",
      message: blocking
        ? "Il nuovo layout non consente piu di eseguire la visita senza correggere placement o percorsi"
        : "Il layout del museo e cambiato; i percorsi verranno ricalcolati sul nuovo grafo",
      severity: blocking ? "error" : "warning",
      context: { museumId, layoutRevisionId: layoutRevision._id },
    };
    appendIssue(revision, issue);
    await revision.save();
    if (blocking) blockingCount += 1;
    else warningCount += 1;
    if (blocking && revision.status === "published") {
      const visit = await Visit.findOne({ _id: revision.visitId, publishedRevisionId: revision._id, lifecycleStatus: "active" });
      if (visit) {
        await createRepairDraft({ visit, publishedRevision: revision, issue });
        visit.publishedRevisionId = null;
        await visit.save();
        unpublishedCount += 1;
      }
    }
  }
  return { warningCount, blockingCount, unpublishedCount };
}

module.exports = {
  invalidateVisitsUsingItem,
  auditVisitsUsingPublishedItem,
  invalidateVisitsUsingMuseumVocabulary,
  invalidateVisitsUsingMuseumLayout,
};
