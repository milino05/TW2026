const mongoose = require("mongoose");
const EditorialRelease = require("../models/editorialRelease.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemV2 = require("../models/itemV2.model");
const AppError = require("../utils/AppError");
const { getVisitV2, updateVisitV2 } = require("./visitV2.service");
const { assertCanUseItemRevisionInVisit } = require("./visitEditorialUsageAuthorization.service");
const { assertPublishedTargetForSubject } = require("./visitPlacementOptionsV2.service");

function id(value) { return String(value?._id || value || ""); }
function newId() { return new mongoose.Types.ObjectId(); }

function contentSources(revision) {
  return (revision.contentSources || []).map((source) => ({
    _id: source._id,
    sourceType: source.sourceType,
    editorialReleaseId: source.editorialReleaseId || null,
    itemRevisionId: source.itemRevisionId || null,
  }));
}
function contentEntries(revision) {
  return (revision.contentEntries || []).map((entry) => ({
    _id: entry._id,
    contentSourceId: entry.contentSourceId || null,
    editorialSourceId: entry.editorialSourceId || null,
    itemId: entry.itemId,
    itemEditionId: entry.itemEditionId,
    itemRevisionId: entry.itemRevisionId,
    deliveryAnchorId: entry.deliveryAnchorId || null,
    role: entry.role || "recommended",
  }));
}
function visitAnchors(revision) {
  return (revision.visitAnchors || []).map((anchor) => ({
    _id: anchor._id,
    venueTargetId: anchor.venueTargetId,
  }));
}
function logistics(revision) {
  return {
    preVisitNotes: revision.logistics?.preVisitNotes || [],
    routeHints: (revision.logistics?.routeHints || []).map((hint) => ({
      _id: hint._id,
      fromAnchorId: hint.fromAnchorId,
      toAnchorId: hint.toAnchorId,
      type: hint.type,
      instructionOverride: hint.instructionOverride || null,
      note: hint.note || null,
      estimatedTransferSeconds: hint.estimatedTransferSeconds ?? null,
    })),
  };
}

async function loadEditableVisit({ visitId, actorUserId }) {
  return getVisitV2({ visitId, actorUserId, view: "working" });
}

async function resolveReleasedContent({ editorialReleaseId, itemEditionId, itemRevisionId }) {
  if (!mongoose.isValidObjectId(editorialReleaseId) || !mongoose.isValidObjectId(itemEditionId) || !mongoose.isValidObjectId(itemRevisionId)) {
    throw new AppError("Selezione contenuto non valida", 400, [{ field: "content", code: "INVALID_OBJECT_ID" }]);
  }
  const release = await EditorialRelease.findById(editorialReleaseId).lean();
  if (!release) throw new AppError("EditorialRelease non disponibile", 404, [{ field: "editorialReleaseId", code: "EDITORIAL_RELEASE_NOT_FOUND" }]);
  const binding = (release.itemBindings || []).find((entry) => (
    id(entry.itemEditionId) === id(itemEditionId) && id(entry.itemRevisionId) === id(itemRevisionId)
  ));
  if (!binding) {
    throw new AppError("Il contenuto non appartiene alla EditorialRelease selezionata", 409, [{
      field: "content",
      code: "CONTENT_NOT_IN_EDITORIAL_RELEASE",
      context: { editorialReleaseId, itemEditionId, itemRevisionId },
    }]);
  }
  const edition = await ItemEdition.findById(itemEditionId).lean();
  if (!edition) throw new AppError("ItemEdition non disponibile", 409, [{ field: "itemEditionId", code: "ITEM_EDITION_NOT_FOUND" }]);
  const item = await ItemV2.findOne({ _id: edition.itemId, lifecycleStatus: "active" }).select("_id primarySubjectId").lean();
  if (!item) throw new AppError("Item non disponibile", 409, [{ field: "itemEditionId", code: "ITEM_NOT_ACTIVE" }]);
  return { release, binding, edition, item };
}

async function resolveSelectedContent({ payload, actorUserId, principalType, principalId }) {
  const requested = payload.contentSource || {};
  const sourceType = requested.sourceType || (payload.editorialReleaseId ? "editorial_release" : "item_revision");
  if (sourceType === "editorial_release") {
    const editorialReleaseId = requested.editorialReleaseId || payload.editorialReleaseId;
    const selection = await resolveReleasedContent({ editorialReleaseId, itemEditionId: payload.itemEditionId, itemRevisionId: payload.itemRevisionId });
    return { ...selection, source: { sourceType, editorialReleaseId, itemRevisionId: null } };
  }
  if (sourceType === "item_revision") {
    const itemRevisionId = requested.itemRevisionId || payload.itemRevisionId;
    const selection = await assertCanUseItemRevisionInVisit({ itemRevisionId, itemEditionId: payload.itemEditionId, actorUserId, principalType, principalId });
    return {
      revision: selection.revision,
      edition: selection.edition,
      item: selection.item,
      source: { sourceType, editorialReleaseId: null, itemRevisionId: selection.revision._id },
    };
  }
  throw new AppError("Fonte del contenuto non valida", 400, [{ field: "contentSource.sourceType", code: "INVALID_ENUM" }]);
}

function ensureContentSource(sources, requested) {
  const existing = sources.find((source) => source.sourceType === requested.sourceType && (
    requested.sourceType === "editorial_release"
      ? id(source.editorialReleaseId) === id(requested.editorialReleaseId)
      : id(source.itemRevisionId) === id(requested.itemRevisionId)
  ));
  if (existing) return { sourceId: existing._id, added: false };
  const source = { _id: newId(), ...requested };
  sources.push(source);
  return { sourceId: source._id, added: true };
}

function ensureAnchorForTarget(anchors, venueTargetId) {
  const existing = anchors.find((anchor) => id(anchor.venueTargetId) === id(venueTargetId));
  if (existing) return { anchorId: existing._id, added: false };
  const anchor = { _id: newId(), venueTargetId };
  anchors.push(anchor);
  return { anchorId: anchor._id, added: true };
}

function validatePlacement(placement, index) {
  if (!placement || !["contextual", "physical"].includes(placement.mode)) {
    throw new AppError("Scegli come usare ogni contenuto nella visita", 400, [{
      field: `entries.${index}.placement.mode`,
      code: "VISIT_CONTENT_PLACEMENT_REQUIRED",
    }]);
  }
  if (placement.mode === "physical" && !mongoose.isValidObjectId(placement.venueTargetId)) {
    throw new AppError("Scegli una collocazione fisica valida", 400, [{
      field: `entries.${index}.placement.venueTargetId`,
      code: "VISIT_CONTENT_TARGET_REQUIRED",
    }]);
  }
}

function validatePlacementUpdate(placement) {
  if (!placement || !["contextual", "physical"].includes(placement.mode)) {
    throw new AppError("Scegli come usare il contenuto nella visita", 400, [{
      field: "placement.mode",
      code: "VISIT_CONTENT_PLACEMENT_REQUIRED",
    }]);
  }
  if (placement.mode === "physical" && !mongoose.isValidObjectId(placement.venueTargetId)) {
    throw new AppError("Scegli una collocazione fisica valida", 400, [{
      field: "placement.venueTargetId",
      code: "VISIT_CONTENT_TARGET_REQUIRED",
    }]);
  }
}

function cleanupOrphanAnchor(anchors, entries, nextLogistics, anchorId) {
  if (!anchorId || entries.some((entry) => id(entry.deliveryAnchorId) === id(anchorId))) return false;
  const index = anchors.findIndex((anchor) => id(anchor._id) === id(anchorId));
  if (index < 0) return false;
  anchors.splice(index, 1);
  nextLogistics.routeHints = nextLogistics.routeHints.filter((hint) => (
    id(hint.fromAnchorId) !== id(anchorId) && id(hint.toAnchorId) !== id(anchorId)
  ));
  return true;
}

async function addContentToVisit({ visitId, actorUserId, payload = {} }) {
  const requestedEntries = Array.isArray(payload.entries) ? payload.entries : [];
  if (!requestedEntries.length) {
    throw new AppError("Seleziona almeno un contenuto da aggiungere", 400, [{ field: "entries", code: "REQUIRED" }]);
  }
  requestedEntries.forEach((entry, index) => validatePlacement(entry?.placement, index));

  const { visit, revision } = await loadEditableVisit({ visitId, actorUserId });
  const selections = [];
  for (const requested of requestedEntries) {
    selections.push(await resolveSelectedContent({
      payload: requested,
      actorUserId,
      principalType: visit.ownerType,
      principalId: visit.ownerId,
    }));
  }

  const sources = contentSources(revision);
  const entries = contentEntries(revision);
  const anchors = visitAnchors(revision);
  const added = [];

  for (let index = 0; index < requestedEntries.length; index += 1) {
    const requested = requestedEntries[index];
    const selection = selections[index];
    const source = ensureContentSource(sources, selection.source);
    let deliveryAnchorId = null;
    let placementResult = { mode: "contextual" };

    if (requested.placement.mode === "physical") {
      const occurrence = await assertPublishedTargetForSubject(selection.item.primarySubjectId, requested.placement.venueTargetId);
      const anchor = ensureAnchorForTarget(anchors, occurrence.venueTargetId);
      deliveryAnchorId = anchor.anchorId;
      placementResult = {
        mode: "physical",
        venueTargetId: occurrence.venueTargetId,
        deliveryAnchorId,
        anchorCreated: anchor.added,
      };
    }

    const entry = {
      _id: newId(),
      contentSourceId: source.sourceId,
      editorialSourceId: null,
      itemId: selection.item._id,
      itemEditionId: selection.edition._id,
      itemRevisionId: selection.binding?.itemRevisionId || selection.revision._id,
      deliveryAnchorId,
      role: requested.role || "recommended",
    };
    entries.push(entry);
    added.push({ contentEntryId: entry._id, placement: placementResult });
  }

  const result = await updateVisitV2({
    visitId,
    actorUserId,
    payload: {
      contentEntries: entries,
      contentSources: sources,
      visitAnchors: anchors,
    },
  });
  return { ...result, command: { added } };
}

async function setContentPlacement({ visitId, contentEntryId, actorUserId, placement }) {
  validatePlacementUpdate(placement);
  const { revision } = await loadEditableVisit({ visitId, actorUserId });
  const entries = contentEntries(revision);
  const anchors = visitAnchors(revision);
  const nextLogistics = logistics(revision);
  const entry = entries.find((candidate) => id(candidate._id) === id(contentEntryId));
  if (!entry) throw new AppError("ContentEntry non trovata", 404);

  const previousAnchorId = entry.deliveryAnchorId || null;
  let placementResult = { mode: "contextual", anchorRemoved: false };

  if (placement.mode === "contextual") {
    entry.deliveryAnchorId = null;
  } else {
    const item = await ItemV2.findOne({ _id: entry.itemId, lifecycleStatus: "active" }).select("_id primarySubjectId").lean();
    if (!item) throw new AppError("Item non disponibile", 409, [{ field: "contentEntryId", code: "ITEM_NOT_ACTIVE" }]);
    const occurrence = await assertPublishedTargetForSubject(item.primarySubjectId, placement.venueTargetId);
    const anchor = ensureAnchorForTarget(anchors, occurrence.venueTargetId);
    entry.deliveryAnchorId = anchor.anchorId;
    placementResult = {
      mode: "physical",
      venueTargetId: occurrence.venueTargetId,
      deliveryAnchorId: anchor.anchorId,
      anchorCreated: anchor.added,
      anchorRemoved: false,
    };
  }

  if (previousAnchorId && id(previousAnchorId) !== id(entry.deliveryAnchorId)) {
    placementResult.anchorRemoved = cleanupOrphanAnchor(anchors, entries, nextLogistics, previousAnchorId);
  }

  const result = await updateVisitV2({
    visitId,
    actorUserId,
    payload: { contentEntries: entries, visitAnchors: anchors, logistics: nextLogistics },
  });
  return { ...result, command: { contentEntryId: entry._id, placement: placementResult } };
}

async function setContentRole({ visitId, contentEntryId, actorUserId, role }) {
  const { revision } = await loadEditableVisit({ visitId, actorUserId });
  const entries = contentEntries(revision);
  const entry = entries.find((candidate) => id(candidate._id) === id(contentEntryId));
  if (!entry) throw new AppError("ContentEntry non trovata", 404);
  entry.role = role;
  return updateVisitV2({ visitId, payload: { contentEntries: entries }, actorUserId });
}

async function removeContentFromVisit({ visitId, contentEntryId, actorUserId }) {
  const { revision } = await loadEditableVisit({ visitId, actorUserId });
  const entries = contentEntries(revision);
  const index = entries.findIndex((candidate) => id(candidate._id) === id(contentEntryId));
  if (index < 0) throw new AppError("ContentEntry non trovata", 404);
  const [removed] = entries.splice(index, 1);
  const anchors = visitAnchors(revision);
  const nextLogistics = logistics(revision);
  cleanupOrphanAnchor(anchors, entries, nextLogistics, removed.deliveryAnchorId);
  return updateVisitV2({
    visitId,
    payload: { contentEntries: entries, visitAnchors: anchors, logistics: nextLogistics },
    actorUserId,
  });
}

async function removeVisitStop({ visitId, anchorId, actorUserId }) {
  const { revision } = await loadEditableVisit({ visitId, actorUserId });
  const anchors = visitAnchors(revision);
  const index = anchors.findIndex((anchor) => id(anchor._id) === id(anchorId));
  if (index < 0) throw new AppError("VisitAnchor non trovato", 404);
  anchors.splice(index, 1);
  const entries = contentEntries(revision).map((entry) => (
    id(entry.deliveryAnchorId) === id(anchorId) ? { ...entry, deliveryAnchorId: null } : entry
  ));
  const nextLogistics = logistics(revision);
  nextLogistics.routeHints = nextLogistics.routeHints.filter((hint) => (
    id(hint.fromAnchorId) !== id(anchorId) && id(hint.toAnchorId) !== id(anchorId)
  ));
  return updateVisitV2({ visitId, payload: { visitAnchors: anchors, contentEntries: entries, logistics: nextLogistics }, actorUserId });
}

async function reorderVisitStop({ visitId, anchorId, actorUserId, toIndex }) {
  const { revision } = await loadEditableVisit({ visitId, actorUserId });
  const anchors = visitAnchors(revision);
  const fromIndex = anchors.findIndex((anchor) => id(anchor._id) === id(anchorId));
  if (fromIndex < 0) throw new AppError("VisitAnchor non trovato", 404);
  const destination = Number(toIndex);
  if (!Number.isInteger(destination) || destination < 0 || destination >= anchors.length) {
    throw new AppError("Posizione della tappa non valida", 400, [{ field: "toIndex", code: "OUT_OF_RANGE", context: { minimum: 0, maximum: Math.max(0, anchors.length - 1) } }]);
  }
  const [anchor] = anchors.splice(fromIndex, 1);
  anchors.splice(destination, 0, anchor);
  return updateVisitV2({ visitId, payload: { visitAnchors: anchors }, actorUserId });
}

module.exports = {
  addContentToVisit,
  setContentPlacement,
  setContentRole,
  removeContentFromVisit,
  removeVisitStop,
  reorderVisitStop,
};