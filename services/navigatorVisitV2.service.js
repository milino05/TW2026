const mongoose = require("mongoose");
const VisitV2 = require("../models/visitV2.model");
const VisitRevisionV2 = require("../models/visitRevisionV2.model");
const Entitlement = require("../models/entitlement.model");
const AppError = require("../utils/AppError");
const { assertCanExecuteVisitV2 } = require("./visitExecutionAccessV2.service");
const { nowWithin } = require("./capabilityAuthorization.service");
const { projectVisitPhysicalScope, configuredVenueMatches } = require("./visitReadProjectionV2.service");

function id(value) { return String(value?._id || value || ""); }

async function loadPublishedRevision(visit) {
  if (!visit?.publishedRevisionId) return null;
  return VisitRevisionV2.findOne({ _id: visit.publishedRevisionId, visitId: visit._id, status: "published" }).lean();
}

async function directLibraryVisitIds(userId) {
  const owned = await VisitV2.find({
    ownerType: "user",
    ownerId: userId,
    lifecycleStatus: "active",
    publishedRevisionId: { $ne: null },
  }).distinct("_id");
  const entitlements = await Entitlement.find({
    beneficiaryType: "user",
    beneficiaryId: userId,
    resourceType: "visit",
    capability: "visit.execute",
    status: "active",
  }).select("resourceId status validFrom validUntil").lean();
  const entitled = entitlements.filter((entry) => nowWithin(entry)).map((entry) => entry.resourceId);
  return [...new Set([...owned, ...entitled].map(id))];
}

async function projectLibraryCard(visit) {
  const revision = await loadPublishedRevision(visit);
  if (!revision) return null;
  const physicalScope = await projectVisitPhysicalScope(revision);
  return {
    id: visit._id,
    title: revision.title,
    summary: revision.description || "",
    physicalScope: physicalScope.venues,
    stopCount: physicalScope.stopCount,
  };
}

async function listNavigatorLibrary({ userId, configuredVenueId = null }) {
  if (configuredVenueId && !mongoose.isValidObjectId(configuredVenueId)) {
    throw new AppError("configuredVenueId non valido", 400, [{ field: "configuredVenueId", code: "INVALID_OBJECT_ID" }]);
  }
  const visitIds = await directLibraryVisitIds(userId);
  if (!visitIds.length) return { visits: [] };
  const visits = await VisitV2.find({ _id: { $in: visitIds }, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).sort({ updatedAt: -1 }).lean();
  const result = [];
  for (const visit of visits) {
    const card = await projectLibraryCard(visit);
    if (!card) continue;
    if (!configuredVenueMatches({ venues: card.physicalScope }, configuredVenueId)) continue;
    result.push(card);
  }
  return { visits: result };
}

async function getNavigatorVisitDetail({ userId, visitId }) {
  const visit = await VisitV2.findOne({ _id: visitId, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).lean();
  if (!visit) throw new AppError("Visit non disponibile", 404);
  await assertCanExecuteVisitV2(visit, userId);
  const revision = await loadPublishedRevision(visit);
  if (!revision) throw new AppError("VisitRevision pubblicata non disponibile", 409);
  const physicalScope = await projectVisitPhysicalScope(revision);
  return {
    visit: {
      id: visit._id,
      revisionId: revision._id,
      title: revision.title,
      description: revision.description || "",
      physicalScope: physicalScope.venues,
      stopCount: physicalScope.stopCount,
      contentCount: (revision.contentEntries || []).length,
    },
    preparation: { available: true },
  };
}

module.exports = {
  directLibraryVisitIds,
  listNavigatorLibrary,
  getNavigatorVisitDetail,
};
