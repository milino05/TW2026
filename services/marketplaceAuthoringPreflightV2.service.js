const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const Entitlement = require("../models/entitlement.model");
const { resolveSelectedPrincipal } = require("./marketplaceWorkspaceV2.service");
const { getNamespaceAuthoringControls } = require("./namespaceAuthoringV2.service");

function id(value) { return String(value?._id || value || ""); }

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
  const candidates = await namespaceCandidates(selected);
  const { usable, needsConfiguration, unavailableLicensed } = await inspectNamespaces({ candidates, actorUserId, principal: selected });
  const allowed = usable.length > 0;
  const blockers = [];
  if (!allowed && needsConfiguration.length) {
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
    principal: selected,
    content: {
      allowed,
      usableNamespaceCount: usable.length,
      usableNamespaces: usable,
      needsConfigurationCount: needsConfiguration.length,
      needsConfiguration,
      unavailableLicensedCount: unavailableLicensed.length,
      blockers,
    },
    visit: { allowed: true, blockers: [] },
  };
}

module.exports = { getMarketplaceAuthoringPreflight };