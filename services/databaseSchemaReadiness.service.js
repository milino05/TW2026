const mongoose = require("mongoose");

const VENUE_TARGET_COLLECTION = "venuetargets";
const PUBLIC_CODE_INDEX_NAME = "publicCode_1";

function isPublicCodeIndex(index) {
  const keys = Object.keys(index?.key || {});
  return keys.length === 1 && index.key.publicCode === 1;
}

function isExpectedPublicCodeIndex(index) {
  return isPublicCodeIndex(index)
    && index.name === PUBLIC_CODE_INDEX_NAME
    && index.unique === true
    && index.partialFilterExpression?.publicCode?.$type === "string";
}

async function ensureVenueTargetPublicCodeIndex() {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Connessione MongoDB non inizializzata");

  const exists = await db.listCollections({ name: VENUE_TARGET_COLLECTION }, { nameOnly: true }).hasNext();
  if (!exists) return { changed: false, reason: "collection_missing" };

  const collection = db.collection(VENUE_TARGET_COLLECTION);
  const indexes = await collection.indexes();
  const publicCodeIndexes = indexes.filter(isPublicCodeIndex);
  if (publicCodeIndexes.length === 1 && isExpectedPublicCodeIndex(publicCodeIndexes[0])) {
    return { changed: false, reason: "already_aligned" };
  }

  for (const index of publicCodeIndexes) await collection.dropIndex(index.name);
  await collection.createIndex(
    { publicCode: 1 },
    {
      unique: true,
      partialFilterExpression: { publicCode: { $type: "string" } },
      name: PUBLIC_CODE_INDEX_NAME,
    },
  );

  return {
    changed: true,
    droppedIndexes: publicCodeIndexes.map((index) => index.name),
    createdIndex: PUBLIC_CODE_INDEX_NAME,
  };
}

async function ensureDatabaseSchemaReadiness() {
  return {
    venueTargetPublicCodeIndex: await ensureVenueTargetPublicCodeIndex(),
  };
}

module.exports = {
  ensureDatabaseSchemaReadiness,
  ensureVenueTargetPublicCodeIndex,
  isExpectedPublicCodeIndex,
};
