const AppError = require("../utils/AppError");

function id(value) { return String(value?._id || value || ""); }

function sameDeliveryGroup(left, right) {
  return id(left?.deliveryAnchorId) === id(right?.deliveryAnchorId);
}

function canonicalizeContentEntries(entries = [], anchors = []) {
  const anchorIds = anchors.map((anchor) => id(anchor._id)).filter(Boolean);
  const known = new Set(anchorIds);
  const ordered = [];
  for (const anchorId of anchorIds) {
    ordered.push(...entries.filter((entry) => id(entry.deliveryAnchorId) === anchorId));
  }
  ordered.push(...entries.filter((entry) => !entry.deliveryAnchorId));
  ordered.push(...entries.filter((entry) => entry.deliveryAnchorId && !known.has(id(entry.deliveryAnchorId))));
  return ordered;
}

function reorderWithinDeliveryGroup(entries, contentEntryId, toIndex) {
  const next = entries.map((entry) => ({ ...entry }));
  const entryIndex = next.findIndex((entry) => id(entry._id) === id(contentEntryId));
  if (entryIndex < 0) throw new AppError("ContentEntry non trovata", 404);

  const selected = next[entryIndex];
  const siblingSlots = [];
  for (let index = 0; index < next.length; index += 1) {
    if (sameDeliveryGroup(next[index], selected)) siblingSlots.push(index);
  }
  const fromIndex = siblingSlots.indexOf(entryIndex);
  const destination = Number(toIndex);
  if (!Number.isInteger(destination) || destination < 0 || destination >= siblingSlots.length) {
    throw new AppError("Posizione del contenuto non valida", 400, [{
      field: "toIndex",
      code: "OUT_OF_RANGE",
      context: { minimum: 0, maximum: Math.max(0, siblingSlots.length - 1) },
    }]);
  }
  if (destination === fromIndex) return { entries: next, selected, fromIndex, toIndex: destination, changed: false };

  const siblings = siblingSlots.map((slot) => next[slot]);
  const [moved] = siblings.splice(fromIndex, 1);
  siblings.splice(destination, 0, moved);
  siblingSlots.forEach((slot, index) => { next[slot] = siblings[index]; });
  return { entries: next, selected, fromIndex, toIndex: destination, changed: true };
}

module.exports = { canonicalizeContentEntries, reorderWithinDeliveryGroup, sameDeliveryGroup };
