const VenueTarget = require("../models/venueTarget.model");
const AppError = require("../utils/AppError");
const { getVisitV2, updateVisitV2 } = require("./visitV2.service");

function id(value) { return String(value?._id || value || ""); }
function serializeRouteHints(revision) {
  return (revision.logistics?.routeHints || []).map((hint) => ({
    _id: hint._id,
    fromAnchorId: hint.fromAnchorId,
    toAnchorId: hint.toAnchorId,
    type: hint.type,
    instructionOverride: hint.instructionOverride || null,
    note: hint.note || null,
    estimatedTransferSeconds: hint.estimatedTransferSeconds ?? null,
  }));
}

async function setInterVenueTransfer({ visitId, actorUserId, fromAnchorId, toAnchorId, estimatedTransferSeconds, instructionOverride = null }) {
  const { revision } = await getVisitV2({ visitId, actorUserId, view: "working" });
  const anchors = revision.visitAnchors || [];
  const fromIndex = anchors.findIndex((anchor) => id(anchor._id) === id(fromAnchorId));
  const toIndex = anchors.findIndex((anchor) => id(anchor._id) === id(toAnchorId));
  if (fromIndex < 0 || toIndex < 0) throw new AppError("Le tappe del trasferimento non appartengono alla visita", 404, [{ code: "VISIT_ANCHOR_NOT_FOUND" }]);
  if (toIndex !== fromIndex + 1) {
    throw new AppError("Il trasferimento può essere definito solo tra tappe consecutive", 409, [{
      code: "INTER_VENUE_TRANSFER_REQUIRES_ADJACENT_STOPS",
      context: { fromAnchorId, toAnchorId },
    }]);
  }
  const seconds = Number(estimatedTransferSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new AppError("La stima del trasferimento deve essere positiva", 400, [{ field: "estimatedTransferSeconds", code: "INVALID_VALUE" }]);
  }
  const targets = await VenueTarget.find({
    _id: { $in: [anchors[fromIndex].venueTargetId, anchors[toIndex].venueTargetId] },
    lifecycleStatus: "active",
  }).select("_id venueId").lean();
  const targetById = new Map(targets.map((target) => [id(target._id), target]));
  const fromTarget = targetById.get(id(anchors[fromIndex].venueTargetId));
  const toTarget = targetById.get(id(anchors[toIndex].venueTargetId));
  if (!fromTarget || !toTarget) throw new AppError("Target fisico del trasferimento non disponibile", 409, [{ code: "VENUE_TARGET_UNAVAILABLE" }]);
  if (id(fromTarget.venueId) === id(toTarget.venueId)) {
    throw new AppError("Il percorso tra tappe della stessa sede è derivato dalla mappa e non richiede un trasferimento manuale", 409, [{
      code: "INDOOR_ROUTE_IS_LAYOUT_DERIVED",
      context: { venueId: fromTarget.venueId },
    }]);
  }

  const routeHints = serializeRouteHints(revision);
  const existing = routeHints.find((hint) => id(hint.fromAnchorId) === id(fromAnchorId) && id(hint.toAnchorId) === id(toAnchorId));
  const value = {
    ...(existing?._id ? { _id: existing._id } : {}),
    fromAnchorId,
    toAnchorId,
    type: "inter_venue",
    instructionOverride: String(instructionOverride || "").trim() || null,
    note: existing?.note || null,
    estimatedTransferSeconds: Math.round(seconds),
  };
  if (existing) Object.assign(existing, value);
  else routeHints.push(value);
  return updateVisitV2({
    visitId,
    actorUserId,
    payload: {
      logistics: {
        preVisitNotes: revision.logistics?.preVisitNotes || [],
        routeHints,
      },
    },
  });
}

module.exports = { setInterVenueTransfer };