const { getVisitV2, updateVisitV2 } = require("./visitV2.service");
const { canonicalizeContentEntries, reorderWithinDeliveryGroup, moveToDeliveryGroup } = require("./visitSequenceV2.service");
const AppError = require("../utils/AppError");

function id(value) { return String(value?._id || value || ""); }

function normalizedContentEntries(revision) {
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
function normalizedAnchors(revision) {
  return (revision.visitAnchors || []).map((anchor) => ({ _id: anchor._id, venueTargetId: anchor.venueTargetId }));
}

async function reorderVisitContent({ visitId, contentEntryId, actorUserId, toIndex }) {
  const { visit, revision } = await getVisitV2({ visitId, actorUserId, view: "working" });
  const anchors = normalizedAnchors(revision);
  const canonical = canonicalizeContentEntries(normalizedContentEntries(revision), anchors);
  const reordered = reorderWithinDeliveryGroup(canonical, contentEntryId, toIndex);
  const nextEntries = canonicalizeContentEntries(reordered.entries, anchors);
  const previousIds = (revision.contentEntries || []).map((entry) => id(entry._id));
  const changed = reordered.changed || nextEntries.some((entry, index) => id(entry._id) !== previousIds[index]);
  if (!changed) {
    return {
      visit,
      revision,
      command: {
        contentEntryId: reordered.selected._id,
        deliveryAnchorId: reordered.selected.deliveryAnchorId || null,
        fromIndex: reordered.fromIndex,
        toIndex: reordered.toIndex,
        changed: false,
      },
    };
  }
  const result = await updateVisitV2({ visitId, payload: { contentEntries: nextEntries }, actorUserId });
  return {
    ...result,
    command: {
      contentEntryId: reordered.selected._id,
      deliveryAnchorId: reordered.selected.deliveryAnchorId || null,
      fromIndex: reordered.fromIndex,
      toIndex: reordered.toIndex,
      changed: true,
    },
  };
}

async function moveVisitContent({ visitId, contentEntryId, actorUserId, deliveryAnchorId = null, toIndex }) {
  const { revision } = await getVisitV2({ visitId, actorUserId, view: "working" });
  const anchors = normalizedAnchors(revision);
  if (deliveryAnchorId && !anchors.some((anchor) => id(anchor._id) === id(deliveryAnchorId))) {
    throw new AppError("Tappa di destinazione non trovata", 404, [{ field: "deliveryAnchorId", code: "VISIT_ANCHOR_NOT_FOUND" }]);
  }
  const canonical = canonicalizeContentEntries(normalizedContentEntries(revision), anchors);
  const moved = moveToDeliveryGroup(canonical, contentEntryId, deliveryAnchorId, toIndex);
  const nextEntries = canonicalizeContentEntries(moved.entries, anchors);
  const result = await updateVisitV2({ visitId, payload: { contentEntries: nextEntries }, actorUserId });
  return {
    ...result,
    command: {
      contentEntryId: moved.selected._id,
      deliveryAnchorId: moved.deliveryAnchorId,
      toIndex: moved.toIndex,
      changed: true,
    },
  };
}

module.exports = { reorderVisitContent, moveVisitContent };
