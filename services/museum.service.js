const Museum = require("../models/museum.model");
const Item = require("../models/item.model");
const Visit = require("../models/visit");
const User = require("../models/user");
const AppError = require("../utils/AppError");
const { assertMuseumRole, getActiveUserOrFail } = require("./museumAuthorization.service");
const { normalizeMuseumPayload, validateMuseumPayload } = require("./validation/museum.validation");

async function findMuseumByIdOrFail({ museumId }) {
  const museum = await Museum.findById(museumId);
  if (!museum) throw new AppError("Museo non trovato", 404);
  return museum;
}

async function createMuseum({ payload, actorUserId }) {
  const creator = await getActiveUserOrFail(actorUserId);
  const normalized = normalizeMuseumPayload(payload);
  const errors = validateMuseumPayload({ payload: normalized, rawPayload: payload });
  if (errors.length) throw new AppError("Payload non valido", 400, errors);

  const museum = new Museum({ name: normalized.name, createdBy: creator._id });
  await museum.save();
  try {
    creator.memberships.push({
      museumId: museum._id,
      role: "manager",
      assignedBy: creator._id,
      assignedAt: new Date(),
    });
    await creator.save();
  } catch (error) {
    await museum.deleteOne().catch(() => {});
    throw error;
  }
  return museum;
}

async function updateMuseum({ museumId, payload, actorUserId }) {
  await assertMuseumRole({ userId: actorUserId, museumId, minimumRole: "manager" });
  const museum = await findMuseumByIdOrFail({ museumId });
  const normalized = normalizeMuseumPayload(payload);
  const effective = { name: Object.prototype.hasOwnProperty.call(payload || {}, "name") ? normalized.name : museum.name };
  const errors = validateMuseumPayload({ payload: effective, rawPayload: payload });
  if (errors.length) throw new AppError("Payload non valido", 400, errors);
  museum.name = effective.name;
  await museum.save();
  return { museum };
}

async function assignMuseumRole({ museumId, targetUserId, role, actorUserId }) {
  await assertMuseumRole({ userId: actorUserId, museumId, minimumRole: "manager" });
  const museum = await findMuseumByIdOrFail({ museumId });
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
  const membership = (target.memberships || []).find((entry) => String(entry.museumId) === String(museumId));
  if (String(target._id) === String(museum.createdBy) && role !== "manager") throw new AppError("Il creatore del museo deve rimanere manager", 409);
  if (membership?.role === "manager" && role === "operator" && String(actorUserId) !== String(museum.createdBy)) throw new AppError("Solo il creatore del museo puo retrocedere un manager", 403);
  if (!membership && role === "manager") throw new AppError("Un utente deve prima essere assegnato come operator prima di essere promosso a manager", 409);
  if (membership) {
    membership.role = role;
    membership.assignedBy = actorUserId;
    membership.assignedAt = new Date();
  } else {
    target.memberships.push({ museumId, role, assignedBy: actorUserId, assignedAt: new Date() });
  }
  await target.save();
  return { userId: target._id, username: target.username, museumId, role };
}

async function assignMuseumRoleByUsername({ museumId, username, role, actorUserId }) {
  const normalizedUsername = typeof username === "string" ? username.trim().toLowerCase() : "";
  if (!normalizedUsername) throw new AppError("username e obbligatorio", 400, [{ field: "username", code: "REQUIRED", message: "Inserire lo username esatto dell'utente" }]);
  const target = await User.findOne({ username: normalizedUsername, status: "active" }).select("_id");
  if (!target) throw new AppError("Utente destinatario non trovato o non attivo", 404);
  return assignMuseumRole({ museumId, targetUserId: target._id, role, actorUserId });
}

async function removeMuseumMember({ museumId, targetUserId, actorUserId }) {
  await assertMuseumRole({ userId: actorUserId, museumId, minimumRole: "manager" });
  const museum = await findMuseumByIdOrFail({ museumId });
  const target = await User.findOne({ _id: targetUserId, status: "active" });
  if (!target) throw new AppError("Utente destinatario non trovato o non attivo", 404);
  const membership = (target.memberships || []).find((entry) => String(entry.museumId) === String(museumId));
  if (!membership) throw new AppError("L'utente non appartiene al museo", 404);
  if (String(target._id) === String(museum.createdBy)) throw new AppError("Il creatore del museo non puo essere rimosso", 409);
  if (membership.role === "manager") throw new AppError("Un manager deve prima essere retrocesso dal creatore del museo", 409);
  target.memberships = target.memberships.filter((entry) => String(entry.museumId) !== String(museumId));
  await target.save();
  return { userId: target._id, museumId, removedRole: "operator" };
}

async function listMuseums() { return Museum.find().sort({ name: 1 }); }
async function getMuseumById({ museumId }) { return findMuseumByIdOrFail({ museumId }); }
async function deleteMuseum({ museumId, actorUserId }) {
  await assertMuseumRole({ userId: actorUserId, museumId, minimumRole: "manager" });
  const museum = await findMuseumByIdOrFail({ museumId });
  const [hasItems, hasVisits] = await Promise.all([
    Item.exists({ museumId }),
    Visit.exists({ ownerMuseumId: museumId }),
  ]);
  if (hasItems || hasVisits) throw new AppError("Impossibile eliminare il museo: esistono item o visite ufficiali associati", 409);
  await museum.deleteOne();
  await User.updateMany({ "memberships.museumId": museumId }, { $pull: { memberships: { museumId } } });
  return museum;
}

module.exports = {
  createMuseum,
  updateMuseum,
  assignMuseumRole,
  assignMuseumRoleByUsername,
  removeMuseumMember,
  listMuseums,
  getMuseumById,
  deleteMuseum,
};
