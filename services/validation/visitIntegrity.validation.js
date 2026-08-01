const Item = require("../../models/item.model");
const Museum = require("../../models/museum.model");
const User = require("../../models/user");

function issue(code, field, message, context) {
  return { code, field, message, ...(context ? { context } : {}) };
}

function sameId(a, b) {
  return String(a) === String(b);
}

async function computeVisitIntegrity({ visit }) {
  const issues = [];
  const creatorExists = visit.createdBy ? await User.exists({ _id: visit.createdBy }) : false;

  if (!creatorExists) {
    issues.push(issue("CREATOR_NOT_FOUND", "createdBy", "L'utente creatore non esiste"));
  }

  if (visit.kind === "official") {
    if (!visit.ownerMuseumId) {
      issues.push(issue("OWNER_MUSEUM_REQUIRED", "ownerMuseumId", "Una visita ufficiale deve avere un museo proprietario"));
    } else if (!(await Museum.exists({ _id: visit.ownerMuseumId }))) {
      issues.push(issue("OWNER_MUSEUM_NOT_FOUND", "ownerMuseumId", "Il museo proprietario non esiste"));
    }
  }

  if (visit.kind === "community" && visit.ownerMuseumId) {
    issues.push(issue("OWNER_MUSEUM_NOT_ALLOWED", "ownerMuseumId", "Una visita community non puo avere un museo proprietario"));
  }

  const policy = visit.defaultPresentationPolicy;
  if (!policy?.durationKey || !policy?.languageLevelKey) {
    issues.push(issue("DEFAULT_POLICY_REQUIRED", "defaultPresentationPolicy", "La policy di presentazione predefinita e obbligatoria"));
  }

  const stopItemIds = (visit.stops || []).map((stop) => stop.itemId).filter(Boolean);
  if (stopItemIds.length === 0) {
    issues.push(issue("EMPTY_VISIT", "stops", "La visita deve contenere almeno una tappa"));
  }

  const items = stopItemIds.length
    ? await Item.find({ _id: { $in: stopItemIds } })
        .select("_id museumId status integrity.status representations")
        .lean()
    : [];

  const itemsById = new Map(items.map((item) => [String(item._id), item]));
  const museumIds = new Set();

  stopItemIds.forEach((itemId, index) => {
    const item = itemsById.get(String(itemId));

    if (!item) {
      issues.push(issue("ITEM_NOT_FOUND", `stops[${index}].itemId`, "L'item della tappa non esiste", { itemId }));
      return;
    }

    museumIds.add(String(item.museumId));

    if (visit.kind === "official" && !sameId(item.museumId, visit.ownerMuseumId)) {
      issues.push(issue("ITEM_FROM_DIFFERENT_MUSEUM", `stops[${index}].itemId`, "Una visita ufficiale puo contenere soltanto item del museo proprietario", {
        itemId: item._id,
        itemMuseumId: item.museumId,
      }));
    }

    if (item.status !== "published") {
      issues.push(issue("ITEM_NOT_PUBLISHED", `stops[${index}].itemId`, "Una visita pubblicata puo contenere soltanto item pubblicati", {
        itemId: item._id,
        itemStatus: item.status,
      }));
    }

    if (item.integrity?.status !== "valid") {
      issues.push(issue("ITEM_NEEDS_REVIEW", `stops[${index}].itemId`, "Una visita pubblicata puo contenere soltanto item integri", {
        itemId: item._id,
        integrityStatus: item.integrity?.status,
      }));
    }

    if (policy?.durationKey && policy?.languageLevelKey) {
      const supportsDefaultPolicy = (item.representations || []).some(
        (representation) =>
          representation.durationKey === policy.durationKey &&
          representation.languageLevelKey === policy.languageLevelKey,
      );

      if (!supportsDefaultPolicy) {
        issues.push(issue("DEFAULT_POLICY_NOT_SUPPORTED", `stops[${index}].itemId`, "L'item non dispone della representation richiesta dalla policy predefinita della visita", {
          itemId: item._id,
          defaultPresentationPolicy: policy,
        }));
      }
    }
  });

  return {
    issues,
    museumIds: Array.from(museumIds),
  };
}

module.exports = {
  computeVisitIntegrity,
};
