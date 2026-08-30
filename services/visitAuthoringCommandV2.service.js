const mongoose = require("mongoose");
const EditorialRelease = require("../models/editorialRelease.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemV2 = require("../models/itemV2.model");
const Venue = require("../models/venue.model");
const VenueRelease = require("../models/venueRelease.model");
const VenueTarget = require("../models/venueTarget.model");
const LayoutRevision = require("../models/layoutRevision.model");
const Subject = require("../models/subject.model");
const AppError = require("../utils/AppError");
const { resolveVenueTargetExhibit } = require("./venueExhibitResolution.service");
const { getVisitV2, updateVisitV2 } = require("./visitV2.service");
const { assertCanUseItemRevisionInVisit } = require("./visitEditorialUsageAuthorization.service");

function id(value) { return String(value?._id || value || ""); }
function newId() { return new mongoose.Types.ObjectId(); }
function hasOwn(object, key) { return Object.prototype.hasOwnProperty.call(object || {}, key); }

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

async function resolveSelectedContent({ revision, payload, actorUserId, principalType, principalId }) {
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

async function publishedOccurrenceCandidates(subjectId) {
  const targets = await VenueTarget.find({ subjectId, lifecycleStatus: "active" })
    .select("_id venueId subjectId displayLabelOverride inventoryNote")
    .lean();
  if (!targets.length) return [];
  const subject = await Subject.findById(subjectId).select("preferredLabel description").lean();
  const venueIds = [...new Set(targets.map((target) => id(target.venueId)))];
  const venues = await Venue.find({
    _id: { $in: venueIds },
    lifecycleStatus: "active",
    publishedReleaseId: { $ne: null },
  }).select("_id name publishedReleaseId").lean();
  const venueById = new Map(venues.map((venue) => [id(venue._id), venue]));
  const releases = venues.length
    ? await VenueRelease.find({
        _id: { $in: venues.map((venue) => venue.publishedReleaseId) },
        status: "published",
      }).select("_id venueId layoutRevisionId targetBindings").lean()
    : [];
  const releaseById = new Map(releases.map((release) => [id(release._id), release]));
  const layouts = releases.length
    ? await LayoutRevision.find({
        _id: { $in: releases.map((release) => release.layoutRevisionId) },
        status: { $in: ["published", "superseded"] },
      }).select("_id venueId places exhibitSlots").lean()
    : [];
  const layoutById = new Map(layouts.map((layout) => [id(layout._id), layout]));
  const result = [];
  for (const target of targets) {
    const venue = venueById.get(id(target.venueId));
    if (!venue) continue;
    const release = releaseById.get(id(venue.publishedReleaseId));
    if (!release || id(release.venueId) !== id(venue._id)) continue;
    const layout = layoutById.get(id(release.layoutRevisionId));
    if (!layout || id(layout.venueId) !== id(venue._id)) continue;
    let physical;
    try { physical = resolveVenueTargetExhibit({ venueRelease: release, layoutRevision: layout, venueTargetId: target._id }); }
    catch { continue; }
    result.push({
      venueTargetId: target._id,
      exhibitSlotId: physical.exhibitSlot.exhibitSlotId,
      label: target.displayLabelOverride || subject?.preferredLabel || "Entità della sede",
      description: target.inventoryNote || subject?.description || "",
      subjectId: target.subjectId,
      venue: { id: venue._id, name: venue.name },
      venueReleaseId: release._id,
      layoutRevisionId: layout._id,
      placeId: physical.place._id,
    });
  }
  return result.sort((left, right) => (
    String(left.venue.name || "").localeCompare(String(right.venue.name || ""), "it")
    || String(left.label || "").localeCompare(String(right.label || ""), "it")
  ));
}

async function assertPublishedTargetUsable(venueTargetId) {
  if (!mongoose.isValidObjectId(venueTargetId)) throw new AppError("VenueTarget non valido", 400, [{ field: "venueTargetId", code: "INVALID_OBJECT_ID" }]);
  const target = await VenueTarget.findOne({ _id: venueTargetId, lifecycleStatus: "active" }).select("subjectId").lean();
  if (!target) throw new AppError("VenueTarget non disponibile", 404);
  const candidates = await publishedOccurrenceCandidates(target.subjectId);
  const candidate = candidates.find((entry) => id(entry.venueTargetId) === id(venueTargetId));
  if (!candidate) {
    throw new AppError("VenueTarget non utilizzabile nella configurazione pubblicata", 409, [{
      field: "venueTargetId",
      code: "VENUE_TARGET_NOT_USABLE_FOR_VISIT",
      context: { venueTargetId },
    }]);
  }
  return candidate;
}

function ensureContentSource(revision, requested) {
  const sources = contentSources(revision);
  const existing = sources.find((source) => source.sourceType === requested.sourceType && (
    requested.sourceType === "editorial_release"
      ? id(source.editorialReleaseId) === id(requested.editorialReleaseId)
      : id(source.itemRevisionId) === id(requested.itemRevisionId)
  ));
  if (existing) return { sources, sourceId: existing._id, added: false };
  const source = { _id: newId(), ...requested };
  sources.push(source);
  return { sources, sourceId: source._id, added: true };
}

function ensureAnchorForTarget(anchors, venueTargetId) {
  const existing = anchors.find((anchor) => id(anchor.venueTargetId) === id(venueTargetId));
  if (existing) return { anchors, anchorId: existing._id, added: false };
  const anchor = { _id: newId(), venueTargetId };
  anchors.push(anchor);
  return { anchors, anchorId: anchor._id, added: true };
}

async function addContentEntry({ visitId, actorUserId, payload = {}, explicitAnchorId = null }) {
  const { visit, revision } = await loadEditableVisit({ visitId, actorUserId });
  const selection = await resolveSelectedContent({
    revision,
    payload,
    actorUserId,
    principalType: visit.ownerType,
    principalId: visit.ownerId,
  });
  const source = ensureContentSource(revision, selection.source);
  const entries = contentEntries(revision);
  const anchors = visitAnchors(revision);
  let deliveryAnchorId = explicitAnchorId || null;
  let inference = { status: explicitAnchorId ? "explicit_stop" : "contextual", candidates: [] };

  if (explicitAnchorId) {
    const anchor = anchors.find((entry) => id(entry._id) === id(explicitAnchorId));
    if (!anchor) throw new AppError("VisitAnchor non appartiene alla visita", 404, [{ field: "anchorId", code: "VISIT_ANCHOR_NOT_FOUND" }]);
  } else {
    const candidates = await publishedOccurrenceCandidates(selection.item.primarySubjectId);
    const selectedTargetId = payload.venueTargetId || null;
    if (selectedTargetId) {
      const selected = candidates.find((candidate) => id(candidate.venueTargetId) === id(selectedTargetId));
      if (!selected) {
        throw new AppError("L'occorrenza scelta non corrisponde al contenuto o non è utilizzabile", 409, [{
          field: "venueTargetId",
          code: "VISIT_CONTENT_OCCURRENCE_INVALID",
          context: { venueTargetId: selectedTargetId, primarySubjectId: selection.item.primarySubjectId },
        }]);
      }
      const anchor = ensureAnchorForTarget(anchors, selected.venueTargetId);
      deliveryAnchorId = anchor.anchorId;
      inference = { status: "selected_occurrence", candidates: [selected] };
    } else if (candidates.length === 1) {
      const anchor = ensureAnchorForTarget(anchors, candidates[0].venueTargetId);
      deliveryAnchorId = anchor.anchorId;
      inference = { status: "inferred", candidates };
    } else if (candidates.length > 1) {
      throw new AppError("Il contenuto corrisponde a più occorrenze fisiche: scegli in quale inserirlo", 409, [{
        field: "venueTargetId",
        code: "VISIT_CONTENT_OCCURRENCE_SELECTION_REQUIRED",
        message: "Scegli l'occorrenza fisica in cui presentare il contenuto.",
        context: {
          primarySubjectId: selection.item.primarySubjectId,
          candidates,
        },
      }]);
    }
  }

  const entry = {
    _id: newId(),
    contentSourceId: source.sourceId,
    editorialSourceId: null,
    itemId: selection.item._id,
    itemEditionId: selection.edition._id,
    itemRevisionId: selection.binding?.itemRevisionId || selection.revision._id,
    deliveryAnchorId,
    role: payload.role || "recommended",
  };
  entries.push(entry);
  const updatePayload = {
    contentEntries: entries,
    visitAnchors: anchors,
    ...(source.added ? { contentSources: source.sources } : {}),
  };
  const result = await updateVisitV2({ visitId, payload: updatePayload, actorUserId });
  return {
    ...result,
    command: {
      contentEntryId: entry._id,
      deliveryAnchorId,
      inference,
    },
  };
}

async function addContentToVisit({ visitId, actorUserId, payload = {} }) {
  return addContentEntry({ visitId, actorUserId, payload });
}

async function addContentToStop({ visitId, anchorId, actorUserId, payload = {} }) {
  return addContentEntry({ visitId, actorUserId, payload, explicitAnchorId: anchorId });
}

async function attachContentToStop({ visitId, contentEntryId, anchorId, actorUserId }) {
  const { revision } = await loadEditableVisit({ visitId, actorUserId });
  const anchors = visitAnchors(revision);
  if (!anchors.some((anchor) => id(anchor._id) === id(anchorId))) throw new AppError("VisitAnchor non trovato", 404);
  const entries = contentEntries(revision);
  const entry = entries.find((candidate) => id(candidate._id) === id(contentEntryId));
  if (!entry) throw new AppError("ContentEntry non trovata", 404);
  entry.deliveryAnchorId = anchorId;
  return updateVisitV2({ visitId, payload: { contentEntries: entries }, actorUserId });
}

async function detachContentFromStop({ visitId, contentEntryId, actorUserId }) {
  const { revision } = await loadEditableVisit({ visitId, actorUserId });
  const entries = contentEntries(revision);
  const entry = entries.find((candidate) => id(candidate._id) === id(contentEntryId));
  if (!entry) throw new AppError("ContentEntry non trovata", 404);
  entry.deliveryAnchorId = null;
  return updateVisitV2({ visitId, payload: { contentEntries: entries }, actorUserId });
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
  entries.splice(index, 1);
  return updateVisitV2({ visitId, payload: { contentEntries: entries }, actorUserId });
}

async function addVisitStop({ visitId, actorUserId, venueTargetId }) {
  await assertPublishedTargetUsable(venueTargetId);
  const { revision } = await loadEditableVisit({ visitId, actorUserId });
  const anchors = visitAnchors(revision);
  const ensured = ensureAnchorForTarget(anchors, venueTargetId);
  if (!ensured.added) return { visit: null, revision, command: { anchorId: ensured.anchorId, reused: true } };
  const result = await updateVisitV2({ visitId, payload: { visitAnchors: anchors }, actorUserId });
  return { ...result, command: { anchorId: ensured.anchorId, reused: false } };
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
  publishedOccurrenceCandidates,
  addContentToVisit,
  addContentToStop,
  attachContentToStop,
  detachContentFromStop,
  setContentRole,
  removeContentFromVisit,
  addVisitStop,
  removeVisitStop,
  reorderVisitStop,
};
