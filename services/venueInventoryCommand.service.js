const mongoose = require("mongoose");
const VenueInventoryProposal = require("../models/venueInventoryProposal.model");
const AppError = require("../utils/AppError");
const { assertVenuePermission } = require("./venueAuthorization.service");
const { ensureVenueEntity } = require("./venueTarget.service");

async function addVenueSubjectToInventory({ venueId, payload, actorUserId }) {
  const { venue } = await assertVenuePermission({ userId: actorUserId, venueId, permissionCode: "venue.inventory.manage" });
  const subjectId = payload?.subjectId;
  if (!mongoose.isValidObjectId(subjectId)) throw new AppError("subjectId non valido", 400, [{ field: "subjectId", code: "INVALID_OBJECT_ID" }]);
  let result = null;
  await mongoose.connection.transaction(async (session) => {
    const pending = await VenueInventoryProposal.findOne({
      venueId: venue._id,
      subjectId,
      status: "pending",
    }).select("_id").session(session).lean();
    if (pending) {
      throw new AppError("Esiste già una proposta in attesa per questo Subject: decidi la proposta invece di aggirarla con un'aggiunta diretta", 409, [{
        field: "subjectId",
        code: "PENDING_INVENTORY_PROPOSAL_REQUIRES_DECISION",
        context: { proposalId: pending._id },
      }]);
    }
    result = await ensureVenueEntity({
      venueId: venue._id,
      payload,
      actorUserId,
      session,
      skipAuthorization: true,
    });
  });
  return result;
}

module.exports = { addVenueSubjectToInventory };
