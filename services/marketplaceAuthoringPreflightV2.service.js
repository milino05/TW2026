const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const Entitlement = require("../models/entitlement.model");
const { resolveSelectedPrincipal } = require("./marketplaceWorkspaceV2.service");
const { getNamespaceAuthoringControls } = require("./namespaceAuthoringV2.service");

function id(value) { return String(value?._id || value || ""); }

function creationCapabilities(principal) {
  if (principal.type === "user") return { contentCreate: true, visitCreate: true, venueObjectContentCreate: true };
  const permissions = new Set(principal.effectivePermissions || []);
  return {
    contentCreate: permissions.has("item.create"),
    visitCreate: permissions.has("visit.create"),
    venueObjectContentCreate: permissions.has("item.create") && permissions.has("venue.view"),
  };
}

function publicPrincipal(principal) {
  const { effectivePermissions, ...projected } = principal;
  return projected;
}

function activeEntitlementMatch(principal, now = new Date()) {
  return {
    beneficiaryType: principal.type,
    beneficiaryId: principal.id,
    capability: "namespace.author",
    status: "active",
    validFrom: { $lte: now },
    $or: [{ validUntil: null }, { validUntil: { $gt: now } }],
  };
}

async function namespaceCandidates(principal) {
  const [owned, entitlements] = await Promise.all([
    Namespace.find({ ownerType: principal.type, ownerId: principal.id, lifecycleStatus: "active" })
      .select("name description workingRevisionId publishedRevisionId")
      .sort({ name: 1 })
      .lean(),
    Entitlement.find({
      ...activeEntitlementMatch(principal),
      resourceType: { $in: ["namespace", "namespace_revision"] },
    }).select("resourceType resourceId").lean(),
  ]);

  const directNamespaceIds = entitlements
    .filter((entry) => entry.resourceType === "namespace")
    .map((entry) => entry.resourceId);
  const revisionIds = entitlements
    .filter((entry) => entry.resourceType === "namespace_revision")
    .map((entry) => entry.resourceId);
  const revisions = revisionIds.length
    ? await NamespaceRevision.find({ _id: { $in: revisionIds } }).select("namespaceId").lean()
    : [];
  const licensedNamespaceIds = [...directNamespaceIds, ...revisions.map((entry) => entry.namespaceId)];
  const licensed = licensedNamespaceIds.length
    ? await Namespace.find({ _id: { $in: licensedNamespaceIds }, lifecycleStatus: "active" }).select("name description").sort({ name: 1 }).lean()
    : [];

  const byId = new Map();
  for (const namespace of owned) byId.set(id(namespace), { namespace, source: "owned" });
  for (const namespace of licensed) {
    if (!byId.has(id(namespace))) byId.set(id(namespace), { namespace, source: "licensed" });
  }
  return [...byId.values()];
}

async function inspectNamespaces({ candidates, actorUserId, principal }) {
  const usable = [];
  const needsConfiguration = [];
  const unavailableLicensed = [];
  for (const candidate of candidates) {
    try {
      const controls = await getNamespaceAuthoringControls({
        namespaceId: candidate.namespace._id,
        actorUserId,
        principalType: principal.type,
        principalId: principal.id,
      });
      const durationCount = controls.controls.durationTypes.length;
      const languageLevelCount = controls.controls.languageLevels.length;
      const summary = {
        id: candidate.namespace._id,
        name: candidate.namespace.name,
        source: candidate.source,
        revisionId: controls.revision.id,
        durationTypeCount: durationCount,
        languageLevelCount,
      };
      if (durationCount > 0 && languageLevelCount > 0) usable.push(summary);
      else if (candidate.source === "owned") needsConfiguration.push(summary);
      else unavailableLicensed.push(summary);
    } catch (error) {
      if (![403, 404, 409].includes(error?.status)) throw error;
    }
  }
  return { usable, needsConfiguration, unavailableLicensed };
}

async function getMarketplaceAuthoringPreflight({
  actorUserId,
  principalType = "user",
  principalId = actorUserId,
}) {
  const { selected } = await resolveSelectedPrincipal({ actorUserId, principalType, principalId });
  const capabilities = creationCapabilities(selected);
  const candidates = capabilities.contentCreate ? await namespaceCandidates(selected) : [];
  const { usable, needsConfiguration, unavailableLicensed } = await inspectNamespaces({ candidates, actorUserId, principal: selected });
  const allowed = capabilities.contentCreate && usable.length > 0;
  const blockers = [];
  if (!capabilities.contentCreate) {
    blockers.push({
      code: "ITEM_CREATE_PERMISSION_REQUIRED",
      message: "Il tuo ruolo non consente di creare contenuti in questa organizzazione.",
    });
  } else if (!allowed && needsConfiguration.length) {
    blockers.push({
      code: "NAMESPACE_CONTROLS_REQUIRED",
      message: "Le tue regole editoriali devono definire almeno una durata e un livello di linguaggio prima di creare un contenuto.",
    });
  } else if (!allowed) {
    blockers.push({
      code: "NAMESPACE_REQUIRED",
      message: "Prima di creare un contenuto serve almeno un insieme di regole editoriali utilizzabile.",
    });
  }

  return {
    principal: publicPrincipal(selected),
    capabilities,
    content: {
      allowed,
      usableNamespaceCount: usable.length,
      usableNamespaces: usable,
      needsConfigurationCount: needsConfiguration.length,
      needsConfiguration,
      unavailableLicensedCount: unavailableLicensed.length,
      blockers,
    },
    visit: {
      allowed: capabilities.visitCreate,
      blockers: capabilities.visitCreate ? [] : [{ code: "VISIT_CREATE_PERMISSION_REQUIRED", message: "Il tuo ruolo non consente di creare visite in questa organizzazione." }],
    },
  };
}

module.exports = { getMarketplaceAuthoringPreflight };
