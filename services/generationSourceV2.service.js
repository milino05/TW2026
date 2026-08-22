const mongoose = require("mongoose");
const EditorialContext = require("../models/editorialContext.model");
const EditorialRelease = require("../models/editorialRelease.model");
const AppError = require("../utils/AppError");
const { resolveCapabilitySource } = require("./capabilityAuthorization.service");

const GENERATION_SOURCE_TYPES = Object.freeze(["editorial_context", "editorial_release"]);

function id(value) { return String(value?._id || value || ""); }
function refKey(ref) { return `${ref.resourceType}:${id(ref.resourceId)}`; }

function normalizeGenerationSourceRef(source = {}) {
  return {
    resourceType: String(source.resourceType || "").trim().toLowerCase(),
    resourceId: source.resourceId,
  };
}

function validateGenerationSourceRef(source, field = "editorialSources") {
  const issues = [];
  const normalized = normalizeGenerationSourceRef(source);
  if (!GENERATION_SOURCE_TYPES.includes(normalized.resourceType)) {
    issues.push({ field: `${field}.resourceType`, code: "INVALID_ENUM", message: "Generation source deve essere editorial_context oppure editorial_release" });
  }
  if (!mongoose.isValidObjectId(normalized.resourceId)) {
    issues.push({ field: `${field}.resourceId`, code: "INVALID_OBJECT_ID", message: "resourceId della generation source non valido" });
  }
  return { normalized, issues };
}

async function contextForRelease(release) {
  const context = await EditorialContext.findOne({ _id: release.editorialContextId, lifecycleStatus: "active" }).lean();
  if (!context) throw new AppError("EditorialContext della EditorialRelease non disponibile", 409, [{ code: "GENERATION_SOURCE_CONTEXT_UNAVAILABLE" }]);
  return context;
}

async function resolveGenerationSourceRef({ source, actorUserId, allowLiveRefResolvingToPinned = false }) {
  const { normalized, issues } = validateGenerationSourceRef(source, "editorialSources[]");
  if (issues.length) throw new AppError("Generation source non valida", 400, issues);

  if (normalized.resourceType === "editorial_context") {
    const context = await EditorialContext.findOne({ _id: normalized.resourceId, lifecycleStatus: "active" }).lean();
    if (!context) throw new AppError("EditorialContext non disponibile", 404);
    const access = await resolveCapabilitySource({
      actorUserId,
      capability: "context.generate",
      resourceType: "editorial_context",
      resourceId: context._id,
    });
    if (!access.allowed) {
      throw new AppError("context.generate non disponibile per la sorgente", 403, [{
        code: "GENERATION_SOURCE_CAPABILITY_REQUIRED",
        context: { source: normalized },
      }]);
    }
    const snapshotRef = access.resolvedSnapshotRef;
    if (snapshotRef?.resourceType !== "editorial_release" || !snapshotRef.resourceId) {
      throw new AppError("EditorialContext privo di snapshot generabile autorizzata", 409, [{ code: "GENERATION_SOURCE_SNAPSHOT_UNAVAILABLE" }]);
    }
    const pinned = access.entitlement?.versionPolicy === "pinned" || access.entitlement?.resourceType === "editorial_release";
    if (pinned && !allowLiveRefResolvingToPinned) {
      throw new AppError("La sorgente live richiesta e autorizzata soltanto come EditorialRelease pinned", 409, [{
        code: "GENERATION_SOURCE_TYPE_VERSION_MISMATCH",
        context: {
          requestedSource: normalized,
          resolvedSource: { resourceType: "editorial_release", resourceId: snapshotRef.resourceId },
        },
      }]);
    }
    const release = await EditorialRelease.findOne({
      _id: snapshotRef.resourceId,
      editorialContextId: context._id,
      "integrity.status": "valid",
    }).lean();
    if (!release) throw new AppError("EditorialRelease autorizzata non disponibile", 409, [{ code: "GENERATION_SOURCE_RELEASE_UNAVAILABLE" }]);
    return {
      requestedSourceRef: normalized,
      resolvedSourceRef: pinned
        ? { resourceType: "editorial_release", resourceId: release._id }
        : { resourceType: "editorial_context", resourceId: context._id },
      editorialContext: context,
      editorialRelease: release,
      versionMode: pinned ? "pinned" : "follow_current",
      access,
    };
  }

  const release = await EditorialRelease.findOne({
    _id: normalized.resourceId,
    "integrity.status": "valid",
  }).lean();
  if (!release) throw new AppError("EditorialRelease non disponibile", 404);
  const context = await contextForRelease(release);
  const access = await resolveCapabilitySource({
    actorUserId,
    capability: "context.generate",
    resourceType: "editorial_release",
    resourceId: release._id,
  });
  if (!access.allowed) {
    throw new AppError("context.generate non disponibile per la EditorialRelease", 403, [{
      code: "GENERATION_SOURCE_CAPABILITY_REQUIRED",
      context: { source: normalized },
    }]);
  }
  return {
    requestedSourceRef: normalized,
    resolvedSourceRef: { resourceType: "editorial_release", resourceId: release._id },
    editorialContext: context,
    editorialRelease: release,
    versionMode: "pinned",
    access,
  };
}

async function resolveGenerationSources({ sources, actorUserId }) {
  if (!Array.isArray(sources) || !sources.length) {
    throw new AppError("EditorialScope esplicito vuoto", 400, [{ field: "editorialSources", code: "EDITORIAL_SCOPE_EMPTY" }]);
  }
  const resolved = [];
  const seen = new Set();
  for (const source of sources) {
    const entry = await resolveGenerationSourceRef({ source, actorUserId });
    const key = refKey(entry.resolvedSourceRef);
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push(entry);
  }
  return resolved;
}

async function resolvePrimaryDefaultGenerationSources({ venues = [], actorUserId }) {
  const resolved = [];
  const warnings = [];
  const seen = new Set();
  for (const venue of venues) {
    if (!venue.primaryEditorialContextId) {
      warnings.push({ code: "VENUE_WITHOUT_PRIMARY_EDITORIAL_CONTEXT", venueId: venue._id });
      continue;
    }
    try {
      const entry = await resolveGenerationSourceRef({
        source: { resourceType: "editorial_context", resourceId: venue.primaryEditorialContextId },
        actorUserId,
        allowLiveRefResolvingToPinned: true,
      });
      const key = refKey(entry.resolvedSourceRef);
      if (!seen.has(key)) {
        seen.add(key);
        resolved.push(entry);
      }
    } catch (error) {
      if ([403, 404, 409].includes(error?.status)) {
        warnings.push({ code: "PRIMARY_EDITORIAL_CONTEXT_NOT_AUTHORIZED", venueId: venue._id, editorialContextId: venue.primaryEditorialContextId });
        continue;
      }
      throw error;
    }
  }
  if (!resolved.length) {
    throw new AppError("Nessuna sorgente editoriale primaria autorizzata per le Venue selezionate", 409, [{
      code: "AUTHORIZED_PRIMARY_EDITORIAL_SOURCE_MISSING",
    }]);
  }
  return { resolved, warnings };
}

module.exports = {
  GENERATION_SOURCE_TYPES,
  normalizeGenerationSourceRef,
  validateGenerationSourceRef,
  resolveGenerationSourceRef,
  resolveGenerationSources,
  resolvePrimaryDefaultGenerationSources,
};
