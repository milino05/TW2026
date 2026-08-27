const mongoose = require("mongoose");
const Organization = require("../models/organization.model");
const OrganizationRole = require("../models/organizationRole.model");
const OrganizationMembership = require("../models/organizationMembership.model");
const OrganizationAuthorizationEvent = require("../models/organizationAuthorizationEvent.model");
const User = require("../models/user");
const AppError = require("../utils/AppError");
const { getActiveUserOrFail } = require("./userAuthorization.service");
const {
  assertOrganizationPermission,
  assertOrganizationMembership,
  assertDelegationCeiling,
} = require("./organizationAuthorization.service");
const {
  STARTER_ROLES,
  permissionClosure,
  projectPermissionCatalog,
} = require("./organizationPermissionRegistry.service");
const {
  normalizeOrganizationPayload,
  validateOrganizationPayload,
} = require("./validation/organization.validation");

function id(value) { return String(value?._id || value || ""); }
function normalizedName(value) { return String(value || "").trim().toLocaleLowerCase("it-IT"); }

async function runOrganizationTransaction(work) {
  let result = null;
  await mongoose.connection.transaction(async (session) => {
    result = await work(session);
  });
  return result;
}

async function findOrganizationOrFail({ organizationId, includeTrashed = false, session = null }) {
  const query = { _id: organizationId };
  if (!includeTrashed) query.lifecycleStatus = "active";
  const organization = await Organization.findOne(query).session(session);
  if (!organization) throw new AppError("Organizzazione non trovata", 404);
  return organization;
}

function validateRolePayload(payload, { partial = false } = {}) {
  const issues = [];
  const name = typeof payload?.name === "string" ? payload.name.trim() : "";
  if (!partial && !name) issues.push({ field: "name", code: "REQUIRED", message: "Il nome del ruolo è obbligatorio" });
  if (Object.prototype.hasOwnProperty.call(payload || {}, "name") && !name) {
    issues.push({ field: "name", code: "REQUIRED", message: "Il nome del ruolo è obbligatorio" });
  }
  if (name.length > 80) issues.push({ field: "name", code: "TOO_LONG", message: "Il nome può contenere al massimo 80 caratteri" });
  if (!partial && !Array.isArray(payload?.permissionCodes)) {
    issues.push({ field: "permissionCodes", code: "REQUIRED", message: "Selezionare i permessi del ruolo" });
  }
  if (Object.prototype.hasOwnProperty.call(payload || {}, "permissionCodes") && !Array.isArray(payload.permissionCodes)) {
    issues.push({ field: "permissionCodes", code: "INVALID_TYPE", message: "permissionCodes deve essere un array" });
  }
  if (issues.length) throw new AppError("Payload ruolo non valido", 400, issues);
  return {
    ...(Object.prototype.hasOwnProperty.call(payload || {}, "name") ? { name } : {}),
    ...(Object.prototype.hasOwnProperty.call(payload || {}, "description")
      ? { description: String(payload.description || "").trim().slice(0, 500) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(payload || {}, "permissionCodes")
      ? { permissionCodes: permissionClosure(payload.permissionCodes) }
      : {}),
  };
}

async function recordEvent({ organizationId, actorUserId, eventType, targetType, targetId, details = {}, session }) {
  await OrganizationAuthorizationEvent.create([{
    organizationId,
    actorUserId,
    eventType,
    targetType,
    targetId,
    details,
  }], { session });
}

function requirePermissions(authority, permissionCodes) {
  for (const permissionCode of permissionCodes) {
    if (!authority.effectivePermissions.includes(permissionCode)) {
      throw new AppError("Non disponi del permesso richiesto", 403, [{ code: "ORGANIZATION_PERMISSION_REQUIRED", permissionCode }]);
    }
  }
}

async function rolesForAssignment({ organizationId, roleIds, session }) {
  const uniqueIds = [...new Set((roleIds || []).map(id).filter(Boolean))];
  if (uniqueIds.length === 0) {
    throw new AppError("Una membership attiva richiede almeno un ruolo", 400, [{ field: "roleIds", code: "MIN_ITEMS" }]);
  }
  if (uniqueIds.some((roleId) => !mongoose.isValidObjectId(roleId))) {
    throw new AppError("Uno o più ruoli non sono validi", 400, [{ field: "roleIds", code: "INVALID_OBJECT_ID" }]);
  }
  const roles = await OrganizationRole.find({ _id: { $in: uniqueIds }, organizationId }).session(session).lean();
  if (roles.length !== uniqueIds.length) {
    throw new AppError("Uno o più ruoli non appartengono all'organizzazione", 400, [{ field: "roleIds", code: "ROLE_NOT_IN_ORGANIZATION" }]);
  }
  return roles;
}

async function createOrganization({ payload, actorUserId }) {
  const creator = await getActiveUserOrFail(actorUserId);
  const rawPayload = payload || {};
  const normalized = normalizeOrganizationPayload(rawPayload);
  const issues = validateOrganizationPayload({ payload: normalized, rawPayload, mode: "create" });
  if (issues.length) throw new AppError("Payload non valido", 400, issues);

  return runOrganizationTransaction(async (session) => {
    const now = new Date();
    const [organization] = await Organization.create([{
      ...normalized,
      createdBy: creator._id,
      owners: [{ userId: creator._id, grantedBy: creator._id, grantedAt: now }],
    }], { session });
    const starterRoles = await OrganizationRole.insertMany(STARTER_ROLES.map((role) => ({
      organizationId: organization._id,
      name: role.name,
      normalizedName: normalizedName(role.name),
      description: role.description,
      permissionCodes: role.permissionCodes,
      starterKey: role.key,
      createdBy: creator._id,
      updatedBy: creator._id,
    })), { session });
    const administrator = starterRoles.find((role) => role.starterKey === "administrator");
    await OrganizationMembership.create([{
      organizationId: organization._id,
      userId: creator._id,
      roleAssignments: [{ roleId: administrator._id, assignedBy: creator._id, assignedAt: now }],
      createdBy: creator._id,
      updatedBy: creator._id,
    }], { session });
    await recordEvent({
      organizationId: organization._id,
      actorUserId: creator._id,
      eventType: "organization.created",
      targetType: "organization",
      targetId: organization._id,
      details: { starterRoleIds: starterRoles.map((role) => role._id) },
      session,
    });
    return organization;
  });
}

async function updateOrganization({ organizationId, payload, actorUserId }) {
  const rawPayload = payload || {};
  const normalized = normalizeOrganizationPayload(rawPayload);
  const issues = validateOrganizationPayload({ payload: normalized, rawPayload, mode: "update" });
  if (issues.length) throw new AppError("Payload non valido", 400, issues);
  return runOrganizationTransaction(async (session) => {
    await assertOrganizationPermission({ userId: actorUserId, organizationId, permissionCode: "organization.profile.manage", session });
    const organization = await findOrganizationOrFail({ organizationId, session });
    const before = { name: organization.name, description: organization.description };
    if (Object.prototype.hasOwnProperty.call(normalized, "name")) organization.name = normalized.name;
    if (Object.prototype.hasOwnProperty.call(normalized, "description")) organization.description = normalized.description;
    await organization.save({ session });
    await recordEvent({
      organizationId,
      actorUserId,
      eventType: "organization.updated",
      targetType: "organization",
      targetId: organizationId,
      details: { before, after: { name: organization.name, description: organization.description } },
      session,
    });
    return organization;
  });
}

async function createOrganizationRole({ organizationId, payload, actorUserId }) {
  const normalized = validateRolePayload(payload);
  try {
    return await runOrganizationTransaction(async (session) => {
      const authority = await assertOrganizationPermission({ userId: actorUserId, organizationId, permissionCode: "organization.roles.manage", session });
      normalized.permissionCodes = assertDelegationCeiling({ authority, permissionCodes: normalized.permissionCodes });
      const [role] = await OrganizationRole.create([{
        organizationId,
        ...normalized,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      }], { session });
      await recordEvent({ organizationId, actorUserId, eventType: "role.created", targetType: "role", targetId: role._id, details: { name: role.name, permissionCodes: role.permissionCodes }, session });
      return role;
    });
  } catch (error) {
    if (error?.code === 11000) throw new AppError("Esiste già un ruolo con questo nome", 409, [{ field: "name", code: "DUPLICATE" }]);
    throw error;
  }
}

async function updateOrganizationRole({ organizationId, roleId, payload, actorUserId }) {
  const normalized = validateRolePayload(payload, { partial: true });
  try {
    return await runOrganizationTransaction(async (session) => {
      const authority = await assertOrganizationPermission({ userId: actorUserId, organizationId, permissionCode: "organization.roles.manage", session });
      const role = await OrganizationRole.findOne({ _id: roleId, organizationId }).session(session);
      if (!role) throw new AppError("Ruolo non trovato", 404);
      const before = { name: role.name, description: role.description, permissionCodes: role.permissionCodes };
      if (normalized.name !== undefined) role.name = normalized.name;
      if (normalized.description !== undefined) role.description = normalized.description;
      if (normalized.permissionCodes !== undefined) {
        role.permissionCodes = assertDelegationCeiling({ authority, permissionCodes: normalized.permissionCodes });
      }
      role.updatedBy = actorUserId;
      await role.save({ session });
      await recordEvent({ organizationId, actorUserId, eventType: "role.updated", targetType: "role", targetId: role._id, details: { before, after: { name: role.name, description: role.description, permissionCodes: role.permissionCodes } }, session });
      return role;
    });
  }
  catch (error) {
    if (error?.code === 11000) throw new AppError("Esiste già un ruolo con questo nome", 409, [{ field: "name", code: "DUPLICATE" }]);
    throw error;
  }
}

async function deleteOrganizationRole({ organizationId, roleId, actorUserId }) {
  return runOrganizationTransaction(async (session) => {
    const authority = await assertOrganizationPermission({ userId: actorUserId, organizationId, permissionCode: "organization.roles.manage", session });
    const role = await OrganizationRole.findOne({ _id: roleId, organizationId }).session(session);
    if (!role) throw new AppError("Ruolo non trovato", 404);
    assertDelegationCeiling({ authority, permissionCodes: role.permissionCodes });
    const assignmentCount = await OrganizationMembership.countDocuments({ organizationId, "roleAssignments.roleId": role._id }).session(session);
    if (assignmentCount > 0) {
      throw new AppError("Il ruolo è ancora assegnato e non può essere eliminato", 409, [{ code: "ROLE_ASSIGNED", assignmentCount }]);
    }
    await role.deleteOne({ session });
    await recordEvent({ organizationId, actorUserId, eventType: "role.removed", targetType: "role", targetId: role._id, details: { name: role.name, permissionCodes: role.permissionCodes }, session });
    return { roleId: role._id, removed: true };
  });
}

async function listOrganizationRoles({ organizationId, actorUserId }) {
  await assertOrganizationPermission({ userId: actorUserId, organizationId, permissionCode: "organization.roles.view" });
  const [roles, counts] = await Promise.all([
    OrganizationRole.find({ organizationId }).sort({ name: 1 }).lean(),
    OrganizationMembership.aggregate([
      { $match: { organizationId: new mongoose.Types.ObjectId(organizationId) } },
      { $unwind: "$roleAssignments" },
      { $group: { _id: "$roleAssignments.roleId", count: { $sum: 1 } } },
    ]),
  ]);
  const countByRole = new Map(counts.map((entry) => [id(entry._id), entry.count]));
  return roles.map((role) => ({ ...role, assignmentCount: countByRole.get(id(role._id)) || 0 }));
}

async function setMemberRoles({ organizationId, targetUserId, roleIds, actorUserId, createOnly = false }) {
  return runOrganizationTransaction(async (session) => {
    const authority = await assertOrganizationMembership({ userId: actorUserId, organizationId, session });
    requirePermissions(authority, ["organization.members.manage", "organization.roles.assign"]);
    const target = await User.findOne({ _id: targetUserId, status: "active" }).session(session);
    if (!target) throw new AppError("Utente destinatario non trovato o non attivo", 404);
    const roles = await rolesForAssignment({ organizationId, roleIds, session });
    assertDelegationCeiling({ authority, permissionCodes: roles.flatMap((role) => role.permissionCodes) });
    const existing = await OrganizationMembership.findOne({ organizationId, userId: target._id }).session(session);
    if (createOnly && existing) throw new AppError("L'utente appartiene già all'organizzazione", 409);
    if (existing) {
      const existingRoles = await OrganizationRole.find({
        organizationId,
        _id: { $in: existing.roleAssignments.map((assignment) => assignment.roleId) },
      }).session(session).lean();
      assertDelegationCeiling({ authority, permissionCodes: existingRoles.flatMap((role) => role.permissionCodes) });
    }
    const now = new Date();
    const previousByRole = new Map((existing?.roleAssignments || []).map((assignment) => [id(assignment.roleId), assignment]));
    const assignments = roles.map((role) => previousByRole.get(id(role._id)) || {
      roleId: role._id,
      assignedBy: actorUserId,
      assignedAt: now,
    });
    const membership = await OrganizationMembership.findOneAndUpdate(
      { organizationId, userId: target._id },
      {
        $set: { roleAssignments: assignments, updatedBy: actorUserId },
        $setOnInsert: { createdBy: actorUserId },
      },
      { upsert: true, new: true, runValidators: true, session },
    );
    await recordEvent({
      organizationId,
      actorUserId,
      eventType: existing ? "membership.roles.updated" : "membership.created",
      targetType: "membership",
      targetId: membership._id,
      details: { userId: target._id, beforeRoleIds: (existing?.roleAssignments || []).map((entry) => entry.roleId), afterRoleIds: roles.map((role) => role._id) },
      session,
    });
    return OrganizationMembership.findById(membership._id).populate("roleAssignments.roleId").session(session);
  });
}

async function addOrganizationMemberByUsername({ organizationId, username, roleIds, actorUserId }) {
  const normalizedUsername = typeof username === "string" ? username.trim().toLowerCase() : "";
  if (!normalizedUsername) throw new AppError("username è obbligatorio", 400, [{ field: "username", code: "REQUIRED" }]);
  const target = await User.findOne({ username: normalizedUsername, status: "active" }).select("_id");
  if (!target) throw new AppError("Utente destinatario non trovato o non attivo", 404);
  return setMemberRoles({ organizationId, targetUserId: target._id, roleIds, actorUserId, createOnly: true });
}

async function removeOrganizationMember({ organizationId, targetUserId, actorUserId }) {
  return runOrganizationTransaction(async (session) => {
    const authority = await assertOrganizationPermission({ userId: actorUserId, organizationId, permissionCode: "organization.members.manage", session });
    const organization = await findOrganizationOrFail({ organizationId, session });
    if (organization.owners.some((owner) => id(owner.userId) === id(targetUserId))) {
      throw new AppError("Un Owner deve prima rinunciare all'autorità Owner", 409, [{ code: "OWNER_MEMBERSHIP_REQUIRED" }]);
    }
    const membership = await OrganizationMembership.findOne({ organizationId, userId: targetUserId })
      .populate("roleAssignments.roleId")
      .session(session);
    if (!membership) throw new AppError("L'utente non appartiene all'organizzazione", 404);
    assertDelegationCeiling({
      authority,
      permissionCodes: membership.roleAssignments.flatMap((assignment) => assignment.roleId?.permissionCodes || []),
    });
    await membership.deleteOne({ session });
    await recordEvent({ organizationId, actorUserId, eventType: "membership.removed", targetType: "membership", targetId: membership._id, details: { userId: targetUserId, removedRoleIds: membership.roleAssignments.map((entry) => entry.roleId) }, session });
    return { userId: targetUserId, organizationId, removed: true };
  });
}

async function assertOwnerAuthority({ organizationId, actorUserId, session = null }) {
  const authority = await assertOrganizationMembership({ userId: actorUserId, organizationId, session });
  if (!authority.isOwner) throw new AppError("È richiesta l'autorità Owner dell'organizzazione", 403, [{ code: "ORGANIZATION_OWNER_REQUIRED" }]);
  return authority;
}

async function grantOrganizationOwner({ organizationId, targetUserId, actorUserId }) {
  return runOrganizationTransaction(async (session) => {
    await assertOwnerAuthority({ organizationId, actorUserId, session });
    const membership = await OrganizationMembership.exists({ organizationId, userId: targetUserId }).session(session);
    if (!membership) throw new AppError("Solo un membro attivo può diventare Owner", 409, [{ code: "OWNER_REQUIRES_MEMBERSHIP" }]);
    const target = await User.exists({ _id: targetUserId, status: "active" }).session(session);
    if (!target) throw new AppError("Utente destinatario non trovato o non attivo", 404);
    const organization = await Organization.findOneAndUpdate(
      { _id: organizationId, lifecycleStatus: "active", "owners.userId": { $ne: targetUserId } },
      { $push: { owners: { userId: targetUserId, grantedBy: actorUserId, grantedAt: new Date() } } },
      { new: true, runValidators: true, session },
    );
    if (!organization) {
      const existing = await findOrganizationOrFail({ organizationId, session });
      if (existing.owners.some((owner) => id(owner.userId) === id(targetUserId))) throw new AppError("L'utente è già Owner", 409);
      throw new AppError("Impossibile assegnare l'autorità Owner", 409);
    }
    await recordEvent({ organizationId, actorUserId, eventType: "owner.granted", targetType: "owner", targetId: targetUserId, details: {}, session });
    return organization;
  });
}

async function revokeOrganizationOwner({ organizationId, targetUserId, actorUserId }) {
  return runOrganizationTransaction(async (session) => {
    await assertOwnerAuthority({ organizationId, actorUserId, session });
    const organization = await Organization.findOneAndUpdate(
      { _id: organizationId, lifecycleStatus: "active", "owners.userId": targetUserId, "owners.1": { $exists: true } },
      { $pull: { owners: { userId: targetUserId } } },
      { new: true, runValidators: true, session },
    );
    if (!organization) {
      const existing = await findOrganizationOrFail({ organizationId, session });
      if (!existing.owners.some((owner) => id(owner.userId) === id(targetUserId))) throw new AppError("L'utente non è Owner", 404);
      throw new AppError("L'ultimo Owner non può essere revocato", 409, [{ code: "LAST_OWNER_REQUIRED" }]);
    }
    await recordEvent({ organizationId, actorUserId, eventType: "owner.revoked", targetType: "owner", targetId: targetUserId, details: {}, session });
    return organization;
  });
}

async function listAuthorizationEvents({ organizationId, actorUserId, page = 1, limit = 25 }) {
  await assertOrganizationPermission({ userId: actorUserId, organizationId, permissionCode: "organization.audit.view" });
  const normalizedPage = Math.max(1, Number.parseInt(page, 10) || 1);
  const pageSize = Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 25));
  const query = { organizationId };
  const [events, total] = await Promise.all([
    OrganizationAuthorizationEvent.find(query).sort({ createdAt: -1 }).skip((normalizedPage - 1) * pageSize).limit(pageSize).lean(),
    OrganizationAuthorizationEvent.countDocuments(query),
  ]);
  return { results: events, page: normalizedPage, pageSize, total };
}

async function getPermissionCatalog({ organizationId, actorUserId }) {
  await assertOrganizationPermission({ userId: actorUserId, organizationId, permissionCode: "organization.roles.view" });
  return { groups: projectPermissionCatalog() };
}

async function listOrganizations() {
  return Organization.find({ lifecycleStatus: "active" }).select("name description").sort({ name: 1 }).lean();
}
async function getOrganizationById({ organizationId }) {
  const organization = await Organization.findOne({ _id: organizationId, lifecycleStatus: "active" }).select("name description").lean();
  if (!organization) throw new AppError("Organizzazione non trovata", 404);
  return organization;
}

module.exports = {
  findOrganizationOrFail,
  createOrganization,
  updateOrganization,
  createOrganizationRole,
  updateOrganizationRole,
  deleteOrganizationRole,
  listOrganizationRoles,
  setMemberRoles,
  addOrganizationMemberByUsername,
  removeOrganizationMember,
  grantOrganizationOwner,
  revokeOrganizationOwner,
  listAuthorizationEvents,
  getPermissionCatalog,
  listOrganizations,
  getOrganizationById,
};
