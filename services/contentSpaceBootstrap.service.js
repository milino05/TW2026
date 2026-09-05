const ContentSpace = require("../models/contentSpace.model");
const AppError = require("../utils/AppError");

function normalizeOwnerType(value) {
  const ownerType = String(value || "").trim();
  if (!["user", "organization"].includes(ownerType)) {
    throw new AppError("Tipo di proprietario dello spazio non valido", 400, [{
      field: "ownerType",
      code: "INVALID_ENUM",
    }]);
  }
  return ownerType;
}

function initialContentSpaceName({ ownerType, principalLabel }) {
  const label = String(principalLabel || "").trim();
  if (!label) {
    throw new AppError("Nome del proprietario dello spazio non disponibile", 400, [{
      field: "principalLabel",
      code: "REQUIRED",
    }]);
  }
  return ownerType === "organization"
    ? `Spazio editoriale di ${label}`
    : `Spazio personale di ${label}`;
}

async function ensurePrincipalContentSpace({
  ownerType,
  ownerId,
  principalLabel,
  actorUserId,
  session = null,
}) {
  const normalizedOwnerType = normalizeOwnerType(ownerType);
  const query = ContentSpace.findOne({
    ownerType: normalizedOwnerType,
    ownerId,
    lifecycleStatus: "active",
  }).sort({ createdAt: 1, _id: 1 });
  if (session) query.session(session);
  const existing = await query;
  if (existing) return { contentSpace: existing, created: false };

  const [contentSpace] = await ContentSpace.create([{
    name: initialContentSpaceName({ ownerType: normalizedOwnerType, principalLabel }),
    ownerType: normalizedOwnerType,
    ownerId,
    createdBy: actorUserId,
  }], { session });

  return { contentSpace, created: true };
}

module.exports = {
  initialContentSpaceName,
  ensurePrincipalContentSpace,
};
