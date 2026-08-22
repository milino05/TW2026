const mongoose = require("mongoose");
const Venue = require("../models/venue.model");
const VenueTarget = require("../models/venueTarget.model");
const ItemV2 = require("../models/itemV2.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const EditorialContext = require("../models/editorialContext.model");
const EditorialRelease = require("../models/editorialRelease.model");
const VisitRevisionV2 = require("../models/visitRevisionV2.model");
const AppError = require("../utils/AppError");

function ids(values = []) {
  return [...new Set((values || []).map((value) => String(value?._id || value || "")).filter(Boolean))];
}

function objectIds(values = []) {
  return ids(values).filter((value) => mongoose.isValidObjectId(value));
}

function clause(resourceType, resourceIds = null) {
  if (resourceIds === null) return { resourceType };
  const values = objectIds(resourceIds);
  return values.length ? { resourceType, resourceId: { $in: values } } : null;
}

async function resolveVenueSelectorProjection() {
  const venues = await Venue.find({ lifecycleStatus: "active" })
    .select("name description ownerOrganizationId")
    .sort({ name: 1, _id: 1 })
    .lean();
  const organizationIds = ids(venues.map((venue) => venue.ownerOrganizationId));
  if (!organizationIds.length) return { organizations: [] };
  const Organization = require("../models/organization.model");
  const organizations = await Organization.find({ _id: { $in: organizationIds }, lifecycleStatus: "active" })
    .select("name description")
    .sort({ name: 1, _id: 1 })
    .lean();
  const venuesByOrganization = new Map();
  for (const venue of venues) {
    const key = String(venue.ownerOrganizationId);
    if (!venuesByOrganization.has(key)) venuesByOrganization.set(key, []);
    venuesByOrganization.get(key).push({
      id: venue._id,
      name: venue.name,
      description: venue.description || "",
    });
  }
  return {
    organizations: organizations
      .map((organization) => ({
        id: organization._id,
        name: organization.name,
        description: organization.description || "",
        venues: venuesByOrganization.get(String(organization._id)) || [],
      }))
      .filter((organization) => organization.venues.length > 0),
  };
}

async function resolveVenueCatalogFilter({ selectedVenueIds = [] } = {}) {
  const requestedVenueIds = ids(selectedVenueIds);
  if (!requestedVenueIds.length) {
    return {
      selectedVenueIds: [],
      listingQuery: null,
      evidence: { venueTargetIds: [], subjectIds: [], primaryEditorialContextIds: [] },
    };
  }
  const invalid = requestedVenueIds.filter((value) => !mongoose.isValidObjectId(value));
  if (invalid.length) {
    throw new AppError("selectedVenueIds contiene valori non validi", 400, [{
      field: "selectedVenueIds",
      code: "INVALID_OBJECT_ID",
      context: { invalid },
    }]);
  }

  const venues = await Venue.find({ _id: { $in: requestedVenueIds }, lifecycleStatus: "active" })
    .select("_id primaryEditorialContextId")
    .lean();
  if (venues.length !== requestedVenueIds.length) {
    const found = new Set(venues.map((venue) => String(venue._id)));
    const missing = requestedVenueIds.filter((value) => !found.has(String(value)));
    throw new AppError("Una o più Venue selezionate non sono disponibili", 404, [{
      field: "selectedVenueIds",
      code: "VENUE_NOT_AVAILABLE",
      context: { missing },
    }]);
  }

  const targets = await VenueTarget.find({
    venueId: { $in: requestedVenueIds },
    lifecycleStatus: "active",
  }).select("_id venueId subjectId").lean();
  const venueTargetIds = ids(targets);
  const subjectIds = ids(targets.map((target) => target.subjectId));
  const primaryEditorialContextIds = ids(venues.map((venue) => venue.primaryEditorialContextId));

  const primaryItems = subjectIds.length
    ? await ItemV2.find({ lifecycleStatus: "active", primarySubjectId: { $in: subjectIds } }).select("_id").lean()
    : [];
  const primaryItemIds = ids(primaryItems);

  const subjectRevisionQuery = subjectIds.length ? {
    $or: [
      { relatedSubjectIds: { $in: subjectIds } },
      { "presentationVariants.semanticFocus.subjectId": { $in: subjectIds } },
      { "presentationVariants.knowledgeRequirements.subjectId": { $in: subjectIds } },
    ],
  } : null;
  const subjectRevisions = subjectRevisionQuery
    ? await ItemRevisionV2.find(subjectRevisionQuery).select("_id itemEditionId").lean()
    : [];
  const revisionEditionIds = ids(subjectRevisions.map((revision) => revision.itemEditionId));
  const primaryEditions = primaryItemIds.length
    ? await ItemEdition.find({ itemId: { $in: primaryItemIds } }).select("_id").lean()
    : [];
  const relevantEditionIds = ids([...primaryEditions, ...revisionEditionIds]);

  const relevantRevisions = relevantEditionIds.length
    ? await ItemRevisionV2.find({ itemEditionId: { $in: relevantEditionIds } }).select("_id itemEditionId").lean()
    : subjectRevisions;
  const relevantRevisionIds = ids(relevantRevisions);

  const releaseConditions = [];
  if (relevantEditionIds.length) releaseConditions.push({ "itemBindings.itemEditionId": { $in: relevantEditionIds } });
  if (relevantRevisionIds.length) releaseConditions.push({ "itemBindings.itemRevisionId": { $in: relevantRevisionIds } });
  if (primaryEditorialContextIds.length) releaseConditions.push({ editorialContextId: { $in: primaryEditorialContextIds } });
  const relevantReleases = releaseConditions.length
    ? await EditorialRelease.find({ $or: releaseConditions }).select("_id editorialContextId").lean()
    : [];
  const relevantReleaseIds = ids(relevantReleases);
  const relevantContextIds = ids([
    ...primaryEditorialContextIds,
    ...relevantReleases.map((release) => release.editorialContextId),
  ]);

  // Context lineages with no release are not marketable, but the explicit lookup keeps
  // primary-context endorsement independent from the release query above.
  if (relevantContextIds.length) {
    await EditorialContext.find({ _id: { $in: relevantContextIds }, lifecycleStatus: "active" }).select("_id").lean();
  }

  const relevantVisitRevisions = venueTargetIds.length
    ? await VisitRevisionV2.find({ "visitAnchors.venueTargetId": { $in: venueTargetIds } }).select("_id visitId").lean()
    : [];
  const relevantVisitRevisionIds = ids(relevantVisitRevisions);
  const relevantVisitIds = ids(relevantVisitRevisions.map((revision) => revision.visitId));

  const resourceClauses = [
    clause("item_edition", relevantEditionIds),
    clause("item_revision", relevantRevisionIds),
    clause("editorial_context", relevantContextIds),
    clause("editorial_release", relevantReleaseIds),
    clause("visit", relevantVisitIds),
    clause("visit_revision", relevantVisitRevisionIds),
    // Namespace is intrinsically Venue-neutral. The Venue selector must not invent
    // physical ownership or venueIds for semantic/editorial vocabularies.
    clause("namespace", null),
    clause("namespace_revision", null),
  ].filter(Boolean);

  return {
    selectedVenueIds: requestedVenueIds,
    listingQuery: resourceClauses.length ? { $or: resourceClauses } : { _id: null },
    evidence: {
      venueTargetIds,
      subjectIds,
      primaryEditorialContextIds,
      relevantEditionIds,
      relevantRevisionIds,
      relevantContextIds,
      relevantReleaseIds,
      relevantVisitIds,
      relevantVisitRevisionIds,
    },
  };
}

async function projectVisitPhysicalScope({ revision }) {
  const targetIds = ids((revision?.visitAnchors || []).map((anchor) => anchor.venueTargetId));
  if (!targetIds.length) return { venues: [] };
  const targets = await VenueTarget.find({ _id: { $in: targetIds } }).select("venueId").lean();
  const venueIds = ids(targets.map((target) => target.venueId));
  const venues = venueIds.length
    ? await Venue.find({ _id: { $in: venueIds } }).select("name description").lean()
    : [];
  const byId = new Map(venues.map((venue) => [String(venue._id), venue]));
  return {
    venues: venueIds.map((venueId) => {
      const venue = byId.get(String(venueId));
      return { id: venueId, name: venue?.name || "Venue", description: venue?.description || "" };
    }),
  };
}

async function projectVenueRelevance({ marketable, filter }) {
  if (!filter?.selectedVenueIds?.length) return null;
  const type = marketable.resourceType;
  if (type === "namespace" || type === "namespace_revision") {
    return { venueNeutral: true, matchedVenueIds: [], evidence: ["venue_neutral"] };
  }
  if (type === "visit" || type === "visit_revision") {
    const physicalScope = await projectVisitPhysicalScope({ revision: marketable.snapshot });
    const selected = new Set(filter.selectedVenueIds.map(String));
    return {
      venueNeutral: false,
      matchedVenueIds: physicalScope.venues.map((venue) => String(venue.id)).filter((venueId) => selected.has(venueId)),
      evidence: ["physical_scope"],
      physicalScope,
    };
  }
  const resourceId = String(marketable.resourceId);
  const evidence = filter.evidence || {};
  if ((type === "editorial_context" && (evidence.primaryEditorialContextIds || []).map(String).includes(resourceId))) {
    return { venueNeutral: false, matchedVenueIds: filter.selectedVenueIds, evidence: ["primary_editorial_context"] };
  }
  if (type === "editorial_context" || type === "editorial_release") {
    return { venueNeutral: false, matchedVenueIds: filter.selectedVenueIds, evidence: ["relevant_editorial_corpus"] };
  }
  return { venueNeutral: false, matchedVenueIds: filter.selectedVenueIds, evidence: ["subject_materialized_in_venue"] };
}

module.exports = {
  resolveVenueSelectorProjection,
  resolveVenueCatalogFilter,
  projectVenueRelevance,
  projectVisitPhysicalScope,
};
