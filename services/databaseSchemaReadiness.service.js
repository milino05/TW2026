const mongoose = require("mongoose");

const VENUE_TARGET_COLLECTION = "venuetargets";
const PUBLIC_CODE_INDEX_NAME = "publicCode_1";
const SESSION_PLAN_COLLECTION = "session_plan_revisions_v2";
const SESSION_PLAN_VERSION_INDEX = "planOwnerType_1_planOwnerId_1_version_1";
const SESSION_PLAN_STATUS_INDEX = "planOwnerType_1_planOwnerId_1_status_1";
const SEMANTIC_GRAPH_REVISION_COLLECTION = "semantic_graph_revisions_v2";
const SEMANTIC_GRAPH_VERSION_INDEX = "semanticGraphId_1_version_1";
const SEMANTIC_GRAPH_CREATED_AT_INDEX = "semanticGraphId_1_createdAt_-1";

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

function usesLegacySessionPlanOwner(index) {
  return Object.prototype.hasOwnProperty.call(index?.key || {}, "sessionId");
}

function hasIndex(indexes, expectedKey, { unique = false } = {}) {
  return indexes.some((index) => {
    const entries = Object.entries(index.key || {});
    const expectedEntries = Object.entries(expectedKey);
    return entries.length === expectedEntries.length
      && entries.every(([key, value], position) => key === expectedEntries[position][0] && value === expectedEntries[position][1])
      && Boolean(index.unique) === unique;
  });
}

async function ensureSessionPlanOwnerShape() {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Connessione MongoDB non inizializzata");
  const exists = await db.listCollections({ name: SESSION_PLAN_COLLECTION }, { nameOnly: true }).hasNext();
  if (!exists) return { changed: false, reason: "collection_missing", migratedDocuments: 0 };

  const collection = db.collection(SESSION_PLAN_COLLECTION);
  let indexes = await collection.indexes();
  const legacyIndexes = indexes.filter(usesLegacySessionPlanOwner);
  // Il vecchio indice univoco (sessionId, version) va rimosso prima di togliere
  // sessionId dai documenti: altrimenti più piani v1 colliderebbero su null.
  for (const index of legacyIndexes) await collection.dropIndex(index.name);

  const invalidDocuments = await collection.countDocuments({
    planOwnerType: { $exists: false },
    $or: [
      { sessionId: { $exists: false } },
      { sessionId: { $not: { $type: "objectId" } } },
    ],
  });
  if (invalidDocuments) {
    throw new Error(`${invalidDocuments} SessionPlan non hanno un owner legacy migrabile`);
  }

  const migrated = await collection.updateMany(
    { planOwnerType: { $exists: false }, sessionId: { $type: "objectId" } },
    [
      { $set: { planOwnerType: "visit_session", planOwnerId: "$sessionId" } },
      { $unset: "sessionId" },
    ],
  );
  const cleaned = await collection.updateMany(
    { planOwnerType: { $exists: true }, sessionId: { $exists: true } },
    { $unset: { sessionId: "" } },
  );

  indexes = await collection.indexes();
  const versionKey = { planOwnerType: 1, planOwnerId: 1, version: 1 };
  const statusKey = { planOwnerType: 1, planOwnerId: 1, status: 1 };
  if (!hasIndex(indexes, versionKey, { unique: true })) {
    for (const index of indexes.filter((entry) => hasIndex([entry], versionKey, { unique: false }))) await collection.dropIndex(index.name);
    await collection.createIndex(versionKey, { unique: true, name: SESSION_PLAN_VERSION_INDEX });
  }
  indexes = await collection.indexes();
  if (!hasIndex(indexes, statusKey)) {
    await collection.createIndex(statusKey, { name: SESSION_PLAN_STATUS_INDEX });
  }

  return {
    changed: Boolean(legacyIndexes.length || migrated.modifiedCount || cleaned.modifiedCount),
    migratedDocuments: migrated.modifiedCount,
    cleanedDocuments: cleaned.modifiedCount,
    droppedIndexes: legacyIndexes.map((index) => index.name),
  };
}

function usesLegacyEditorialContextIndex(index) {
  return Object.prototype.hasOwnProperty.call(index?.key || {}, "editorialContextId");
}

function editorialInventoryMigrationRequired(legacyDocuments) {
  const error = new Error(
    `Schema editoriale legacy rilevato (${legacyDocuments} revisioni del grafo da migrare). `
    + "Esegui npm run migrate:editorial-inventory; con Docker esegui docker compose exec backend npm run migrate:editorial-inventory dalla root di TW2026, quindi riavvia il backend.",
  );
  error.code = "EDITORIAL_INVENTORY_MIGRATION_REQUIRED";
  error.legacyDocuments = legacyDocuments;
  return error;
}

async function ensureSemanticGraphRevisionIndexes() {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Connessione MongoDB non inizializzata");
  const exists = await db.listCollections({ name: SEMANTIC_GRAPH_REVISION_COLLECTION }, { nameOnly: true }).hasNext();
  if (!exists) return { changed: false, reason: "collection_missing", legacyDocuments: 0 };

  const collection = db.collection(SEMANTIC_GRAPH_REVISION_COLLECTION);
  const legacyDocuments = await collection.countDocuments({
    semanticGraphId: { $exists: false },
    editorialContextId: { $exists: true },
  });
  if (legacyDocuments) throw editorialInventoryMigrationRequired(legacyDocuments);

  let indexes = await collection.indexes();
  const legacyIndexes = indexes.filter(usesLegacyEditorialContextIndex);
  for (const index of legacyIndexes) await collection.dropIndex(index.name);

  const versionKey = { semanticGraphId: 1, version: 1 };
  const createdAtKey = { semanticGraphId: 1, createdAt: -1 };
  let createdVersionIndex = false;
  let createdCreatedAtIndex = false;

  indexes = await collection.indexes();
  if (!hasIndex(indexes, versionKey, { unique: true })) {
    for (const index of indexes.filter((entry) => (
      entry.name === SEMANTIC_GRAPH_VERSION_INDEX || hasIndex([entry], versionKey, { unique: false })
    ))) await collection.dropIndex(index.name);
    await collection.createIndex(versionKey, { unique: true, name: SEMANTIC_GRAPH_VERSION_INDEX });
    createdVersionIndex = true;
  }

  indexes = await collection.indexes();
  if (!hasIndex(indexes, createdAtKey)) {
    for (const index of indexes.filter((entry) => entry.name === SEMANTIC_GRAPH_CREATED_AT_INDEX)) await collection.dropIndex(index.name);
    await collection.createIndex(createdAtKey, { name: SEMANTIC_GRAPH_CREATED_AT_INDEX });
    createdCreatedAtIndex = true;
  }

  return {
    changed: Boolean(legacyIndexes.length || createdVersionIndex || createdCreatedAtIndex),
    legacyDocuments: 0,
    droppedIndexes: legacyIndexes.map((index) => index.name),
    createdIndexes: [
      ...(createdVersionIndex ? [SEMANTIC_GRAPH_VERSION_INDEX] : []),
      ...(createdCreatedAtIndex ? [SEMANTIC_GRAPH_CREATED_AT_INDEX] : []),
    ],
  };
}

async function ensureDatabaseSchemaReadiness() {
  return {
    venueTargetPublicCodeIndex: await ensureVenueTargetPublicCodeIndex(),
    sessionPlanOwnerShape: await ensureSessionPlanOwnerShape(),
    semanticGraphRevisionIndexes: await ensureSemanticGraphRevisionIndexes(),
  };
}

module.exports = {
  ensureDatabaseSchemaReadiness,
  ensureVenueTargetPublicCodeIndex,
  ensureSessionPlanOwnerShape,
  ensureSemanticGraphRevisionIndexes,
  isExpectedPublicCodeIndex,
};
