const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  organizationOperations,
  memberOperations,
} = require("../services/marketplaceAccountWorkspaceV2.service");
const {
  namespaceOperations,
  venueOperations,
} = require("../services/marketplaceManagementV2.service");

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

test("Account Workspace projects role-specific Organization operations", () => {
  assert.deepEqual(
    organizationOperations("operator").map((entry) => entry.code),
    ["venue.create", "namespace.create"],
  );
  assert.deepEqual(
    organizationOperations("manager").map((entry) => entry.code),
    ["organization.update", "organization.member.add", "venue.create", "namespace.create"],
  );
});

test("Account Workspace never offers destructive membership operations for the creator", () => {
  const creatorId = oid();
  assert.deepEqual(memberOperations({
    actorUserId: creatorId,
    actorRole: "manager",
    organizationCreatedBy: creatorId,
    member: { id: creatorId, role: "manager" },
  }), []);
});

test("Account Workspace follows the Organization membership invariants", () => {
  const creatorId = oid();
  const otherId = oid();
  assert.deepEqual(
    memberOperations({ actorUserId: creatorId, actorRole: "manager", organizationCreatedBy: creatorId, member: { id: otherId, role: "operator" } }).map((entry) => entry.code),
    ["organization.member.promote", "organization.member.remove"],
  );
  assert.deepEqual(
    memberOperations({ actorUserId: creatorId, actorRole: "manager", organizationCreatedBy: creatorId, member: { id: otherId, role: "manager" } }).map((entry) => entry.code),
    ["organization.member.demote"],
  );
  assert.deepEqual(
    memberOperations({ actorUserId: otherId, actorRole: "manager", organizationCreatedBy: creatorId, member: { id: oid(), role: "manager" } }),
    [],
  );
});

test("Management projections expose only workflow operations valid for the current state", () => {
  const userId = oid();
  const organizationId = oid();
  const actor = { _id: userId, organizationMemberships: [{ organizationId, role: "manager" }] };
  assert.deepEqual(
    namespaceOperations({
      namespace: { ownerType: "organization", ownerId: organizationId, workingRevisionId: oid() },
      revision: { status: "draft" },
      actor,
    }).map((entry) => entry.code),
    ["namespace.update", "namespace.revision.update", "namespace.revision.check", "namespace.revision.request_review"],
  );
  assert.deepEqual(
    venueOperations({ release: { status: "in_review" }, role: "operator", hasWorking: true }).map((entry) => entry.code),
    ["venue.update", "venue.release.withdraw_review"],
  );
  assert.deepEqual(
    venueOperations({ release: { status: "in_review" }, role: "manager", hasWorking: true }).map((entry) => entry.code),
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
    const { getMarketplaceAccountWorkspace, getMarketplaceOrganizationDetail } = require("../services/marketplaceAccountWorkspaceV2.service");

    const [manager, operator] = await User.create([
      { username: "account-manager", passwordHash: "test-hash" },
      { username: "account-operator", passwordHash: "test-hash" },
    ]);
    const organization = await Organization.create({ name: "Musei Civici", description: "Rete museale", createdBy: manager._id });
    manager.organizationMemberships = [{ organizationId: organization._id, role: "manager", assignedBy: manager._id }];
    operator.organizationMemberships = [{ organizationId: organization._id, role: "operator", assignedBy: manager._id }];
    await Promise.all([manager.save(), operator.save()]);
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

    const projection = await getMarketplaceAccountWorkspace({ actorUserId: manager._id });
    assert.equal(projection.account.username, "account-manager");
    assert.equal(projection.personalNamespaces.length, 1);
    assert.equal(String(projection.personalNamespaces[0].id), String(personalNamespace._id));
    assert.equal(projection.organizations.length, 1);
    assert.deepEqual(projection.organizations[0].counts, { members: 2, venues: 1, namespaces: 1 });

    const detail = await getMarketplaceOrganizationDetail({ actorUserId: manager._id, organizationId: organization._id, limit: 1 });
    assert.equal(detail.members.total, 2);
    assert.equal(detail.members.results.length, 1);
    assert.equal(detail.venues.results[0].name, "Pinacoteca");
    assert.equal(detail.namespaces.results[0].name, "Vocabolario museale");
    assert.equal(detail.namespaces.results[0].state.mode, "working");

    const { getNamespaceManagementProjection, getVenueManagementProjection } = require("../services/marketplaceManagementV2.service");
    const namespaceEditor = await getNamespaceManagementProjection({ namespaceId: organizationNamespace._id, actorUserId: manager._id });
    assert.equal(namespaceEditor.namespace.source, "working");
    assert.equal(namespaceEditor.revision.status, "draft");
    assert.ok(namespaceEditor.availableOperations.some((entry) => entry.code === "namespace.revision.update"));

    const venue = await Venue.findOne({ ownerOrganizationId: organization._id });
    const venueEditor = await getVenueManagementProjection({ venueId: venue._id, actorUserId: operator._id });
    assert.equal(venueEditor.venue.role, "operator");
    assert.equal(venueEditor.release, null);
    assert.ok(venueEditor.availableOperations.some((entry) => entry.code === "venue.release.ensure"));
  });
});
