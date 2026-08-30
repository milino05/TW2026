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
const { projectVisitAuthoringRouteReview } = require("./visitAuthoringRouteReviewV2.service");
const { venueTargetIdentityMap } = require("./venueTargetIdentityProjection.service");

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

function enrichRouteReview(routeReview, stops) {
  const stopById = new Map((stops || []).map((stop) => [id(stop.id), stop]));
  return {
    ...routeReview,
    legs: (routeReview?.legs || []).map((leg) => {
      const from = stopById.get(id(leg.fromAnchorId));
      const to = stopById.get(id(leg.toAnchorId));
      return {
        ...leg,
        fromStop: from ? { id: from.id, label: from.label, venue: from.venue } : null,
        toStop: to ? { id: to.id, label: to.label, venue: to.venue } : null,
      };
    }),
  };
}

async function hydrateVisitRevision(revision) {
  if (!revision) return null;
  const sourceReleaseIds = [
    ...(revision.editorialSources || []).map((entry) => entry.editorialReleaseId),
    ...(revision.contentSources || []).filter((entry) => entry.sourceType === "editorial_release").map((entry) => entry.editorialReleaseId),
  ];
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
    ? await VenueTarget.find({ _id: { $in: targetIds } }).select("venueId subjectId displayLabelOverride inventoryNote").lean()
    : [];
  const venues = targets.length
    ? await Venue.find({ _id: { $in: targets.map((entry) => entry.venueId) } }).select("name").lean()
    : [];
  const targetById = new Map(targets.map((entry) => [id(entry), entry]));
  const targetIdentityById = await venueTargetIdentityMap(targets);
  const venueById = new Map(venues.map((entry) => [id(entry), entry]));
  const anchorById = new Map((revision.visitAnchors || []).map((entry) => [id(entry._id), entry]));
  const projectedContentSources = [
    ...(revision.contentSources || []).map((source) => {
      if (source.sourceType === "item_revision") return {
        id: source._id,
        sourceType: "item_revision",
        itemRevisionId: source.itemRevisionId,
        name: "Contenuto disponibile direttamente",
      };
      const release = releaseById.get(id(source.editorialReleaseId));
      const context = release ? contextById.get(id(release.editorialContextId)) : null;
      return {
        id: source._id,
        sourceType: "editorial_release",
        editorialReleaseId: source.editorialReleaseId,
        editorialContextId: release?.editorialContextId || null,
        name: context?.displayName || "Raccolta editoriale",
        version: release?.version || null,
      };
    }),
    ...(revision.editorialSources || []).map((source) => {
      const release = releaseById.get(id(source.editorialReleaseId));
      const context = release ? contextById.get(id(release.editorialContextId)) : null;
      return {
        id: source._id,
        sourceType: "editorial_release",
        editorialReleaseId: source.editorialReleaseId,
        editorialContextId: release?.editorialContextId || null,
        name: context?.displayName || "Raccolta editoriale",
        version: release?.version || null,
        legacy: true,
      };
    }),
  ];
  const contentSourceById = new Map(projectedContentSources.map((entry) => [id(entry.id), entry]));

  const projectedAnchors = (revision.visitAnchors || []).map((anchor, index) => {
    const target = targetById.get(id(anchor.venueTargetId));
    const venue = target ? venueById.get(id(target.venueId)) : null;
    return {
      id: anchor._id,
      order: index,
      venueTargetId: anchor.venueTargetId,
      label: target ? targetIdentityById.get(id(target._id))?.label : "Target non disponibile",
      subjectId: target?.subjectId || null,
      venue: target ? { id: target.venueId, name: venue?.name || "Venue" } : null,
    };
  });
  const projectedEntries = (revision.contentEntries || []).map((entry, index) => {
    const itemRevision = itemRevisionById.get(id(entry.itemRevisionId));
    const item = itemById.get(id(entry.itemId));
    const anchor = entry.deliveryAnchorId ? anchorById.get(id(entry.deliveryAnchorId)) : null;
    const target = anchor ? targetById.get(id(anchor.venueTargetId)) : null;
    const venue = target ? venueById.get(id(target.venueId)) : null;
    return {
      id: entry._id,
      order: index,
      contentSourceId: entry.contentSourceId || entry.editorialSourceId,
      editorialSourceId: entry.editorialSourceId,
      source: contentSourceById.get(id(entry.contentSourceId || entry.editorialSourceId)) || null,
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
        label: targetIdentityById.get(id(target._id))?.label || "Entità della sede",
        subjectId: target.subjectId,
        venue: { id: target.venueId, name: venue?.name || "Venue" },
      } : null,
      role: entry.role || "recommended",
    };
  });
  const entriesByAnchor = new Map(projectedAnchors.map((anchor) => [id(anchor.id), []]));
  const contextualEntries = [];
  for (const entry of projectedEntries) {
    if (entry.deliveryAnchorId && entriesByAnchor.has(id(entry.deliveryAnchorId))) entriesByAnchor.get(id(entry.deliveryAnchorId)).push(entry);
    else contextualEntries.push(entry);
  }
  const stops = projectedAnchors.map((anchor) => ({
    ...anchor,
    contents: entriesByAnchor.get(id(anchor.id)) || [],
  }));
  const routeReview = enrichRouteReview(await projectVisitAuthoringRouteReview(revision), stops);

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
    contentSources: projectedContentSources,
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
    // Raw projections remain temporarily available to non-stop-centric consumers. The
    // Marketplace Visit editor consumes stops/contextualEntries instead of rewriting them.
    anchors: projectedAnchors,
    entries: projectedEntries,
    stops,
    contextualEntries,
    routeReview,
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
        capabilities: visit.ownerType === "user" ? { edit: true, review: true, publish: true } : {
          edit: workspace.principal.effectivePermissions.includes("visit.edit"),
          review: workspace.principal.effectivePermissions.includes("visit.review"),
          publish: workspace.principal.effectivePermissions.includes("visit.publish"),
        },
        revision,
      })
    : [];
  const mayStartOrContinueEdit = Boolean(visit && revision && (
    mayEditEditorialRevision(revision) || revision.status === "published"
  ));
  const canEdit = workspace.principal.type === "user" || workspace.principal.effectivePermissions.includes("visit.edit");
  const editOperations = mayStartOrContinueEdit && canEdit
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
      : (workspace.principal.type === "user" || workspace.principal.effectivePermissions.includes("visit.create"))
        ? [{ code: "visit.create", label: "Crea visita" }]
        : [],
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

function candidateReason({ sourceKey, sourceType, itemRevisionId, editorialReleaseId = null, accessKind, label, sourceName = null, priority }) {
  return {
    sourceKey,
    sourceType,
    itemRevisionId,
    editorialReleaseId,
    accessKind,
    label,
    sourceName,
    priority,
  };
}

function directRevisionRef(asset) {
  const ref = asset.publishedSnapshotRef || asset.snapshotRef;
  return ref?.resourceType === "item_revision" ? ref.resourceId : null;
}

async function searchVisitAuthoringCandidates({
  actorUserId,
  visitId,
  queryText = "",
  access = "all",
  source = "all",
  venueId = null,
  page = 1,
  limit = 30,
}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 30));
  const safeAccess = ["all", "owned", "acquired"].includes(access) ? access : "all";
  const { workspace } = await resolveAuthoringPrincipal({ actorUserId, visitId });
  const reasonsByEdition = new Map();
  const sourceFilters = new Map();

  function addReason(itemEditionId, reason) {
    const key = id(itemEditionId);
    if (!key || !reason.itemRevisionId) return;
    if (!reasonsByEdition.has(key)) reasonsByEdition.set(key, []);
    const reasons = reasonsByEdition.get(key);
    if (!reasons.some((entry) => entry.sourceKey === reason.sourceKey && id(entry.itemRevisionId) === id(reason.itemRevisionId))) reasons.push(reason);
  }

  for (const asset of workspace.ownedAssets || []) {
    if (asset.resourceType !== "item_edition") continue;
    const itemRevisionId = directRevisionRef(asset);
    if (!itemRevisionId) continue;
    sourceFilters.set("owned", { key: "owned", label: "Creati da questa area", kind: "direct" });
    addReason(asset.resourceId, candidateReason({
      sourceKey: "owned",
      sourceType: "item_revision",
      itemRevisionId,
      accessKind: "owned",
      label: workspace.principal.type === "organization" ? "Creato dall’organizzazione" : "Creato da te",
      priority: 0,
    }));
  }

  for (const asset of workspace.licensedAssets || []) {
    if (!["item_edition", "item_revision"].includes(asset.resourceType) || !(asset.capabilities || []).includes("content.use_in_visit")) continue;
    const itemRevisionId = directRevisionRef(asset);
    const itemEditionId = asset.sourceRef?.resourceType === "item_edition" ? asset.sourceRef.resourceId : (asset.resourceType === "item_edition" ? asset.resourceId : null);
    if (!itemRevisionId || !itemEditionId) continue;
    sourceFilters.set("acquired", { key: "acquired", label: "Acquistati singolarmente", kind: "direct" });
    addReason(itemEditionId, candidateReason({
      sourceKey: "acquired",
      sourceType: "item_revision",
      itemRevisionId,
      accessKind: "acquired",
      label: "Acquistato singolarmente",
      priority: 1,
    }));
  }

  const collections = sourceOptionsFromWorkspace(workspace);
  const releases = collections.length
    ? await EditorialRelease.find({ _id: { $in: collections.map((entry) => entry.editorialReleaseId) } }).select("itemBindings").lean()
    : [];
  const releaseById = new Map(releases.map((entry) => [id(entry._id), entry]));
  for (const collection of collections) {
    const release = releaseById.get(id(collection.editorialReleaseId));
    if (!release) continue;
    const sourceKey = `editorial_release:${id(release._id)}`;
    sourceFilters.set(sourceKey, { key: sourceKey, label: collection.name, kind: "editorial_release", ownership: collection.ownership });
    for (const binding of release.itemBindings || []) {
      addReason(binding.itemEditionId, candidateReason({
        sourceKey,
        sourceType: "editorial_release",
        itemRevisionId: binding.itemRevisionId,
        editorialReleaseId: release._id,
        accessKind: collection.ownership === "licensed" ? "acquired" : "owned",
        label: `Raccolta “${collection.name}”`,
        sourceName: collection.name,
        priority: collection.ownership === "licensed" ? 3 : 2,
      }));
    }
  }

  const selectedByEdition = new Map();
  for (const [editionId, reasons] of reasonsByEdition) {
    const matching = reasons.filter((reason) => (
      (safeAccess === "all" || reason.accessKind === safeAccess)
      && (source === "all" || reason.sourceKey === source)
    ));
    if (!matching.length) continue;
    matching.sort((left, right) => left.priority - right.priority || String(left.sourceKey).localeCompare(String(right.sourceKey), "it"));
    selectedByEdition.set(editionId, { selected: matching[0], reasons: matching });
  }

  let allowedEditionIds = [...selectedByEdition.keys()];
  let preloadedEditionById = null;
  let preloadedItemById = null;
  if (venueId && allowedEditionIds.length) {
    const editions = await ItemEdition.find({ _id: { $in: allowedEditionIds } }).select("itemId").lean();
    preloadedEditionById = new Map(editions.map((entry) => [id(entry._id), entry]));
    const items = await ItemV2.find({ _id: { $in: editions.map((entry) => entry.itemId) }, lifecycleStatus: "active" }).select("primarySubjectId").lean();
    preloadedItemById = new Map(items.map((entry) => [id(entry._id), entry]));
    const subjectIds = items.map((entry) => entry.primarySubjectId).filter(Boolean);
    const targets = subjectIds.length ? await VenueTarget.find({ venueId, subjectId: { $in: subjectIds }, lifecycleStatus: "active" }).select("subjectId").lean() : [];
    const allowedSubjects = new Set(targets.map((entry) => id(entry.subjectId)));
    allowedEditionIds = allowedEditionIds.filter((editionId) => {
      const edition = preloadedEditionById.get(editionId);
      const item = edition ? preloadedItemById.get(id(edition.itemId)) : null;
      return item && allowedSubjects.has(id(item.primarySubjectId));
    });
  }

  const revisionIds = allowedEditionIds.map((editionId) => selectedByEdition.get(editionId)?.selected.itemRevisionId).filter(Boolean);
  const query = { _id: { $in: revisionIds }, status: { $in: ["published", "superseded"] } };
  const trimmed = String(queryText || "").trim();
  if (trimmed) query.$or = [
    { label: { $regex: escapeRegex(trimmed), $options: "i" } },
    { authorCredits: { $regex: escapeRegex(trimmed), $options: "i" } },
  ];
  const [total, revisions] = await Promise.all([
    ItemRevisionV2.countDocuments(query),
    ItemRevisionV2.find(query)
      .select("label authorCredits metadata.license itemEditionId presentationVariants")
      .sort({ label: 1, _id: 1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
  ]);
  const editionIds = revisions.map((entry) => entry.itemEditionId);
  const editions = preloadedEditionById
    ? editionIds.map((editionId) => preloadedEditionById.get(id(editionId))).filter(Boolean)
    : await ItemEdition.find({ _id: { $in: editionIds } }).select("itemId namespaceId").lean();
  const editionById = new Map(editions.map((entry) => [id(entry._id), entry]));
  const itemIds = editions.map((entry) => entry.itemId);
  const items = preloadedItemById
    ? itemIds.map((itemId) => preloadedItemById.get(id(itemId))).filter(Boolean)
    : await ItemV2.find({ _id: { $in: itemIds }, lifecycleStatus: "active" }).select("primarySubjectId").lean();
  const itemById = new Map(items.map((entry) => [id(entry._id), entry]));

  return {
    page: safePage,
    limit: safeLimit,
    total,
    filters: {
      access: safeAccess,
      source,
      venueId: venueId || null,
      sources: [...sourceFilters.values()].sort((left, right) => left.label.localeCompare(right.label, "it")),
    },
    results: revisions.map((revision) => {
      const edition = editionById.get(id(revision.itemEditionId));
      const item = edition ? itemById.get(id(edition.itemId)) : null;
      const choice = selectedByEdition.get(id(revision.itemEditionId));
      if (!edition || !item || !choice) return null;
      const selected = choice.selected;
      return {
        itemId: edition.itemId,
        itemEditionId: revision.itemEditionId,
        itemRevisionId: revision._id,
        primarySubjectId: item.primarySubjectId || null,
        label: revision.label,
        authorCredits: revision.authorCredits || [],
        license: revision.metadata?.license || null,
        presentationProfiles: presentationProfiles(revision),
        contentSource: selected.sourceType === "editorial_release"
          ? { sourceType: "editorial_release", editorialReleaseId: selected.editorialReleaseId }
          : { sourceType: "item_revision", itemRevisionId: revision._id },
        availability: choice.reasons.map((reason) => ({
          sourceKey: reason.sourceKey,
          accessKind: reason.accessKind,
          label: reason.label,
          sourceName: reason.sourceName,
        })),
      };
    }).filter(Boolean),
  };
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
  hydrateVisitRevision,
  getVisitAuthoringProjection,
  searchVisitAuthoringContent,
  searchVisitAuthoringCandidates,
};
