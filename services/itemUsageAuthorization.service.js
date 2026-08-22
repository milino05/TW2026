const ItemV2 = require("../models/itemV2.model");
const ItemEdition = require("../models/itemEdition.model");
const AppError = require("../utils/AppError");
const { assertCapabilitySource } = require("./capabilityAuthorization.service");

async function loadItemEditionAuthority({ itemEditionId }) {
  const edition = await ItemEdition.findById(itemEditionId);
  if (!edition) throw new AppError("ItemEdition non trovata", 404);
  const item = await ItemV2.findOne({ _id: edition.itemId, lifecycleStatus: "active" });
  if (!item) throw new AppError("Item della Edition non disponibile", 409);
  return { edition, item };
}

async function assertCanUseItemEdition({ itemEditionId, actorUserId, capability = "content.consume" }) {
  const { edition, item } = await loadItemEditionAuthority({ itemEditionId });
  const access = await assertCapabilitySource({
    actorUserId,
    capability,
    resourceType: "item_edition",
    resourceId: edition._id,
  });
  return { edition, item, access };
}

async function assertCanUseItemEditionForEditorialRelease({ itemEditionId, actorUserId }) {
  return assertCanUseItemEdition({
    itemEditionId,
    actorUserId,
    capability: "content.use_in_editorial_release",
  });
}

async function assertCanForkItemEdition({ itemEditionId, actorUserId }) {
  return assertCanUseItemEdition({
    itemEditionId,
    actorUserId,
    capability: "content.fork",
  });
}

module.exports = {
  loadItemEditionAuthority,
  assertCanUseItemEdition,
  assertCanUseItemEditionForEditorialRelease,
  assertCanForkItemEdition,
};
