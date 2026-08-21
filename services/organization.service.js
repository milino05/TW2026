const Organization = require("../models/organization.model");
const User = require("../models/user");
const AppError = require("../utils/AppError");
const { getActiveUserOrFail } = require("./userAuthorization.service");
const { assertOrganizationRole } = require("./organizationAuthorization.service");
const {
  normalizeOrganizationPayload,
  validateOrganizationPayload,
} = require("./validation/organization.validation");

async function findOrganizationOrFail({ organizationId, includeTrashed = false }) {
  const query = { _id: organizationId };
  if (!includeTrashed) query.lifecycleStatus = "active";
  const organization = await Organization.findOne(query);
  if (!organization) throw new AppError("Organizzazione non trovata", 404);
  return organization;
}

async function createOrganization({ payload, actorUserId }) {
  const creator = await getActiveUserOrFail(actorUserId);
  const normalized = normalizeOrganizationPayload(payload || {});
  const issues = validateOrganizationPayload({ payload: normalized, mode: "create" });
  if (issues.length) throw new AppError("Payload non valido", 400, issues);

  const organization = await Organization.create({
    ...normalized,
    createdBy: creator._id,
  });

  try {
    creator.organizationMemberships.push({
      organizationId: organization._id,
      role: "manager",
      assignedBy: creator._id,
      assignedAt: new Date(),
    });
    await creator.save();
  } catch (error) {
    await organization.deleteOne().catch(() => {});
    throw error;
  }

  return organization;
}

async function updateOrganization({ organizationId, payload, actorUserId }) {
  await assertOrganizationRole({ userId: actorUserId, organizationId, minimumRole: "manager" });
  const organization = await findOrganizationOrFail({ organizationId });
  const normalized = normalizeOrganizationPayload(payload || {});
  const issues = validateOrganizationPayload({ payload: normalized, mode: "update" });
  if (issues.length) throw new AppError("Payload non valido", 400, issues);
  if (Object.prototype.hasOwnProperty.call(normalized, "name")) organization.name = normalized.name;
  if (Object.prototype.hasOwnProperty.call(normalized, "description")) organization.description = normalized.description;
  await organization.save();
  return organization;
}

async function assignOrganizationRole({ organizationId, targetUserId, role, actorUserId }) {
  await assertOrganizationRole({ userId: actorUserId, organizationId, minimumRole: "manager" });
  const organization = await findOrganizationOrFail({ organizationId });
  if (!["operator", "manager"].includes(role)) {
    throw new AppError("Ruolo non valido", 400, [{
      field: "role",
      code: "INVALID_ENUM",
      message: "role deve essere operator oppure manager",
      allowedValues: ["operator", "manager"],
    }]);
  }

  const target = await User.findOne({ _id: targetUserId, status: "active" });
  if (!target) throw new AppError("Utente destinatario non trovato o non attivo", 404);
  const membership = (target.organizationMemberships || []).find(
    (entry) => String(entry.organizationId) === String(organizationId),
  );

  if (String(target._id) === String(organization.createdBy) && role !== "manager") {
    throw new AppError("Il creatore dell'organizzazione deve rimanere manager", 409);
  }
  if (membership?.role === "manager" && role === "operator" && String(actorUserId) !== String(organization.createdBy)) {
    throw new AppError("Solo il creatore dell'organizzazione puo retrocedere un manager", 403);
  }
  if (!membership && role === "manager") {
    throw new AppError("Un utente deve prima essere assegnato come operator prima di essere promosso a manager", 409);
  }

  if (membership) {
    membership.role = role;
    membership.assignedBy = actorUserId;
    membership.assignedAt = new Date();
  } else {
    target.organizationMemberships.push({
      organizationId,
      role,
      assignedBy: actorUserId,
      assignedAt: new Date(),
    });
  }
  await target.save();

  return { userId: target._id, username: target.username, organizationId, role };
}

async function assignOrganizationRoleByUsername({ organizationId, username, role, actorUserId }) {
  const normalizedUsername = typeof username === "string" ? username.trim().toLowerCase() : "";
  if (!normalizedUsername) {
    throw new AppError("username e obbligatorio", 400, [{
      field: "username",
      code: "REQUIRED",
      message: "Inserire lo username esatto dell'utente",
    }]);
  }
  const target = await User.findOne({ username: normalizedUsername, status: "active" }).select("_id");
  if (!target) throw new AppError("Utente destinatario non trovato o non attivo", 404);
  return assignOrganizationRole({ organizationId, targetUserId: target._id, role, actorUserId });
}

async function removeOrganizationMember({ organizationId, targetUserId, actorUserId }) {
  await assertOrganizationRole({ userId: actorUserId, organizationId, minimumRole: "manager" });
  const organization = await findOrganizationOrFail({ organizationId });
  const target = await User.findOne({ _id: targetUserId, status: "active" });
  if (!target) throw new AppError("Utente destinatario non trovato o non attivo", 404);
  const membership = (target.organizationMemberships || []).find(
    (entry) => String(entry.organizationId) === String(organizationId),
  );
  if (!membership) throw new AppError("L'utente non appartiene all'organizzazione", 404);
  if (String(target._id) === String(organization.createdBy)) {
    throw new AppError("Il creatore dell'organizzazione non puo essere rimosso", 409);
  }
  if (membership.role === "manager") {
    throw new AppError("Un manager deve prima essere retrocesso dal creatore dell'organizzazione", 409);
  }
  target.organizationMemberships = target.organizationMemberships.filter(
    (entry) => String(entry.organizationId) !== String(organizationId),
  );
  await target.save();
  return { userId: target._id, organizationId, removedRole: membership.role };
}

async function listOrganizations() {
  return Organization.find({ lifecycleStatus: "active" }).sort({ name: 1 });
}

async function getOrganizationById({ organizationId }) {
  return findOrganizationOrFail({ organizationId });
}

module.exports = {
  createOrganization,
  updateOrganization,
  assignOrganizationRole,
  assignOrganizationRoleByUsername,
  removeOrganizationMember,
  listOrganizations,
  getOrganizationById,
};
