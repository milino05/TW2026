const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  organizationOperations,
  memberOperations,
} = require("../services/marketplaceAccountWorkspaceV2.service");
const {
  namespaceOperations,
  physicalVocabularyOperations,
  venueOperations,
} = require("../services/marketplaceManagementV2.service");

const mongoUri = process.env.MONGO_URI;
const { assignStarterRole } = require("./helpers/organizationRbac");

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

test("Account Workspace projects permission-specific Organization operations", () => {
  assert.deepEqual(
    organizationOperations({ effectivePermissions: ["venue.create", "namespace.create"], isOwner: false }).map((entry) => entry.code),
    ["venue.create", "namespace.create"],
  );
  assert.deepEqual(
    organizationOperations({ effectivePermissions: ["organization.profile.manage", "organization.members.manage", "organization.roles.assign", "venue.create", "namespace.create"], isOwner: false }).map((entry) => entry.code),
    ["organization.update", "organization.member.add", "venue.create", "namespace.create"],
  );
});

test("Account Workspace keeps Owner authority separate from ordinary membership permissions", () => {
  const authority = { effectivePermissions: ["organization.members.manage", "organization.roles.assign"], isOwner: true };
  const organization = { owners: [{ userId: oid() }, { userId: oid() }] };
  assert.deepEqual(memberOperations({ authority, organization, member: { id: oid(), isOwner: false } }).map((entry) => entry.code), [
    "organization.member.roles.update", "organization.member.remove", "organization.owner.grant",
  ]);
  assert.deepEqual(memberOperations({ authority: { ...authority, isOwner: false }, organization, member: { id: oid(), isOwner: true } }).map((entry) => entry.code), ["organization.member.roles.update"]);
});

test("Management projections expose only workflow operations valid for the current state", () => {
  const organizationId = oid();
  const editor = new Set(["namespace.edit", "namespace.review", "namespace.publish"]);
  assert.deepEqual(
    physicalVocabularyOperations({
      physicalVocabulary: { ownerType: "organization", ownerId: organizationId, workingRevisionId: oid() },
      revision: { status: "in_review" },
      permissions: new Set(["physical_vocabulary.view", "physical_vocabulary.publish"]),
    }).map((entry) => entry.code),
    ["physical_vocabulary.revision.publish"],
  );
  assert.deepEqual(
    namespaceOperations({
      namespace: { ownerType: "organization", ownerId: organizationId, workingRevisionId: oid() },
      revision: { status: "draft" },
      permissions: editor,
    }).map((entry) => entry.code),
    ["namespace.update", "namespace.revision.update", "namespace.revision.check"],
  );
  assert.deepEqual(
    venueOperations({ release: { status: "in_review" }, permissions: new Set(["venue.profile.manage", "venue.physical.edit"]), hasWorking: true }).map((entry) => entry.code),
    ["venue.update", "venue.release.withdraw_review"],
  );
  assert.deepEqual(
    venueOperations({ release: { status: "in_review" }, permissions: new Set(["venue.profile.manage", "venue.physical.edit", "venue.physical.review", "venue.physical.publish"]), hasWorking: true }).map((entry) => entry.code),
    ["venue.update", "venue.release.withdraw_review", "venue.release.request_changes", "venue.release.publish"],
  );
});

test("Account Workspace groups personal and Organization resources without merging Venue and Namespace", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Organization = require("../models/organization.model");
    const Venue = require("../models/venue.model");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const PhysicalVocabulary = require("../models/physicalVocabulary.model");
    const PhysicalVocabularyRevision = require("../models/physicalVocabularyRevision.model");
    const { getMarketplaceAccountWorkspace, getMarketplaceOrganizationDetail } = require("../services/marketplaceAccountWorkspaceV2.service");

    const [manager, operator] = await User.create([
      { username: "account-manager", passwordHash: "test-hash" },
      { username: "account-operator", passwordHash: "test-hash" },
    ]);
    const organization = await Organization.create({ name: "Musei Civici", description: "Rete museale", createdBy: manager._id });
    await assignStarterRole({ organization, user: manager, starterKey: "administrator" });
    await assignStarterRole({ organization, user: operator, starterKey: "venue_manager", actorUserId: manager._id });
    await Venue.create({ name: "Pinacoteca", ownerOrganizationId: organization._id, createdBy: manager._id });

    const [personalNamespace, organizationNamespace] = await Namespace.create([
      { name: "Vocabolario personale", ownerType: "user", ownerId: manager._id, createdBy: manager._id },
      { name: "Vocabolario museale", ownerType: "organization", ownerId: organization._id, createdBy: manager._id },
    ]);
    const revision = await NamespaceRevision.create({
      namespaceId: organizationNamespace._id,
      version: 1,
      status: "draft",
      createdBy: manager._id,
      updatedBy: manager._id,
    });
    organizationNamespace.workingRevisionId = revision._id;
    await organizationNamespace.save();

    const [personalPhysicalVocabulary, organizationPhysicalVocabulary] = await PhysicalVocabulary.create([
      { name: "Spazi personali", ownerType: "user", ownerId: manager._id, createdBy: manager._id },
      { name: "Spazi museali", ownerType: "organization", ownerId: organization._id, createdBy: manager._id },
    ]);
    const physicalRevision = await PhysicalVocabularyRevision.create({
      physicalVocabularyId: organizationPhysicalVocabulary._id,
      version: 1,
      status: "draft",
      createdBy: manager._id,
      updatedBy: manager._id,
    });
    organizationPhysicalVocabulary.workingRevisionId = physicalRevision._id;
    await organizationPhysicalVocabulary.save();

    const projection = await getMarketplaceAccountWorkspace({ actorUserId: manager._id });
    assert.equal(projection.account.username, "account-manager");
    assert.equal(projection.personalNamespaces.length, 1);
    assert.equal(String(projection.personalNamespaces[0].id), String(personalNamespace._id));
    assert.equal(String(projection.personalPhysicalVocabularies[0].id), String(personalPhysicalVocabulary._id));
    assert.equal(projection.organizations.length, 1);
    assert.deepEqual(projection.organizations[0].counts, { members: 2, venues: 1, namespaces: 1, physicalVocabularies: 1 });

    const detail = await getMarketplaceOrganizationDetail({ actorUserId: manager._id, organizationId: organization._id, limit: 1 });
    assert.equal(detail.members.total, 2);
    assert.equal(detail.members.results.length, 1);
    assert.equal(detail.venues.results[0].name, "Pinacoteca");
    assert.equal(detail.namespaces.results[0].name, "Vocabolario museale");
    assert.equal(detail.namespaces.results[0].state.mode, "working");
    assert.equal(detail.physicalVocabularies.results[0].name, "Spazi museali");
    assert.equal(detail.physicalVocabularies.results[0].state.mode, "working");

    const { getNamespaceManagementProjection, getPhysicalVocabularyManagementProjection, getVenueManagementProjection } = require("../services/marketplaceManagementV2.service");
    const namespaceEditor = await getNamespaceManagementProjection({ namespaceId: organizationNamespace._id, actorUserId: manager._id });
    assert.equal(namespaceEditor.namespace.source, "working");
    assert.equal(namespaceEditor.revision.status, "draft");
    assert.ok(namespaceEditor.availableOperations.some((entry) => entry.code === "namespace.revision.update"));
    const physicalVocabularyEditor = await getPhysicalVocabularyManagementProjection({ physicalVocabularyId: organizationPhysicalVocabulary._id, actorUserId: manager._id });
    assert.equal(physicalVocabularyEditor.physicalVocabulary.source, "working");
    assert.equal(physicalVocabularyEditor.revision.status, "draft");
    assert.ok(physicalVocabularyEditor.availableOperations.some((entry) => entry.code === "physical_vocabulary.starter.apply"));

    const venue = await Venue.findOne({ ownerOrganizationId: organization._id });
    const venueEditor = await getVenueManagementProjection({ venueId: venue._id, actorUserId: operator._id });
    assert.equal(Object.prototype.hasOwnProperty.call(venueEditor.venue, "role"), false);
    assert.equal(venueEditor.release, null);
    assert.ok(venueEditor.availableOperations.some((entry) => entry.code === "venue.release.ensure"));
  });
});
