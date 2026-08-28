const ItemV2 = require("../models/itemV2.model");
const ItemEdition = require("../models/itemEdition.model");
const AppError = require("../utils/AppError");
const { assertCapabilitySource } = require("./capabilityAuthorization.service");

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
  assertCanForkItemEdition,
};
