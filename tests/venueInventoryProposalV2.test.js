const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const mongoUri = process.env.MONGO_URI;

async function withFreshDatabase(callback) {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  try {
    await mongoose.connection.dropDatabase();
    return await callback();
  } finally {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  }
}

async function addMembership({ OrganizationRole, OrganizationMembership, organizationId, userId, assignedBy, name, permissionCodes }) {
  const role = await OrganizationRole.create({
    organizationId,
    name,
    description: `${name} test role`,
    permissionCodes,
    createdBy: assignedBy,
    updatedBy: assignedBy,
  });
  await OrganizationMembership.create({
    organizationId,
    userId,
    roleAssignments: [{ roleId: role._id, assignedBy }],
    createdBy: assignedBy,
    updatedBy: assignedBy,
  });
}

test("Venue inventory proposals keep editorial suggestion and physical placement as separate workflows", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Organization = require("../models/organization.model");
    const OrganizationRole = require("../models/organizationRole.model");
    const OrganizationMembership = require("../models/organizationMembership.model");
    const Subject = require("../models/subject.model");
    const ItemV2 = require("../models/itemV2.model");
    const Venue = require("../models/venue.model");
    const VenueTarget = require("../models/venueTarget.model");
    const ExhibitSlot = require("../models/exhibitSlot.model");
    const VenueInventoryProposal = require("../models/venueInventoryProposal.model");
    const {
      submitVenueInventoryProposal,
      listVenueInventoryProposals,
      acceptVenueInventoryProposal,
      rejectVenueInventoryProposal,
    } = require("../services/venueInventoryProposal.service");

    const [owner, contributor, inventoryManager] = await User.create([
      { username: "proposal-owner", passwordHash: "hash" },
      { username: "proposal-contributor", passwordHash: "hash" },
      { username: "proposal-inventory-manager", passwordHash: "hash" },
    ]);
    const organization = await Organization.create({ name: "Museo proposte", createdBy: owner._id });
    await addMembership({
      OrganizationRole,
      OrganizationMembership,
      organizationId: organization._id,
      userId: contributor._id,
      assignedBy: owner._id,
      name: "Contributor proposte",
      permissionCodes: ["venue.view", "item.create"],
    });
    await addMembership({
      OrganizationRole,
      OrganizationMembership,
      organizationId: organization._id,
      userId: inventoryManager._id,
      assignedBy: owner._id,
      name: "Inventory manager proposte",
      permissionCodes: ["venue.view", "venue.inventory.manage"],
    });

    const venue = await Venue.create({ name: "Sede proposte", ownerOrganizationId: organization._id, createdBy: owner._id });
    const [acceptedSubject, rejectedSubject] = await Subject.create([
      { preferredLabel: "Opera proposta", description: "Opera da valutare", createdBy: owner._id },
      { preferredLabel: "Tema non fisico", description: "Tema editoriale", createdBy: owner._id },
    ]);
    const acceptedItem = await ItemV2.create({
      primarySubjectId: acceptedSubject._id,
      ownerType: "organization",
      ownerId: organization._id,
      createdBy: contributor._id,
    });

    const first = await submitVenueInventoryProposal({
      venueId: venue._id,
      subjectId: acceptedSubject._id,
      sourceItemId: acceptedItem._id,
      message: "Questa opera è destinata alla sede.",
      actorUserId: contributor._id,
    });
    assert.equal(first.created, true);
    assert.equal(first.proposal.status, "pending");

    const duplicate = await submitVenueInventoryProposal({
      venueId: venue._id,
      subjectId: acceptedSubject._id,
      sourceItemId: acceptedItem._id,
      actorUserId: contributor._id,
    });
    assert.equal(duplicate.created, false, "una proposta pendente per Venue+Subject deve essere idempotente");
    assert.equal(String(duplicate.proposal._id), String(first.proposal._id));

    const second = await submitVenueInventoryProposal({
      venueId: venue._id,
      subjectId: rejectedSubject._id,
      message: "Valutare se appartiene davvero all'inventario fisico.",
      actorUserId: contributor._id,
    });
    assert.equal(second.created, true);

    await assert.rejects(
      () => listVenueInventoryProposals({ venueId: venue._id, actorUserId: contributor._id }),
      (error) => error?.status === 403,
      "item.create non deve implicare venue.inventory.manage",
    );

    const pending = await listVenueInventoryProposals({ venueId: venue._id, actorUserId: inventoryManager._id });
    assert.equal(pending.results.length, 2);
    assert.deepEqual(new Set(pending.results.map((entry) => entry.subject.preferredLabel)), new Set(["Opera proposta", "Tema non fisico"]));

    await assert.rejects(
      () => rejectVenueInventoryProposal({
        venueId: venue._id,
        proposalId: second.proposal._id,
        message: "",
        actorUserId: inventoryManager._id,
      }),
      (error) => error?.status === 400 && error?.details?.some((detail) => detail.field === "message" && detail.code === "REQUIRED"),
    );

    const accepted = await acceptVenueInventoryProposal({
      venueId: venue._id,
      proposalId: first.proposal._id,
      message: "Confermata come entità della sede.",
      actorUserId: inventoryManager._id,
    });
    assert.equal(accepted.createdVenueTarget, true);
    assert.equal(String(accepted.venueTarget.subjectId), String(acceptedSubject._id));
    assert.equal(accepted.venueTarget.provenance.origin, "inventory_proposal");
    assert.equal(String(accepted.venueTarget.provenance.sourceId), String(first.proposal._id));
    assert.equal(await VenueTarget.countDocuments({ venueId: venue._id, subjectId: acceptedSubject._id, lifecycleStatus: "active" }), 1);
    assert.equal(await ExhibitSlot.countDocuments({ venueId: venue._id }), 0, "accettare una proposta non deve collocare automaticamente l'entità");

    const rejected = await rejectVenueInventoryProposal({
      venueId: venue._id,
      proposalId: second.proposal._id,
      message: "È un tema editoriale, non un'entità dell'inventario fisico.",
      actorUserId: inventoryManager._id,
    });
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.decision.message, "È un tema editoriale, non un'entità dell'inventario fisico.");

    const decisions = await listVenueInventoryProposals({ venueId: venue._id, status: "all", actorUserId: inventoryManager._id });
    assert.deepEqual(new Set(decisions.results.map((entry) => entry.status)), new Set(["accepted", "rejected"]));
    assert.equal(await VenueInventoryProposal.countDocuments({ venueId: venue._id, status: "pending" }), 0);

    await assert.rejects(
      () => submitVenueInventoryProposal({
        venueId: venue._id,
        subjectId: acceptedSubject._id,
        sourceItemId: acceptedItem._id,
        actorUserId: contributor._id,
      }),
      (error) => error?.status === 409 && error?.details?.some((detail) => detail.code === "SUBJECT_ALREADY_IN_VENUE_INVENTORY"),
      "dopo l'accettazione il Subject è inventario, non una nuova proposta",
    );
  });
});
