const mongoose = require("mongoose");
const VisitV2 = require("../models/visitV2.model");
const VisitRevisionV2 = require("../models/visitRevisionV2.model");
const VisitSessionV2 = require("../models/visitSessionV2.model");
const Venue = require("../models/venue.model");
const Entitlement = require("../models/entitlement.model");
const User = require("../models/user");
const Organization = require("../models/organization.model");
const AppError = require("../utils/AppError");
const { resolveExecutableVisitRevisionV2 } = require("./visitExecutionAccessV2.service");
const { nowWithin } = require("./capabilityAuthorization.service");
const { projectVisitPhysicalScope, configuredVenueMatches } = require("./visitReadProjectionV2.service");
const { resolveSessionVenuePins } = require("./physicalExecutionV2.service");

function id(value) { return String(value?._id || value || ""); }
function validateConfiguredVenueId(configuredVenueId) {
  if (configuredVenueId && !mongoose.isValidObjectId(configuredVenueId)) {
    throw new AppError("configuredVenueId non valido", 400, [{ field: "configuredVenueId", code: "INVALID_OBJECT_ID" }]);
  }
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
    resourceType: { $in: ["visit", "visit_revision"] },
    capability: "visit.execute",
    status: "active",
  }).select("resourceType resourceId status validFrom validUntil").lean();
  const valid = entitlements.filter((entry) => nowWithin(entry));
  const liveVisitIds = valid.filter((entry) => entry.resourceType === "visit").map((entry) => entry.resourceId);
  const revisionIds = valid.filter((entry) => entry.resourceType === "visit_revision").map((entry) => entry.resourceId);
  const revisionVisits = revisionIds.length
    ? await VisitRevisionV2.find({ _id: { $in: revisionIds }, status: { $in: ["published", "superseded"] } }).distinct("visitId")
    : [];
  return [...new Set([...owned, ...liveVisitIds, ...revisionVisits].map(id))];
}

async function projectOwnerSummary(visit) {
  if (visit.ownerType === "organization") {
    const organization = await Organization.findOne({ _id: visit.ownerId, lifecycleStatus: "active" }).select("name").lean();
    return { type: "organization", id: visit.ownerId, name: organization?.name || "Organization" };
  }
  const user = await User.findOne({ _id: visit.ownerId, status: "active" }).select("username").lean();
  return { type: "user", id: visit.ownerId, name: user?.username || "Autore" };
}

async function resolveNavigatorVisit({ visit, userId }) {
  const { revision } = await resolveExecutableVisitRevisionV2({ visit, userId });
  const [physicalScope, owner] = await Promise.all([
    projectVisitPhysicalScope(revision),
    projectOwnerSummary(visit),
  ]);
  return { revision, physicalScope, owner };
}

async function projectLibraryCard({ visit, userId }) {
  const resolved = await resolveNavigatorVisit({ visit, userId });
  await resolveSessionVenuePins(resolved.revision.visitAnchors || []);
  return {
    id: visit._id,
    resolvedRevisionId: resolved.revision._id,
    title: resolved.revision.title,
    summary: resolved.revision.description || "",
    owner: resolved.owner,
    physicalScope: resolved.physicalScope.venues,
    stopCount: resolved.physicalScope.stopCount,
    deliveryMode: resolved.revision.deliveryMode || "self_guided",
  };
}

async function listNavigatorLibrary({ userId, configuredVenueId = null }) {
  validateConfiguredVenueId(configuredVenueId);
  const visitIds = await directLibraryVisitIds(userId);
  if (!visitIds.length) return { visits: [] };
  const visits = await VisitV2.find({ _id: { $in: visitIds }, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).sort({ updatedAt: -1 }).lean();
  const result = [];
  for (const visit of visits) {
    try {
      const card = await projectLibraryCard({ visit, userId });
      if (!configuredVenueMatches({ venues: card.physicalScope }, configuredVenueId)) continue;
      result.push(card);
    } catch (error) {
      if ([403, 404, 409].includes(error?.status)) continue;
      throw error;
    }
  }
  return { visits: result };
}

async function getNavigatorVisitDetail({ userId, visitId, configuredVenueId = null }) {
  validateConfiguredVenueId(configuredVenueId);
  const visit = await VisitV2.findOne({ _id: visitId, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).lean();
  if (!visit) throw new AppError("Visit non disponibile", 404);
  const resolved = await resolveNavigatorVisit({ visit, userId });
  await resolveSessionVenuePins(resolved.revision.visitAnchors || []);
  if (!configuredVenueMatches({ venues: resolved.physicalScope.venues }, configuredVenueId)) {
    throw new AppError("La Visit non e applicabile alla sede configurata", 409, [{
      code: "VISIT_NOT_APPLICABLE_TO_CONFIGURED_VENUE",
      context: { configuredVenueId },
    }]);
  }
  return {
    context: {
      owner: resolved.owner,
    },
    visit: {
      id: visit._id,
      resolvedRevisionId: resolved.revision._id,
      title: resolved.revision.title,
      description: resolved.revision.description || "",
      physicalScope: resolved.physicalScope.venues,
      stopCount: resolved.physicalScope.stopCount,
      contentCount: (resolved.revision.contentEntries || []).length,
      deliveryMode: resolved.revision.deliveryMode || "self_guided",
    },
    preparation: { available: true },
  };
}

async function listResumableNavigatorSessions({ userId, configuredVenueId = null }) {
  validateConfiguredVenueId(configuredVenueId);
  const sessions = await VisitSessionV2.find({
    userId,
    synchronizedSessionId: null,
    status: { $in: ["active", "paused", "route_completed"] },
  }).sort({ updatedAt: -1 }).limit(20).lean();
  const filteredSessions = configuredVenueId
    ? sessions.filter((session) => (session.venuePins || []).some((pin) => id(pin.venueId) === id(configuredVenueId)))
    : sessions;

  const revisionIds = [...new Set(filteredSessions.map((session) => id(session.visitRevisionId)).filter(Boolean))];
  const venueIds = [...new Set(filteredSessions.flatMap((session) =>
    (session.venuePins || []).map((pin) => id(pin.venueId)).filter(Boolean)
  ))];
  const [revisions, venues] = await Promise.all([
    revisionIds.length
      ? VisitRevisionV2.find({ _id: { $in: revisionIds } }).select("title").lean()
      : [],
    venueIds.length
      ? Venue.find({ _id: { $in: venueIds }, lifecycleStatus: "active" }).select("_id name description").lean()
      : [],
  ]);
  const revisionById = new Map(revisions.map((revision) => [id(revision._id), revision]));
  const venueById = new Map(venues.map((venue) => [id(venue._id), venue]));

  return {
    sessions: filteredSessions.map((session) => ({
      id: session._id,
      status: session.status,
      sourceType: session.sourceType,
      visitId: session.visitId || null,
      title: session.visitRevisionId
        ? revisionById.get(id(session.visitRevisionId))?.title || "Visita"
        : "Visita generata",
      currentEntryIndex: Number(session.currentEntryIndex) || 0,
      updatedAt: session.updatedAt,
      physicalScope: (session.venuePins || []).map((pin) => {
        const venue = venueById.get(id(pin.venueId));
        return venue ? { id: venue._id, name: venue.name, description: venue.description || "" } : null;
      }).filter(Boolean),
    })),
  };
}

async function dismissResumableNavigatorSession({ userId, sessionId }) {
  const session = await VisitSessionV2.findOne({ _id: sessionId, userId });
  if (!session) throw new AppError("VisitSession non disponibile", 404);
  if (!["active", "paused", "route_completed"].includes(session.status)) {
    throw new AppError("La Session non e presente tra le visite da riprendere", 409, [{
      code: "SESSION_NOT_RESUMABLE",
    }]);
  }
  if (session.status === "paused") {
    const interval = session.pauseIntervals.at(-1);
    if (interval && !interval.endedAt) interval.endedAt = new Date();
  }
  session.status = "abandoned";
  session.runtimeVersion += 1;
  await session.save();
  return {
    removedFromResume: true,
    session: { id: session._id, status: session.status },
  };
}

function projectNavigatorMuseums(visits = [], sessions = []) {
  const museums = new Map();
  for (const visit of visits) {
    const seen = new Set();
    for (const venue of visit.physicalScope || []) {
      const venueId = id(venue.id);
      if (!venueId || seen.has(venueId)) continue;
      seen.add(venueId);
      const current = museums.get(venueId) || {
        id: venue.id,
        name: venue.name,
        description: venue.description || "",
        visitCount: 0,
        resumableSessionCount: 0,
      };
      current.visitCount += 1;
      museums.set(venueId, current);
    }
  }
  for (const session of sessions) {
    for (const venue of session.physicalScope || []) {
      const current = museums.get(id(venue.id));
      if (current) current.resumableSessionCount += 1;
    }
  }
  return [...museums.values()].sort((a, b) => a.name.localeCompare(b.name, "it"));
}

async function listNavigatorMuseums({ userId }) {
  const [{ visits }, { sessions }] = await Promise.all([
    listNavigatorLibrary({ userId }),
    listResumableNavigatorSessions({ userId }),
  ]);
  return { museums: projectNavigatorMuseums(visits, sessions) };
}

module.exports = {
  directLibraryVisitIds,
  listNavigatorLibrary,
  getNavigatorVisitDetail,
  listResumableNavigatorSessions,
  dismissResumableNavigatorSession,
  projectNavigatorMuseums,
  listNavigatorMuseums,
};
