const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const mongoUri = process.env.MONGO_URI;
function oid() { return new mongoose.Types.ObjectId(); }

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

async function createRoleMembership({ OrganizationRole, OrganizationMembership, organizationId, userId, assignedBy, name, permissionCodes }) {
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
  return role;
}

test("Venue authoring inventory includes exposed, unplaced and unavailable targets while keeping item and physical capabilities independent", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Organization = require("../models/organization.model");
    const OrganizationRole = require("../models/organizationRole.model");
    const OrganizationMembership = require("../models/organizationMembership.model");
    const Subject = require("../models/subject.model");
    const Venue = require("../models/venue.model");
    const VenueTarget = require("../models/venueTarget.model");
    const ExhibitSlot = require("../models/exhibitSlot.model");
    const LayoutRevision = require("../models/layoutRevision.model");
    const VenueRelease = require("../models/venueRelease.model");
    const { listVenueAuthoringTargets } = require("../services/venueAuthoringTargetsV2.service");

    const [owner, contributor, venueManager] = await User.create([
      { username: "venue-authoring-owner", passwordHash: "hash" },
      { username: "venue-authoring-contributor", passwordHash: "hash" },
      { username: "venue-authoring-manager", passwordHash: "hash" },
    ]);
    const organization = await Organization.create({ name: "Museo authoring", createdBy: owner._id });

    await createRoleMembership({
      OrganizationRole,
      OrganizationMembership,
      organizationId: organization._id,
      userId: contributor._id,
      assignedBy: owner._id,
      name: "Contributor authoring",
      permissionCodes: ["venue.view", "item.create"],
    });
    await createRoleMembership({
      OrganizationRole,
      OrganizationMembership,
      organizationId: organization._id,
      userId: venueManager._id,
      assignedBy: owner._id,
      name: "Venue manager authoring",
      permissionCodes: ["venue.view", "venue.physical.edit"],
    });

    const venue = await Venue.create({
      name: "Sede test authoring",
      ownerOrganizationId: organization._id,
      createdBy: owner._id,
    });
    const [subjectExposed, subjectUnplaced, subjectUnavailable] = await Subject.create([
      { preferredLabel: "Opera esposta", createdBy: owner._id },
      { preferredLabel: "Opera da collocare", createdBy: owner._id },
      { preferredLabel: "Opera non disponibile", createdBy: owner._id },
    ]);
    const [targetExposed, targetUnplaced, targetUnavailable] = await VenueTarget.create([
      { venueId: venue._id, subjectId: subjectExposed._id, createdBy: owner._id },
      { venueId: venue._id, subjectId: subjectUnplaced._id, createdBy: owner._id },
      { venueId: venue._id, subjectId: subjectUnavailable._id, createdBy: owner._id },
    ]);

    const slot = await ExhibitSlot.create({ venueId: venue._id, createdBy: owner._id });
    const floorId = oid();
    const placeId = oid();
    const layout = await LayoutRevision.create({
      venueId: venue._id,
      version: 1,
      authoredAgainstPhysicalVocabularyRevisionId: oid(),
      floors: [{ _id: floorId, label: "Piano terra" }],
      places: [{ _id: placeId, floorId, placeTypeDefinitionId: "gallery", label: "Sala 1", position: { x: 0.5, y: 0.5 } }],
      exhibitSlots: [{ exhibitSlotId: slot._id, placeId, label: "Parete A", order: 0 }],
      status: "published",
      createdBy: owner._id,
      updatedBy: owner._id,
    });
    const release = await VenueRelease.create({
      venueId: venue._id,
      version: 1,
      layoutRevisionId: layout._id,
      targetBindings: [
        {
          venueTargetId: targetExposed._id,
          exhibitSlotId: slot._id,
          availability: "active",
          recognitionMedia: [{ url: "https://example.test/exposed.jpg", altText: "Vista frontale" }],
        },
        {
          venueTargetId: targetUnavailable._id,
          availability: "unavailable",
          recognitionMedia: [],
        },
      ],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: owner._id },
      publication: { publishedAt: new Date(), publishedBy: owner._id },
      createdBy: owner._id,
      updatedBy: owner._id,
    });
    venue.publishedReleaseId = release._id;
    await venue.save();

    const contributorProjection = await listVenueAuthoringTargets({
      venueId: venue._id,
      actorUserId: contributor._id,
    });
    assert.equal(contributorProjection.view, "published");
    assert.equal(contributorProjection.permissions.canCreateContent, true);
    assert.equal(contributorProjection.permissions.canEditInventory, false);
    assert.equal(contributorProjection.targets.length, 3);
    assert.deepEqual(
      contributorProjection.targets.map((target) => target.inventory.status),
      ["exposed", "unplaced", "unavailable"],
    );
    assert.equal(String(contributorProjection.targets[0].id), String(targetExposed._id));
    assert.equal(contributorProjection.targets[0].inventory.slot.label, "Parete A");
    assert.equal(contributorProjection.targets[0].recognitionMedia.length, 1);
    assert.equal(String(contributorProjection.targets[1].id), String(targetUnplaced._id));
    assert.equal(contributorProjection.targets[1].inventory.slot, null);
    assert.equal(String(contributorProjection.targets[2].id), String(targetUnavailable._id));

    const managerProjection = await listVenueAuthoringTargets({
      venueId: venue._id,
      actorUserId: venueManager._id,
    });
    assert.equal(managerProjection.permissions.canCreateContent, false);
    assert.equal(managerProjection.permissions.canEditInventory, true);
    assert.deepEqual(
      managerProjection.targets.map((target) => target.inventory.status),
      ["exposed", "unplaced", "unavailable"],
    );
  });
});
