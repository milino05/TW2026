const ItemV2 = require("../models/itemV2.model");
const ItemEdition = require("../models/itemEdition.model");
const AppError = require("../utils/AppError");
const { assertCapabilitySource, resolveCapabilitySource } = require("./capabilityAuthorization.service");

function sameId(left, right) { return String(left || "") === String(right || ""); }

async function loadItemEditionAuthority({ itemEditionId }) {
  const edition = await ItemEdition.findById(itemEditionId);
  if (!edition) throw new AppError("ItemEdition non trovata", 404);
  const item = await ItemV2.findById(edition.itemId);
  if (!item) throw new AppError("Item della Edition non disponibile", 409);
  return { edition, item };
}

async function assertCanUseItemEdition({ itemEditionId, actorUserId, capability = "content.consume", principalType = null, principalId = null }) {
  const { edition, item } = await loadItemEditionAuthority({ itemEditionId });
  const access = await assertCapabilitySource({
    actorUserId,
    capability,
    resourceType: "item_edition",
    resourceId: edition._id,
    principalType,
    principalId,
  });
  if (item.lifecycleStatus !== "active" && access.basis !== "entitlement") {
    throw new AppError("Item della Edition non disponibile", 409);
  }
  return { edition, item, access };
}

async function assertCanUseItemEditionForEditorialRelease({ itemEditionId, actorUserId, principalType = null, principalId = null }) {
  return assertCanUseItemEdition({
    itemEditionId,
    actorUserId,
    capability: "content.use_in_editorial_release",
    principalType,
    principalId,
  });
}

async function assertCanReferenceItemInEditorialSpace({ itemId, actorUserId, principalType, principalId }) {
  const item = await ItemV2.findOne({ _id: itemId, lifecycleStatus: "active" });
  if (!item) throw new AppError("Item non trovato", 404);
  if (item.ownerType === principalType && sameId(item.ownerId, principalId)) {
    return { item, access: { allowed: true, basis: item.ownerType === "user" ? "ownership" : "principal_authority", principal: { type: principalType, id: principalId } }, itemEditionId: null };
  }

  const editions = await ItemEdition.find({ itemId: item._id }).select("_id").sort({ updatedAt: -1, _id: -1 }).lean();
  for (const edition of editions) {
    const access = await resolveCapabilitySource({
      actorUserId,
      capability: "content.use_in_editorial_release",
      resourceType: "item_edition",
      resourceId: edition._id,
      principalType,
      principalId,
    });
    if (access.allowed) return { item, access, itemEditionId: edition._id };
  }
  throw new AppError("Questo contenuto non è utilizzabile dall'area di lavoro selezionata", 403, [{
    code: "CONTENT_USE_IN_EDITORIAL_RELEASE_REQUIRED",
    itemId: item._id,
  }]);
}

async function assertCanForkItemEdition({ itemEditionId, actorUserId, principalType = null, principalId = null }) {
  return assertCanUseItemEdition({
    itemEditionId,
    actorUserId,
    capability: "content.fork",
    principalType,
    principalId,
  });
}

module.exports = {
  loadItemEditionAuthority,
  assertCanUseItemEdition,
  assertCanUseItemEditionForEditorialRelease,
  assertCanReferenceItemInEditorialSpace,
  assertCanForkItemEdition,
};
