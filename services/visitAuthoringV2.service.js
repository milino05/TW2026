const EditorialRelease = require("../models/editorialRelease.model");
const EditorialContext = require("../models/editorialContext.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemV2 = require("../models/itemV2.model");
const VenueTarget = require("../models/venueTarget.model");
const Venue = require("../models/venue.model");
const visitService = require("./visitV2.service");
const marketplaceCatalog = require("./marketplaceCatalogV2.service");
const { getCreatorWorkspace } = require("./marketplaceWorkspaceV2.service");
const { projectEditorialWorkflowOperations, mayEditEditorialRevision } = require("./editorialWorkflowOperationsV2.service");
const { assertCanComposeEditorialRelease } = require("./visitEditorialUsageAuthorization.service");

function id(value) { return String(value?._id || value || ""); }
function escapeRegex(value) { return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function sourceOptionsFromWorkspace(workspace) {
  const options = [];
  const seen = new Set();
  function add(asset, ownership) {
    const sourceRef = asset.sourceRef;
    const snapshotRef = asset.publishedSnapshotRef || asset.snapshotRef;
    if (sourceRef?.resourceType !== "editorial_context" || snapshotRef?.resourceType !== "editorial_release") return;
    const releaseId = id(snapshotRef.resourceId);
    if (!releaseId || seen.has(releaseId)) return;
    seen.add(releaseId);
    options.push({
      editorialContextId: sourceRef.resourceId,
      editorialReleaseId: snapshotRef.resourceId,
      name: asset.title || "Contesto editoriale",
      summary: asset.summary || "",
      ownership,
      versionMode: ownership === "licensed" ? (asset.versionMode || "pinned") : "current",
    });
  }
  for (const asset of workspace.ownedAssets || []) {
    if (asset.resourceType === "editorial_context") add(asset, "owned");
  }
  for (const asset of workspace.licensedAssets || []) {
    if (!(asset.capabilities || []).includes("context.compose_visit")) continue;
    add(asset, "licensed");
  }
  return options.sort((a, b) => a.name.localeCompare(b.name, "it"));
}

async function hydrateVisitRevision(revision) {
  if (!revision) return null;
  const sourceReleaseIds = (revision.editorialSources || []).map((entry) => entry.editorialReleaseId);
  const releases = sourceReleaseIds.length
    ? await EditorialRelease.find({ _id: { $in: sourceReleaseIds } }).select("editorialContextId version").lean()
    : [];
  const contexts = releases.length
    ? await EditorialContext.find({ _id: { $in: releases.map((entry) => entry.editorialContextId) } }).select("displayName shortDescription").lean()
    : [];
  const releaseById = new Map(releases.map((entry) => [id(entry), entry]));
  const contextById = new Map(contexts.map((entry) => [id(entry), entry]));

  const itemRevisionIds = (revision.contentEntries || []).map((entry) => entry.itemRevisionId);
  const itemIds = [...new Set((revision.contentEntries || []).map((entry) => id(entry.itemId)).filter(Boolean))];
  const [itemRevisions, items] = await Promise.all([
    itemRevisionIds.length
      ? ItemRevisionV2.find({ _id: { $in: itemRevisionIds } }).select("label authorCredits metadata.license").lean()
      : [],
    itemIds.length
      ? ItemV2.find({ _id: { $in: itemIds }, lifecycleStatus: "active" }).select("primarySubjectId").lean()
      : [],
  ]);
  const itemRevisionById = new Map(itemRevisions.map((entry) => [id(entry), entry]));
  const itemById = new Map(items.map((entry) => [id(entry), entry]));

  const targetIds = (revision.visitAnchors || []).map((entry) => entry.venueTargetId);
  const targets = targetIds.length
    ? await VenueTarget.find({ _id: { $in: targetIds } }).select("venueId subjectId label description").lean()
    : [];
  const venues = targets.length
    ? await Venue.find({ _id: { $in: targets.map((entry) => entry.venueId) } }).select("name").lean()
    : [];
  const targetById = new Map(targets.map((entry) => [id(entry), entry]));
  const venueById = new Map(venues.map((entry) => [id(entry), entry]));
  const anchorById = new Map((revision.visitAnchors || []).map((entry) => [id(entry._id), entry]));

  return {
    id: revision._id,
    version: revision.version,
    status: revision.status,
    integrity: {
      status: revision.integrity?.status || "needs_review",
      issues: (revision.integrity?.issues || []).map((issue) => ({
        field: issue.field || null,
        code: issue.code,
        message: issue.message,
        severity: issue.severity || "error",
      })),
    },
    title: revision.title,
    description: revision.description || "",
    editorialSources: (revision.editorialSources || []).map((source) => {
      const release = releaseById.get(id(source.editorialReleaseId));
      const context = release ? contextById.get(id(release.editorialContextId)) : null;
      return {
        id: source._id,
        editorialReleaseId: source.editorialReleaseId,
        editorialContextId: release?.editorialContextId || null,
        name: context?.displayName || "Contesto editoriale",
        version: release?.version || null,
      };
    }),
    anchors: (revision.visitAnchors || []).map((anchor) => {
      const target = targetById.get(id(anchor.venueTargetId));
      const venue = target ? venueById.get(id(target.venueId)) : null;
      return {
        id: anchor._id,
        venueTargetId: anchor.venueTargetId,
        label: target?.label || "Target non disponibile",
        subjectId: target?.subjectId || null,
        venue: target ? { id: target.venueId, name: venue?.name || "Venue" } : null,
      };
    }),
    entries: (revision.contentEntries || []).map((entry, index) => {
      const itemRevision = itemRevisionById.get(id(entry.itemRevisionId));
      const item = itemById.get(id(entry.itemId));
      const anchor = entry.deliveryAnchorId ? anchorById.get(id(entry.deliveryAnchorId)) : null;
      const target = anchor ? targetById.get(id(anchor.venueTargetId)) : null;
      const venue = target ? venueById.get(id(target.venueId)) : null;
      return {
        id: entry._id,
        order: index,
        editorialSourceId: entry.editorialSourceId,
        itemId: entry.itemId,
        itemEditionId: entry.itemEditionId,
        itemRevisionId: entry.itemRevisionId,
        primarySubjectId: item?.primarySubjectId || null,
        label: itemRevision?.label || "Contenuto non disponibile",
        authorCredits: itemRevision?.authorCredits || [],
        license: itemRevision?.metadata?.license || null,
        deliveryAnchorId: entry.deliveryAnchorId || null,
        deliveryTarget: target ? {
          id: target._id,
          label: target.label,
          subjectId: target.subjectId,
          venue: { id: target.venueId, name: venue?.name || "Venue" },
        } : null,
        role: entry.role || "recommended",
      };
    }),
    presentationBaseline: revision.presentationBaseline ? {
      depthPreference: revision.presentationBaseline.depthPreference ?? null,
      languageComplexityPreference: revision.presentationBaseline.languageComplexityPreference ?? null,
      locale: revision.presentationBaseline.locale || null,
    } : null,
    logistics: {
      preVisitNotes: revision.logistics?.preVisitNotes || [],
      routeHints: (revision.logistics?.routeHints || []).map((hint) => ({
        id: hint._id,
        fromAnchorId: hint.fromAnchorId,
        toAnchorId: hint.toAnchorId,
        type: hint.type,
        instructionOverride: hint.instructionOverride || null,
        note: hint.note || null,
        estimatedTransferSeconds: hint.estimatedTransferSeconds ?? null,
      })),
    },
  };
}

async function resolveAuthoringPrincipal({ actorUserId, visitId = null, principalType = null, principalId = null }) {
  if (visitId) {
    const { visit, revision } = await visitService.getVisitV2({ visitId, actorUserId, view: "working" });
    const workspace = await getCreatorWorkspace({
      actorUserId,
      principalType: visit.ownerType,
      principalId: visit.ownerId,
    });
    return { workspace, visit, revision };
  }
  const workspace = await getCreatorWorkspace({
    actorUserId,
    principalType: principalType || "user",
    principalId: principalId || actorUserId,
  });
  return { workspace, visit: null, revision: null };
}

async function getVisitAuthoringProjection({ actorUserId, visitId = null, principalType = null, principalId = null }) {
  const { workspace, visit, revision } = await resolveAuthoringPrincipal({
    actorUserId,
    visitId,
    principalType,
    principalId,
  });
  const [venueSelector, projectedRevision] = await Promise.all([
    marketplaceCatalog.resolveVenueSelectorProjection(),
    hydrateVisitRevision(revision),
  ]);
  const workflowOperations = visit && revision
    ? projectEditorialWorkflowOperations({
        ownerType: visit.ownerType,
        actorRole: workspace.principal.role,
        revision,
      })
    : [];
  const mayStartOrContinueEdit = Boolean(visit && revision && (
    mayEditEditorialRevision(revision) || revision.status === "published"
  ));
  const editOperations = mayStartOrContinueEdit
    ? [{ code: "visit.edit", label: revision.status === "published" ? "Crea nuova revisione" : "Modifica visita" }]
    : [];
  return {
    principal: workspace.principal,
    availablePrincipals: visit ? [workspace.principal] : workspace.availablePrincipals,
    editorialSources: sourceOptionsFromWorkspace(workspace),
    venueSelector,
    visit: visit ? {
      id: visit._id,
      owner: { type: visit.ownerType, id: visit.ownerId },
      revision: projectedRevision,
    } : null,
    availableOperations: visit
      ? [...editOperations, ...workflowOperations]
      : [{ code: "visit.create", label: "Crea visita" }],
  };
}

function presentationProfiles(revision) {
  const profiles = [];
  const seen = new Set();
  for (const variant of revision.presentationVariants || []) {
    for (const representation of variant.representations || []) {
      const key = [representation.durationTypeDefinitionId, representation.languageLevelDefinitionId, representation.locale].join("::");
      if (seen.has(key)) continue;
      seen.add(key);
      profiles.push({
        durationTypeDefinitionId: representation.durationTypeDefinitionId,
        languageLevelDefinitionId: representation.languageLevelDefinitionId,
        locale: representation.locale,
      });
    }
  }
  return profiles;
}

async function searchVisitAuthoringContent({
  actorUserId,
  editorialReleaseId,
  principalType,
  principalId,
  queryText = "",
  page = 1,
  limit = 30,
}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 30));
  const access = await assertCanComposeEditorialRelease({
    editorialReleaseId,
    actorUserId,
    principalType,
    principalId,
  });
  const release = access.release;
  const bindings = release.itemBindings || [];
  const revisionIds = bindings.map((entry) => entry.itemRevisionId);
  const query = { _id: { $in: revisionIds }, status: { $in: ["published", "superseded"] } };
  const trimmed = String(queryText || "").trim();
  if (trimmed) query.label = { $regex: escapeRegex(trimmed), $options: "i" };

  const [total, revisions] = await Promise.all([
    ItemRevisionV2.countDocuments(query),
    ItemRevisionV2.find(query)
      .select("label authorCredits metadata.license itemEditionId presentationVariants")
      .sort({ label: 1, _id: 1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
  ]);
  const bindingByRevisionId = new Map(bindings.map((entry) => [id(entry.itemRevisionId), entry]));
  const editionIds = revisions.map((entry) => entry.itemEditionId);
  const editions = editionIds.length
    ? await ItemEdition.find({ _id: { $in: editionIds } }).select("itemId namespaceId").lean()
    : [];
  const editionById = new Map(editions.map((entry) => [id(entry), entry]));
  const itemIds = editions.map((entry) => entry.itemId);
  const items = itemIds.length
    ? await ItemV2.find({ _id: { $in: itemIds }, lifecycleStatus: "active" }).select("primarySubjectId").lean()
    : [];
  const itemById = new Map(items.map((entry) => [id(entry), entry]));

  return {
    source: {
      editorialContextId: access.context._id,
      editorialReleaseId: release._id,
      name: access.context.displayName,
      version: release.version,
    },
    page: safePage,
    limit: safeLimit,
    total,
    results: revisions.map((revision) => {
      const binding = bindingByRevisionId.get(id(revision._id));
      const edition = editionById.get(id(revision.itemEditionId));
      const item = edition ? itemById.get(id(edition.itemId)) : null;
      return {
        itemId: edition?.itemId || null,
        itemEditionId: revision.itemEditionId,
        itemRevisionId: revision._id,
        primarySubjectId: item?.primarySubjectId || null,
        label: revision.label,
        authorCredits: revision.authorCredits || [],
        license: revision.metadata?.license || null,
        presentationProfiles: presentationProfiles(revision),
        curationSignals: (binding?.curationSignals || []).map((entry) => ({
          definitionId: entry.definitionId,
          weight: entry.weight,
        })),
      };
    }).filter((entry) => entry.itemId),
  };
}

module.exports = {
  sourceOptionsFromWorkspace,
  getVisitAuthoringProjection,
  searchVisitAuthoringContent,
};