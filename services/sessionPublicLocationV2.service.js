const VenueTarget = require("../models/venueTarget.model");
const AppError = require("../utils/AppError");
const { getCurrentSessionPlanV2 } = require("./sessionPlanV2.service");
const { id, loadPinnedBundle } = require("./physicalExecutionV2.service");

function normalizePublicCode(value) {
  const code = String(value || "").trim();
  if (!code) {
    throw new AppError("Codice pubblico mancante", 400, [{
      field: "publicCode",
      code: "PUBLIC_LOCATION_CODE_REQUIRED",
    }]);
  }
  if (code.length > 128) {
    throw new AppError("Codice pubblico non valido", 400, [{
      field: "publicCode",
      code: "PUBLIC_LOCATION_CODE_INVALID",
    }]);
  }
  return code;
}

async function resolvePublicCodeLocation({ sessionId, userId, publicCode }) {
  const code = normalizePublicCode(publicCode);
  const { session } = await getCurrentSessionPlanV2({ sessionId, userId });
  const target = await VenueTarget.findOne({ publicCode: code })
    .select("_id venueId publicCode")
    .lean();

  if (!target) {
    throw new AppError("Riferimento fisico non disponibile", 404, [{
      field: "publicCode",
      code: "PUBLIC_LOCATION_NOT_FOUND",
    }]);
  }

  const pin = (session.venuePins || []).find((entry) => id(entry.venueId) === id(target.venueId));
  if (!pin) {
    throw new AppError("Riferimento fisico non disponibile in questa sessione", 404, [{
      field: "publicCode",
      code: "PUBLIC_LOCATION_OUTSIDE_SESSION_SCOPE",
    }]);
  }

  const bundle = await loadPinnedBundle(session, target.venueId);
  const activeBinding = (bundle.release.targetBindings || []).find((entry) => (
    id(entry.venueTargetId) === id(target._id) && entry.availability === "active"
  ));
  if (!activeBinding) {
    throw new AppError("Riferimento fisico non attivo nello snapshot della sessione", 409, [{
      field: "publicCode",
      code: "PUBLIC_LOCATION_NOT_ACTIVE_IN_PINNED_RELEASE",
      context: { venueId: id(target.venueId), venueTargetId: id(target._id) },
    }]);
  }

  const placement = (bundle.layout.venueTargetPlacements || []).find((entry) => (
    id(entry.venueTargetId) === id(target._id)
  ));
  if (!placement?.primaryPlaceId) {
    throw new AppError("Riferimento fisico senza posizione nello snapshot della sessione", 409, [{
      field: "publicCode",
      code: "PUBLIC_LOCATION_WITHOUT_PINNED_PLACEMENT",
      context: { venueId: id(target.venueId), venueTargetId: id(target._id) },
    }]);
  }

  const place = (bundle.layout.places || []).find((entry) => id(entry._id) === id(placement.primaryPlaceId));
  if (!place) {
    throw new AppError("Posizione logica non disponibile nello snapshot della sessione", 409, [{
      field: "publicCode",
      code: "PUBLIC_LOCATION_PLACE_MISSING",
      context: { venueId: id(target.venueId), placeId: id(placement.primaryPlaceId) },
    }]);
  }

  const floor = (bundle.layout.floors || []).find((entry) => id(entry._id) === id(place.floorId));
  if (!floor) {
    throw new AppError("Piano della posizione logica non disponibile nello snapshot della sessione", 409, [{
      field: "publicCode",
      code: "PUBLIC_LOCATION_FLOOR_MISSING",
      context: { venueId: id(target.venueId), placeId: id(place._id), floorId: id(place.floorId) },
    }]);
  }

  return {
    location: {
      venueId: id(target.venueId),
      placeId: id(place._id),
      floorId: id(floor._id),
      venueTargetId: id(target._id),
    },
  };
}

module.exports = {
  resolvePublicCodeLocation,
};
