const mongoose = require("mongoose");
const VenueInventoryProposal = require("../models/venueInventoryProposal.model");
const VenueTarget = require("../models/venueTarget.model");
const ItemV2 = require("../models/itemV2.model");
const Subject = require("../models/subject.model");
const AppError = require("../utils/AppError");
const { findVenueOrFail, assertVenuePermission } = require("./venueAuthorization.service");
const { assertOrganizationPermission } = require("./organizationAuthorization.service");
const { ensureVenueEntity } = require("./venueTarget.service");

const PROPOSAL_STATUSES = Object.freeze(["pending", "accepted", "rejected", "withdrawn"]);

function id(value) { return String(value?._id || value || ""); }
function sameId(left, right) { return id(left) === id(right); }
function normalizeMessage(value, { required = false } = {}) {
  const message = String(value || "").trim();
  if (required && !message) throw new AppError("La motivazione è obbligatoria", 400, [{ field: "message", code: "REQUIRED" }]);
  if (message.length > 1000) throw new AppError("La motivazione è troppo lunga", 400, [{ field: "message", code: "MAX_LENGTH", max: 1000 }]);
  return message || null;
}
function assertObjectId(value, field) {
  if (!mongoose.isValidObjectId(value)) throw new AppError(`${field} non valido`, 400, [{ field, code: "INVALID_OBJECT_ID" }]);
}

async function validateProposalSource({ venue, subjectId, sourceItemId, actorUserId }) {
  await assertOrganizationPermission({
    userId: actorUserId,
    organizationId: venue.ownerOrganizationId,
    permissionCode: "item.create",
  });
  assertObjectId(subjectId, "subjectId");
  const subject = await Subject.findById(subjectId).select("_id preferredLabel description").lean();
  if (!subject) throw new AppError("Subject non trovato", 404);

  let sourceItem = null;
  if (sourceItemId) {
    assertObjectId(sourceItemId, "sourceItemId");
    sourceItem = await ItemV2.findOne({ _id: sourceItemId, lifecycleStatus: "active" }).lean();
    if (!sourceItem) throw new AppError("Contenuto sorgente non trovato", 404);
    if (sourceItem.ownerType !== "organization" || !sameId(sourceItem.ownerId, venue.ownerOrganizationId)) {
      throw new AppError("Il contenuto sorgente deve appartenere all'organizzazione proprietaria della sede", 409, [{
        field: "sourceItemId",
        code: "INVENTORY_PROPOSAL_SOURCE_OWNER_MISMATCH",
      }]);
    }
    if (!sameId(sourceItem.primarySubjectId, subjectId)) {
      throw new AppError("Il contenuto sorgente parla di un Subject diverso da quello proposto", 409, [{
        field: "subjectId",
        code: "INVENTORY_PROPOSAL_SUBJECT_MISMATCH",
      }]);
    }
  }
  return { subject, sourceItem };
}

async function submitVenueInventoryProposal({ venueId, subjectId, sourceItemId = null, message = null, actorUserId }) {
  const venue = await findVenueOrFail({ venueId });
  const source = await validateProposalSource({ venue, subjectId, sourceItemId, actorUserId });
  const existingTarget = await VenueTarget.findOne({ venueId: venue._id, subjectId, lifecycleStatus: "active" }).select("_id").lean();
  if (existingTarget) {
    throw new AppError("Il Subject è già presente nell'inventario della sede", 409, [{
      field: "subjectId",
      code: "SUBJECT_ALREADY_IN_VENUE_INVENTORY",
      context: { venueTargetId: existingTarget._id },
    }]);
  }

  const normalizedMessage = normalizeMessage(message);
  let proposal = await VenueInventoryProposal.findOne({ venueId: venue._id, subjectId, status: "pending" });
  if (proposal) return { proposal, subject: source.subject, created: false };
  try {
    proposal = await VenueInventoryProposal.create({
      venueId: venue._id,
      subjectId,
      sourceItemId: sourceItemId || null,
      proposedByUserId: actorUserId,
      message: normalizedMessage,
    });
    return { proposal, subject: source.subject, created: true };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    proposal = await VenueInventoryProposal.findOne({ venueId: venue._id, subjectId, status: "pending" });
    if (!proposal) throw error;
    return { proposal, subject: source.subject, created: false };
  }
}

async function listVenueInventoryProposals({ venueId, status = "pending", actorUserId }) {
  const { venue } = await assertVenuePermission({ userId: actorUserId, venueId, permissionCode: "venue.inventory.manage" });
  const normalizedStatus = String(status || "pending").trim();
  if (normalizedStatus !== "all" && !PROPOSAL_STATUSES.includes(normalizedStatus)) {
    throw new AppError("Stato proposta non valido", 400, [{ field: "status", code: "INVALID_ENUM", allowedValues: [...PROPOSAL_STATUSES, "all"] }]);
  }
  const query = { venueId: venue._id };
  if (normalizedStatus !== "all") query.status = normalizedStatus;
  const proposals = await VenueInventoryProposal.find(query).sort({ createdAt: -1, _id: -1 }).lean();
  const subjectIds = [...new Set(proposals.map((entry) => id(entry.subjectId)))];
  const subjects = subjectIds.length
    ? await Subject.find({ _id: { $in: subjectIds } }).select("preferredLabel description externalIdentities").lean()
    : [];
  const subjectById = new Map(subjects.map((subject) => [id(subject), subject]));
  return {
    venue: { id: venue._id, name: venue.name, ownerOrganizationId: venue.ownerOrganizationId },
    results: proposals.map((proposal) => ({
      ...proposal,
      subject: subjectById.get(id(proposal.subjectId)) || null,
    })),
  };
}

async function findPendingProposal({ venueId, proposalId, session = null }) {
  assertObjectId(proposalId, "proposalId");
  const query = VenueInventoryProposal.findOne({ _id: proposalId, venueId, status: "pending" });
  if (session) query.session(session);
  const proposal = await query;
  if (!proposal) throw new AppError("Proposta di inventario non disponibile", 404, [{ code: "INVENTORY_PROPOSAL_NOT_PENDING" }]);
  return proposal;
}

async function acceptVenueInventoryProposal({ venueId, proposalId, message = null, actorUserId }) {
  const { venue } = await assertVenuePermission({ userId: actorUserId, venueId, permissionCode: "venue.inventory.manage" });
  const normalizedMessage = normalizeMessage(message);
  let result = null;
  await mongoose.connection.transaction(async (session) => {
    const proposal = await findPendingProposal({ venueId: venue._id, proposalId, session });
    const ensured = await ensureVenueEntity({
      venueId: venue._id,
      payload: {
        subjectId: proposal.subjectId,
        provenance: {
          origin: "inventory_proposal",
          sourceId: id(proposal._id),
          metadata: proposal.sourceItemId ? { sourceItemId: id(proposal.sourceItemId) } : null,
        },
      },
      actorUserId,
      session,
      skipAuthorization: true,
    });
    proposal.status = "accepted";
    proposal.decision = { decidedBy: actorUserId, decidedAt: new Date(), message: normalizedMessage };
    proposal.acceptedVenueTargetId = ensured.target._id;
    await proposal.save({ session });
    result = { proposal, venueTarget: ensured.target, createdVenueTarget: ensured.created };
  });
  return result;
}

async function rejectVenueInventoryProposal({ venueId, proposalId, message, actorUserId }) {
  await assertVenuePermission({ userId: actorUserId, venueId, permissionCode: "venue.inventory.manage" });
  const normalizedMessage = normalizeMessage(message, { required: true });
  const proposal = await findPendingProposal({ venueId, proposalId });
  proposal.status = "rejected";
  proposal.decision = { decidedBy: actorUserId, decidedAt: new Date(), message: normalizedMessage };
  await proposal.save();
  return proposal;
}

async function withdrawVenueInventoryProposal({ venueId, proposalId, message = null, actorUserId }) {
  const venue = await findVenueOrFail({ venueId });
  const proposal = await findPendingProposal({ venueId: venue._id, proposalId });
  if (!sameId(proposal.proposedByUserId, actorUserId)) {
    throw new AppError("Puoi ritirare soltanto una proposta inviata da te", 403, [{ code: "INVENTORY_PROPOSAL_AUTHOR_REQUIRED" }]);
  }
  proposal.status = "withdrawn";
  proposal.decision = { decidedBy: actorUserId, decidedAt: new Date(), message: normalizeMessage(message) };
  await proposal.save();
  return proposal;
}

module.exports = {
  PROPOSAL_STATUSES,
  submitVenueInventoryProposal,
  listVenueInventoryProposals,
  acceptVenueInventoryProposal,
  rejectVenueInventoryProposal,
  withdrawVenueInventoryProposal,
};
