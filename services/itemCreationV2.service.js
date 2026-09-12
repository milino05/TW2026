const AppError = require("../utils/AppError");
const { assertCanActForOwner } = require("./resourceOwnership.service");
const { validateCreateItemPayload } = require("./validation/itemV2.validation");
const instantiation = require("./itemInstantiationV2.service");
const {
  findOwnedItemReuseCandidates,
  reuseConflictCandidates,
} = require("./itemReuseV2.service");

const CREATION_MODES = Object.freeze(["reuse_first", "distinct_lineage"]);

async function createItem({ payload, actorUserId }) {
  const source = payload || {};
  const creationMode = source.creationMode || "reuse_first";
  if (!CREATION_MODES.includes(creationMode)) {
    throw new AppError("Modalità di creazione non valida", 400, [{
      field: "creationMode",
      code: "INVALID_ENUM",
      allowedValues: CREATION_MODES,
    }]);
  }

  const cleanPayload = { ...source };
  delete cleanPayload.creationMode;
  const issues = validateCreateItemPayload(cleanPayload);
  if (issues.length) throw new AppError("Payload non valido", 400, issues);

  await assertCanActForOwner({
    actorUserId,
    ownerType: cleanPayload.ownerType,
    ownerId: cleanPayload.ownerId,
    permissionCode: "item.create",
  });

  if (creationMode === "reuse_first") {
    const { candidates } = await findOwnedItemReuseCandidates({
      ownerType: cleanPayload.ownerType,
      ownerId: cleanPayload.ownerId,
      subjectId: cleanPayload.primarySubjectId,
      contentSpaceId: cleanPayload.contentSpaceId,
    });
    if (candidates.length) {
      throw new AppError(
        "Esiste già un contenuto riutilizzabile o potenzialmente corrispondente. Aprilo o riutilizzalo; crea un contenuto indipendente solo se vuoi davvero una seconda lineage.",
        409,
        [{
          field: "primarySubjectId",
          code: "ITEM_REUSE_AVAILABLE",
          context: { candidates: reuseConflictCandidates(candidates) },
        }],
      );
    }
  }

  return instantiation.createItem({ payload: cleanPayload, actorUserId });
}

module.exports = { createItem, CREATION_MODES };
