const mongoose = require("mongoose");
const User = require("../models/user");
const Organization = require("../models/organization.model");
const Venue = require("../models/venue.model");
const VenueRelease = require("../models/venueRelease.model");
const LayoutRevision = require("../models/layoutRevision.model");
const PhysicalVocabularyRevision = require("../models/physicalVocabularyRevision.model");
const ContentSpace = require("../models/contentSpace.model");
const EditorialContext = require("../models/editorialContext.model");
const EditorialRelease = require("../models/editorialRelease.model");
const Namespace = require("../models/namespace.model");
const Entitlement = require("../models/entitlement.model");
const AppError = require("../utils/AppError");
const { resolveActorPrincipals } = require("./principalResolution.service");
const { nowWithin } = require("./capabilityAuthorization.service");
const { projectRoutingNavigationOptions } = require("./routingProfileV2.service");

function id(value) { return String(value?._id || value || ""); }
function uniqueIds(values = []) { return [...new Set(values.map(id).filter(Boolean))]; }
function samePrincipal(aType, aId, bType, bId) { return aType === bType && id(aId) === id(bId); }
function normalizeVenueIds(values = []) {
  const raw = Array.isArray(values) ? values : String(values || "").split(",");
  return [...new Set(raw.map((value) => String(value || "").trim()).filter(Boolean))];
}

async function projectReadyVenues(selectedVenueIds = []) {
  const selected = normalizeVenueIds(selectedVenueIds);
  const invalid = selected.filter((value) => !mongoose.isValidObjectId(value));
  if (invalid.length) throw new AppError("selectedVenueIds contiene valori non validi", 400, [{ field: "selectedVenueIds", code: "INVALID_OBJECT_ID", context: { invalid } }]);

  const venues = await Venue.find({ lifecycleStatus: "active", publishedReleaseId: { $ne: null } })
    .select("_id name description ownerOrganizationId primaryEditorialContextId publishedReleaseId")
    .sort({ name: 1, _id: 1 })
    .lean();
  const releases = venues.length
    ? await VenueRelease.find({
        _id: { $in: venues.map((venue) => venue.publishedReleaseId) },
        status: "published",
        "integrity.status": "valid",
      }).select("_id venueId layoutRevisionId").lean()
    : [];
  const releaseById = new Map(releases.map((release) => [id(release._id), release]));
  const layoutIds = uniqueIds(releases.map((release) => release.layoutRevisionId));
  const layouts = layoutIds.length
    ? await LayoutRevision.find({ _id: { $in: layoutIds }, status: { $in: ["published", "superseded"] } }).select("_id venueId authoredAgainstPhysicalVocabularyRevisionId").lean()
    : [];
  const layoutById = new Map(layouts.map((layout) => [id(layout._id), layout]));

  const readyVenues = venues.filter((venue) => {
    const release = releaseById.get(id(venue.publishedReleaseId));
    const layout = release ? layoutById.get(id(release.layoutRevisionId)) : null;
    return Boolean(release && layout && id(release.venueId) === id(venue._id) && id(layout.venueId) === id(venue._id));
  });
  const readyIds = new Set(readyVenues.map((venue) => id(venue._id)));
  const unavailableSelected = selected.filter((venueId) => !readyIds.has(venueId));
  if (unavailableSelected.length) {
    throw new AppError("Una o più Venue selezionate non sono pronte per la generazione", 409, [{
      field: "selectedVenueIds",
      code: "GENERATION_VENUE_NOT_READY",
      context: { venueIds: unavailableSelected },
    }]);
  }

  const organizationIds = uniqueIds(readyVenues.map((venue) => venue.ownerOrganizationId));
  const organizations = organizationIds.length
    ? await Organization.find({ _id: { $in: organizationIds }, lifecycleStatus: "active" }).select("_id name description").lean()
    : [];
  const organizationById = new Map(organizations.map((organization) => [id(organization._id), organization]));
  const selectedSet = new Set(selected);
  const grouped = new Map();
  for (const venue of readyVenues) {
    const organization = organizationById.get(id(venue.ownerOrganizationId));
    if (!organization) continue;
    const key = id(organization._id);
    if (!grouped.has(key)) {
      grouped.set(key, {
        id: organization._id,
        name: organization.name,
        description: organization.description || "",
        venues: [],
      });
    }
    grouped.get(key).venues.push({
      id: venue._id,
      name: venue.name,
      description: venue.description || "",
      selected: selectedSet.has(id(venue._id)),
    });
  }
  return {
    organizations: [...grouped.values()],
    selectedVenueIds: selected,
    readyVenues,
    layoutByVenueId: new Map(readyVenues.map((venue) => {
      const release = releaseById.get(id(venue.publishedReleaseId));
      return [id(venue._id), layoutById.get(id(release.layoutRevisionId))];
    })),
  };
}

async function projectRoutingControls({ selectedVenueIds, layoutByVenueId }) {
  if (!selectedVenueIds.length) return { requirements: [], profilesByVenue: [] };
  const layouts = selectedVenueIds.map((venueId) => layoutByVenueId.get(id(venueId))).filter(Boolean);
  const revisionIds = uniqueIds(layouts.map((layout) => layout.authoredAgainstPhysicalVocabularyRevisionId));
  const revisions = await PhysicalVocabularyRevision.find({
    _id: { $in: revisionIds },
    status: { $in: ["published", "superseded"] },
    "integrity.status": "valid",
  }).lean();
  const revisionById = new Map(revisions.map((revision) => [id(revision._id), revision]));
  return projectRoutingNavigationOptions({ selectedVenueIds, layoutByVenueId, revisionById });
}

async function ownerSummaries(contentSpaces) {
  const userIds = uniqueIds(contentSpaces.filter((space) => space.ownerType === "user").map((space) => space.ownerId));
  const organizationIds = uniqueIds(contentSpaces.filter((space) => space.ownerType === "organization").map((space) => space.ownerId));
  const [users, organizations] = await Promise.all([
    userIds.length ? User.find({ _id: { $in: userIds }, status: "active" }).select("_id username").lean() : [],
    organizationIds.length ? Organization.find({ _id: { $in: organizationIds }, lifecycleStatus: "active" }).select("_id name").lean() : [],
  ]);
  const byKey = new Map();
  for (const user of users) byKey.set(`user:${id(user._id)}`, { type: "user", id: user._id, name: user.username });
  for (const organization of organizations) byKey.set(`organization:${id(organization._id)}`, { type: "organization", id: organization._id, name: organization.name });
  return byKey;
}

async function resolveEditorialSourceOptions({ actorUserId, readyVenues }) {
  const { principals } = await resolveActorPrincipals(actorUserId);
  const ownedClauses = principals.map((principal) => ({ ownerType: principal.type, ownerId: principal.id }));
  const principalClauses = principals.map((principal) => ({ beneficiaryType: principal.type, beneficiaryId: principal.id }));

  const [ownedSpaces, entitlementRows] = await Promise.all([
    ownedClauses.length
      ? ContentSpace.find({ lifecycleStatus: "active", $or: ownedClauses }).lean()
      : [],
    principalClauses.length
      ? Entitlement.find({
          $or: principalClauses,
          capability: "context.generate",
          resourceType: { $in: ["editorial_context", "editorial_release"] },
          status: "active",
        }).lean()
      : [],
  ]);
  const validEntitlements = entitlementRows.filter((entry) => nowWithin(entry));
  const ownedSpaceIds = uniqueIds(ownedSpaces);
  const liveEntitlements = validEntitlements.filter((entry) => entry.resourceType === "editorial_context" && entry.versionPolicy === "follow_current");
  const pinnedLiveEntitlements = validEntitlements.filter((entry) => entry.resourceType === "editorial_context" && entry.versionPolicy === "pinned" && entry.baselineSnapshotRef?.resourceType === "editorial_release");
  const pinnedReleaseEntitlements = validEntitlements.filter((entry) => entry.resourceType === "editorial_release");

  const contextIds = uniqueIds(liveEntitlements.map((entry) => entry.resourceId));
  const pinnedReleaseIds = uniqueIds([
    ...pinnedLiveEntitlements.map((entry) => entry.baselineSnapshotRef?.resourceId),
    ...pinnedReleaseEntitlements.map((entry) => entry.resourceId),
  ]);
  const pinnedReleases = pinnedReleaseIds.length
    ? await EditorialRelease.find({ _id: { $in: pinnedReleaseIds }, "integrity.status": "valid" }).lean()
    : [];
  const pinnedReleaseById = new Map(pinnedReleases.map((release) => [id(release._id), release]));
  contextIds.push(...uniqueIds(pinnedReleases.map((release) => release.editorialContextId)));
  if (!ownedSpaceIds.length && !contextIds.length) return [];

  const contexts = await EditorialContext.find({
    lifecycleStatus: "active",
    $or: [
      ...(ownedSpaceIds.length ? [{ contentSpaceId: { $in: ownedSpaceIds } }] : []),
      ...(contextIds.length ? [{ _id: { $in: contextIds } }] : []),
    ],
  }).lean();
  const contextById = new Map(contexts.map((context) => [id(context._id), context]));
  const spaceIds = uniqueIds(contexts.map((context) => context.contentSpaceId));
  const spaces = spaceIds.length
    ? await ContentSpace.find({ _id: { $in: spaceIds }, lifecycleStatus: "active" }).lean()
    : [];
  const spaceById = new Map(spaces.map((space) => [id(space._id), space]));
  const namespaceIds = uniqueIds(contexts.map((context) => context.namespaceId));
  const namespaces = namespaceIds.length
    ? await Namespace.find({ _id: { $in: namespaceIds }, lifecycleStatus: "active" }).select("_id name description").lean()
    : [];
  const namespaceById = new Map(namespaces.map((namespace) => [id(namespace._id), namespace]));
  const ownerByKey = await ownerSummaries(spaces);

  const currentReleaseIds = uniqueIds(contexts.map((context) => context.publishedReleaseId));
  const currentReleases = currentReleaseIds.length
    ? await EditorialRelease.find({ _id: { $in: currentReleaseIds }, "integrity.status": "valid" }).select("_id editorialContextId version").lean()
    : [];
  const currentReleaseById = new Map(currentReleases.map((release) => [id(release._id), release]));
  const actorOwnsSpace = (space) => principals.some((principal) => samePrincipal(space.ownerType, space.ownerId, principal.type, principal.id));
  const liveEntitledContextIds = new Set(liveEntitlements.map((entry) => id(entry.resourceId)));
  const primaryVenueIdsByContext = new Map();
  for (const venue of readyVenues) {
    const contextId = id(venue.primaryEditorialContextId);
    if (!contextId) continue;
    if (!primaryVenueIdsByContext.has(contextId)) primaryVenueIdsByContext.set(contextId, []);
    primaryVenueIdsByContext.get(contextId).push(venue._id);
  }

  const sourceRows = [];
  for (const context of contexts) {
    const space = spaceById.get(id(context.contentSpaceId));
    const namespace = namespaceById.get(id(context.namespaceId));
    if (!space || !namespace) continue;
    const currentRelease = currentReleaseById.get(id(context.publishedReleaseId));
    if (currentRelease && (actorOwnsSpace(space) || liveEntitledContextIds.has(id(context._id)))) {
      sourceRows.push({
        contentSpace: space,
        context,
        namespace,
        sourceRef: { resourceType: "editorial_context", resourceId: context._id },
        versionMode: "follow_current",
        version: currentRelease.version,
        accessKind: actorOwnsSpace(space) ? "owned" : "licensed",
        recommendedForVenueIds: primaryVenueIdsByContext.get(id(context._id)) || [],
      });
    }
  }

  const pinnedEntitlementByReleaseId = new Map();
  for (const entitlement of [...pinnedLiveEntitlements, ...pinnedReleaseEntitlements]) {
    const releaseId = entitlement.resourceType === "editorial_release"
      ? entitlement.resourceId
      : entitlement.baselineSnapshotRef?.resourceId;
    if (releaseId) pinnedEntitlementByReleaseId.set(id(releaseId), entitlement);
  }
  for (const [releaseId] of pinnedEntitlementByReleaseId) {
    const release = pinnedReleaseById.get(releaseId);
    const context = release ? contextById.get(id(release.editorialContextId)) : null;
    const space = context ? spaceById.get(id(context.contentSpaceId)) : null;
    const namespace = context ? namespaceById.get(id(context.namespaceId)) : null;
    if (!release || !context || !space || !namespace) continue;
    sourceRows.push({
      contentSpace: space,
      context,
      namespace,
      sourceRef: { resourceType: "editorial_release", resourceId: release._id },
      versionMode: "pinned",
      version: release.version,
      accessKind: "licensed",
      recommendedForVenueIds: primaryVenueIdsByContext.get(id(context._id)) || [],
    });
  }

  const groups = new Map();
  for (const row of sourceRows) {
    const spaceId = id(row.contentSpace._id);
    if (!groups.has(spaceId)) {
      const owner = ownerByKey.get(`${row.contentSpace.ownerType}:${id(row.contentSpace.ownerId)}`) || {
        type: row.contentSpace.ownerType,
        id: row.contentSpace.ownerId,
        name: row.contentSpace.ownerType === "organization" ? "Organization" : "Autore",
      };
      groups.set(spaceId, {
        id: row.contentSpace._id,
        name: row.contentSpace.name,
        description: row.contentSpace.description || "",
        owner,
        contexts: new Map(),
      });
    }
    const group = groups.get(spaceId);
    const contextId = id(row.context._id);
    if (!group.contexts.has(contextId)) {
      group.contexts.set(contextId, {
        id: row.context._id,
        name: row.context.displayName,
        description: row.context.shortDescription || row.context.description || "",
        namespace: { id: row.namespace._id, name: row.namespace.name },
        sources: [],
      });
    }
    const contextProjection = group.contexts.get(contextId);
    const sourceKey = `${row.sourceRef.resourceType}:${id(row.sourceRef.resourceId)}`;
    if (!contextProjection.sources.some((entry) => `${entry.sourceRef.resourceType}:${id(entry.sourceRef.resourceId)}` === sourceKey)) {
      contextProjection.sources.push({
        sourceRef: row.sourceRef,
        versionMode: row.versionMode,
        version: row.version,
        accessKind: row.accessKind,
        recommendedForVenueIds: row.recommendedForVenueIds,
      });
    }
  }

  return [...groups.values()]
    .map((group) => ({ ...group, contexts: [...group.contexts.values()] }))
    .sort((a, b) => a.name.localeCompare(b.name, "it"));
}

function chooseDefaultSources({ contentSpaces, selectedVenueIds }) {
  if (!selectedVenueIds.length) return [];
  const selected = new Set(selectedVenueIds.map(String));
  const candidates = [];
  for (const space of contentSpaces) {
    for (const context of space.contexts || []) {
      for (const source of context.sources || []) {
        const overlap = (source.recommendedForVenueIds || []).filter((venueId) => selected.has(id(venueId))).length;
        if (!overlap) continue;
        candidates.push({ source, overlap });
      }
    }
  }
  const versionRank = (source) => source.versionMode === "follow_current" ? 0 : 1;
  candidates.sort((a, b) => b.overlap - a.overlap || versionRank(a.source) - versionRank(b.source));
  const coveredVenues = new Set();
  const defaults = [];
  for (const candidate of candidates) {
    const covers = (candidate.source.recommendedForVenueIds || []).map(id).filter((venueId) => selected.has(venueId) && !coveredVenues.has(venueId));
    if (!covers.length) continue;
    defaults.push(candidate.source.sourceRef);
    covers.forEach((venueId) => coveredVenues.add(venueId));
  }
  return defaults;
}

async function getGenerationOptionsProjection({ actorUserId, selectedVenueIds = [] }) {
  const physical = await projectReadyVenues(selectedVenueIds);
  const contentSpaces = await resolveEditorialSourceOptions({ actorUserId, readyVenues: physical.readyVenues });
  const routing = await projectRoutingControls(physical);
  return {
    physicalScope: {
      organizations: physical.organizations,
      selectedVenueIds: physical.selectedVenueIds,
    },
    editorialScope: {
      contentSpaces,
      defaultSources: chooseDefaultSources({ contentSpaces, selectedVenueIds: physical.selectedVenueIds }),
      independentFromPhysicalScope: true,
    },
    controls: {
      timeBudget: { label: "Tempo disponibile", unit: "seconds", minimum: 1 },
      presentation: {
        depthPreference: { label: "Profondità", minimum: 0, maximum: 1 },
        languageComplexityPreference: { label: "Complessità linguistica", minimum: 0, maximum: 1 },
        locale: { label: "Lingua/locale", optional: true },
      },
      navigation: {
        movementPacePreference: { label: "Ritmo di movimento", minimum: 0, maximum: 1 },
        profilesByVenue: routing.profilesByVenue,
        requirements: routing.requirements,
      },
      semantic: {
        sourceScoped: true,
        message: "Gli obiettivi semantici vengono cercati nelle sorgenti editoriali selezionate; non esiste una tassonomia museale globale.",
      },
    },
  };
}

module.exports = {
  normalizeVenueIds,
  projectReadyVenues,
  resolveEditorialSourceOptions,
  chooseDefaultSources,
  projectRoutingControls,
  getGenerationOptionsProjection,
};