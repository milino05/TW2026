const ItemV2 = require("../models/itemV2.model");
const ItemEdition = require("../models/itemEdition.model");
const AppError = require("../utils/AppError");
const { assertCanActForOwner } = require("./resourceOwnership.service");

/**
 * Temporary pre-Marketplace authorization boundary.
 *
 * Marketplace Entitlement will eventually satisfy capabilities such as
 * content.use_in_editorial_release and content.fork. Until then, external use
 * is denied conservatively and requires authority over the Item owner.
 */
async function loadItemEditionAuthority({ itemEditionId }) {
  const edition = await ItemEdition.findById(itemEditionId);
  if (!edition) throw new AppError("ItemEdition non trovata", 404);
  const item = await ItemV2.findOne({ _id: edition.itemId, lifecycleStatus: "active" });
  if (!item) throw new AppError("Item della Edition non disponibile", 409);
  return { edition, item };
}

async function assertCanUseItemEdition({ itemEditionId, actorUserId, minimumOrganizationRole = "operator" }) {
  const { edition, item } = await loadItemEditionAuthority({ itemEditionId });
  await assertCanActForOwner({
    actorUserId,
    ownerType: item.ownerType,
    ownerId: item.ownerId,
    minimumOrganizationRole,
  });
  return { edition, item };
}

async function assertCanUseItemEditionForEditorialRelease({ itemEditionId, actorUserId }) {
  return assertCanUseItemEdition({ itemEditionId, actorUserId });
}

async function assertCanForkItemEdition({ itemEditionId, actorUserId }) {
  return assertCanUseItemEdition({ itemEditionId, actorUserId });
}

module.exports = {
  loadItemEditionAuthority,
  assertCanUseItemEdition,
  assertCanUseItemEditionForEditorialRelease,
  assertCanForkItemEdition,
};
