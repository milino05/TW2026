const { pushError } = require("./validation.utils");
const { validateRepresentations, validateRelations } = require("./item.validation");

async function computeItemIntegrityIssues({ item, revision, museumId, vocabulary }) {
  const errors = [];
  if (!item || String(item.museumId) !== String(museumId)) {
    pushError(errors, "itemId", "ITEM_MUSEUM_MISMATCH", "L'item non appartiene al museo");
    return errors;
  }
  if (item.lifecycleStatus === "trashed") {
    pushError(errors, "lifecycleStatus", "ITEM_TRASHED", "Un item nel cestino non puo essere pubblicato");
  }
  if (!vocabulary.itemTypes.includes(item.itemType)) {
    pushError(errors, "itemType", "INVALID_CONTROLLED_VALUE", "itemType non presente nel vocabolario", { allowedValues: vocabulary.itemTypes });
  }
  if (!revision?.label) pushError(errors, "label", "REQUIRED", "label e obbligatoria");
  if (!revision?.metadata?.license) pushError(errors, "metadata.license", "REQUIRED", "La licenza e obbligatoria per pubblicare");
  if (!Array.isArray(revision?.representations) || revision.representations.length === 0) {
    pushError(errors, "representations", "EMPTY_ARRAY", "Almeno una representation e obbligatoria");
  } else {
    validateRepresentations(revision.representations, vocabulary, errors, { requireDefault: true });
  }
  await validateRelations({
    museumId,
    itemType: item.itemType,
    itemId: item._id,
    relations: revision?.relations || [],
    vocabulary,
    errors,
    requirePublishedTargets: true,
  });
  return errors;
}

module.exports = { computeItemIntegrityIssues };
