const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_organization_rbac_v2`;
  return parsed.toString();
}
const mongoUri = isolatedMongoUri(baseMongoUri);

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

test("bootstrap, multi-role, Owner, delegation ceiling e audit rispettano le invarianti", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Organization = require("../models/organization.model");
    const OrganizationRole = require("../models/organizationRole.model");
    const OrganizationMembership = require("../models/organizationMembership.model");
    const OrganizationAuthorizationEvent = require("../models/organizationAuthorizationEvent.model");
    const organizationService = require("../services/organization.service");
    const { resolveOrganizationAuthority } = require("../services/organizationAuthorization.service");
    const { resolveActorPrincipals } = require("../services/principalResolution.service");

    const [creator, delegate, viewer] = await User.create([
      { username: "rbac-creator", passwordHash: "hash" },
      { username: "rbac-delegate", passwordHash: "hash" },
      { username: "rbac-viewer", passwordHash: "hash" },
    ]);
    const organization = await organizationService.createOrganization({
      payload: { name: "Fondazione RBAC", description: "Test autorizzativo" },
      actorUserId: creator._id,
    });
    const storedOrganization = await Organization.findById(organization._id).lean();
    assert.equal(storedOrganization.owners.length, 1);
    assert.equal(String(storedOrganization.owners[0].userId), String(creator._id));

    const starterRoles = await OrganizationRole.find({ organizationId: organization._id }).sort({ starterKey: 1 }).lean();
    assert.equal(starterRoles.length, 6);
    const administrator = starterRoles.find((role) => role.starterKey === "administrator");
    const viewerRole = starterRoles.find((role) => role.starterKey === "viewer");
    const creatorMembership = await OrganizationMembership.findOne({ organizationId: organization._id, userId: creator._id }).lean();
    assert.deepEqual(creatorMembership.roleAssignments.map((entry) => String(entry.roleId)), [String(administrator._id)]);

    await organizationService.setMemberRoles({ organizationId: organization._id, targetUserId: viewer._id, roleIds: [viewerRole._id], actorUserId: creator._id, createOnly: true });
    await organizationService.grantOrganizationOwner({ organizationId: organization._id, targetUserId: viewer._id, actorUserId: creator._id });
    await assert.rejects(
      () => organizationService.updateOrganization({ organizationId: organization._id, payload: { description: "Owner senza permesso" }, actorUserId: viewer._id }),
      (error) => error?.status === 403 && error?.details?.[0]?.permissionCode === "organization.profile.manage",
    );
    await organizationService.revokeOrganizationOwner({ organizationId: organization._id, targetUserId: creator._id, actorUserId: viewer._id });
    await assert.rejects(
      () => organizationService.revokeOrganizationOwner({ organizationId: organization._id, targetUserId: viewer._id, actorUserId: viewer._id }),
      (error) => error?.status === 409 && error?.details?.[0]?.code === "LAST_OWNER_REQUIRED",
    );

    const delegatorRole = await organizationService.createOrganizationRole({
      organizationId: organization._id,
      actorUserId: creator._id,
      payload: {
        name: "Delegatore contenuti",
        permissionCodes: [
          "organization.members.manage", "organization.roles.assign", "organization.roles.manage", "item.edit",
        ],
      },
    });
    await organizationService.setMemberRoles({ organizationId: organization._id, targetUserId: delegate._id, roleIds: [delegatorRole._id], actorUserId: creator._id, createOnly: true });
    const allowedRole = await organizationService.createOrganizationRole({
      organizationId: organization._id,
      actorUserId: delegate._id,
      payload: { name: "Editor limitato", permissionCodes: ["item.edit"] },
    });
    await assert.rejects(
      () => organizationService.createOrganizationRole({ organizationId: organization._id, actorUserId: delegate._id, payload: { name: "Escalation", permissionCodes: ["venue.view"] } }),
      (error) => error?.status === 403 && error?.details?.[0]?.code === "DELEGATION_CEILING_EXCEEDED",
    );
    await assert.rejects(
      () => organizationService.setMemberRoles({ organizationId: organization._id, targetUserId: creator._id, roleIds: [allowedRole._id], actorUserId: delegate._id }),
      (error) => error?.status === 403 && error?.details?.[0]?.code === "DELEGATION_CEILING_EXCEEDED",
    );
    await assert.rejects(
      () => organizationService.removeOrganizationMember({ organizationId: organization._id, targetUserId: creator._id, actorUserId: delegate._id }),
      (error) => error?.status === 403 && error?.details?.[0]?.code === "DELEGATION_CEILING_EXCEEDED",
    );

    await organizationService.setMemberRoles({ organizationId: organization._id, targetUserId: viewer._id, roleIds: [viewerRole._id, allowedRole._id], actorUserId: creator._id });
    let viewerAuthority = await resolveOrganizationAuthority({ userId: viewer._id, organizationId: organization._id });
    assert.equal(viewerAuthority.effectivePermissions.includes("item.edit"), true);
    await organizationService.updateOrganizationRole({ organizationId: organization._id, roleId: allowedRole._id, payload: { permissionCodes: ["item.view"] }, actorUserId: creator._id });
    viewerAuthority = await resolveOrganizationAuthority({ userId: viewer._id, organizationId: organization._id });
    assert.equal(viewerAuthority.effectivePermissions.includes("item.edit"), false);
    await assert.rejects(
      () => organizationService.deleteOrganizationRole({ organizationId: organization._id, roleId: allowedRole._id, actorUserId: creator._id }),
      (error) => error?.status === 409 && error?.details?.[0]?.code === "ROLE_ASSIGNED",
    );

    await organizationService.setMemberRoles({ organizationId: organization._id, targetUserId: viewer._id, roleIds: [viewerRole._id], actorUserId: creator._id });
    await organizationService.deleteOrganizationRole({ organizationId: organization._id, roleId: allowedRole._id, actorUserId: creator._id });
    await organizationService.removeOrganizationMember({ organizationId: organization._id, targetUserId: delegate._id, actorUserId: creator._id });
    const principalsAfterRemoval = await resolveActorPrincipals(delegate._id);
    assert.equal(principalsAfterRemoval.principals.some((entry) => entry.type === "organization" && String(entry.id) === String(organization._id)), false);

    const distributionViewer = await organizationService.createOrganizationRole({
      organizationId: organization._id,
      actorUserId: creator._id,
      payload: { name: "Distribuzione senza finanza", permissionCodes: ["marketplace.distribution.view"] },
    });
    await organizationService.setMemberRoles({ organizationId: organization._id, targetUserId: viewer._id, roleIds: [distributionViewer._id], actorUserId: creator._id });
    const preflight = await require("../services/marketplaceAuthoringPreflightV2.service").getMarketplaceAuthoringPreflight({
      actorUserId: viewer._id,
      principalType: "organization",
      principalId: organization._id,
    });
    assert.deepEqual(preflight.capabilities, {
      contentCreate: false,
      editorialCollectionCreate: false,
      editorialSpaceManage: false,
      semanticGraphEdit: false,
      visitCreate: false,
    });
    assert.equal(preflight.content.allowed, false);
    assert.equal(preflight.collection.allowed, false);
    assert.equal(preflight.relations.allowed, false);
    assert.equal(preflight.visit.allowed, false);
    assert.equal(Object.prototype.hasOwnProperty.call(preflight.principal, "effectivePermissions"), false);
    const dashboard = await require("../services/marketplaceWorkspaceV2.service").getDistributionDashboard({
      actorUserId: viewer._id,
      principalType: "organization",
      principalId: organization._id,
    });
    assert.deepEqual(dashboard.capabilities, { financeView: false });
    assert.equal(Object.prototype.hasOwnProperty.call(dashboard.summary, "revenueByCurrency"), false);

    const auditEvents = await OrganizationAuthorizationEvent.find({ organizationId: organization._id }).lean();
    assert.ok(auditEvents.some((event) => event.eventType === "owner.granted"));
    assert.ok(auditEvents.some((event) => event.eventType === "role.updated"));
    assert.ok(auditEvents.some((event) => event.eventType === "membership.removed"));
  });
});

test("i nomi dei ruoli sono unici dopo normalizzazione", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const organizationService = require("../services/organization.service");
    const creator = await User.create({ username: "rbac-name-owner", passwordHash: "hash" });
    const organization = await organizationService.createOrganization({ payload: { name: "Ruoli unici" }, actorUserId: creator._id });
    await organizationService.createOrganizationRole({ organizationId: organization._id, actorUserId: creator._id, payload: { name: "Responsabile Mostre", permissionCodes: ["item.view"] } });
    await assert.rejects(
      () => organizationService.createOrganizationRole({ organizationId: organization._id, actorUserId: creator._id, payload: { name: "  responsabile mostre  ", permissionCodes: ["visit.view"] } }),
      (error) => error?.status === 409,
    );
  });
});