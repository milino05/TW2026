const ContentSpace = require("../models/contentSpace.model");
const ContentSpaceMembership = require("../models/contentSpaceMembership.model");
const EditorialContext = require("../models/editorialContext.model");
const EditorialRelease = require("../models/editorialRelease.model");
const ItemV2 = require("../models/itemV2.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
const Subject = require("../models/subject.model");
const AppError = require("../utils/AppError");
const { assertCanManageContentSpace } = require("./contentSpace.service");
const { assertCanUseItemEditionForEditorialRelease } = require("./itemUsageAuthorization.service");
const { assertCanUseNamespaceForEditorialContext } = require("./namespaceUsageAuthorization.service");

function id(value) { return String(value?._id || value || ""); }

async function getEditorialReleaseComposer({ editorialContextId, actorUserId }) {
  const context = await EditorialContext.findOne({ _id: editorialContextId, lifecycleStatus: "active" }).lean();
  if (!context) throw new AppError("EditorialContext non disponibile", 404);
  const [contentSpace, namespace] = await Promise.all([
    ContentSpace.findOne({ _id: context.contentSpaceId, lifecycleStatus: "active" }),
    Namespace.findOne({ _id: context.namespaceId, lifecycleStatus: "active" }).lean(),
  ]);
  if (!contentSpace || !namespace) throw new AppError("Dipendenze EditorialContext non disponibili", 409);
  await assertCanManageContentSpace(contentSpace, actorUserId, "manager");

  const namespaceAccess = await assertCanUseNamespaceForEditorialContext({
    namespace,
    actorUserId,
    principalType: contentSpace.ownerType,
    principalId: contentSpace.ownerId,
  });
  const namespaceSnapshotRef = namespaceAccess?.resolvedSnapshotRef;
  if (namespaceSnapshotRef?.resourceType !== "namespace_revision") {
    throw new AppError("Il Namespace non ha una revisione autorizzata per la release", 409, [{ code: "AUTHORIZED_NAMESPACE_REVISION_REQUIRED" }]);
  }
  const namespaceRevision = await NamespaceRevision.findOne({
    _id: namespaceSnapshotRef.resourceId,
    namespaceId: namespace._id,
    status: { $in: ["published", "superseded"] },
    "integrity.status": "valid",
  }).lean();
  if (!namespaceRevision) throw new AppError("La NamespaceRevision autorizzata non è release-ready", 409, [{ code: "NAMESPACE_REVISION_NOT_RELEASE_READY" }]);

  if (!context.workingGraphRevisionId) throw new AppError("EditorialContext privo di GraphRevision di lavoro", 409, [{ code: "WORKING_GRAPH_REVISION_REQUIRED" }]);
  const graphRevision = await SemanticGraphRevision.findOne({
    _id: context.workingGraphRevisionId,
    editorialContextId: context._id,
  }).select("_id authoredAgainstNamespaceRevisionId").lean();
  if (!graphRevision) throw new AppError("GraphRevision di lavoro non disponibile", 409, [{ code: "WORKING_GRAPH_REVISION_NOT_FOUND" }]);

  const memberships = await ContentSpaceMembership.find({ contentSpaceId: contentSpace._id }).select("itemId").lean();
  const itemIds = memberships.map((entry) => entry.itemId);
  const items = itemIds.length
    ? await ItemV2.find({ _id: { $in: itemIds }, lifecycleStatus: "active" }).select("_id primarySubjectId").lean()
    : [];
  const editions = items.length
    ? await ItemEdition.find({ itemId: { $in: items.map((item) => item._id) }, namespaceId: namespace._id }).lean()
    : [];
  const subjects = items.length
    ? await Subject.find({ _id: { $in: items.map((item) => item.primarySubjectId) } }).select("preferredLabel").lean()
    : [];
  const itemById = new Map(items.map((item) => [id(item._id), item]));
  const subjectById = new Map(subjects.map((subject) => [id(subject._id), subject]));

  const candidates = [];
  for (const edition of editions) {
    let usage;
    try {
      usage = await assertCanUseItemEditionForEditorialRelease({
        itemEditionId: edition._id,
        actorUserId,
        principalType: contentSpace.ownerType,
        principalId: contentSpace.ownerId,
      });
    } catch (error) {
      if (error?.status === 403) continue;
      throw error;
    }
    const ref = usage.access?.resolvedSnapshotRef;
    let revisionId = null;
    if (usage.access?.basis === "entitlement") {
      if (ref?.resourceType !== "item_revision") continue;
      revisionId = ref.resourceId;
    } else {
      revisionId = edition.publishedRevisionId;
    }
    if (!revisionId) continue;
    const revision = await ItemRevisionV2.findOne({
      _id: revisionId,
      itemEditionId: edition._id,
      status: { $in: ["published", "superseded"] },
    }).select("label version authorCredits metadata presentationVariants").lean();
    if (!revision) continue;
    const item = itemById.get(id(edition.itemId));
    const subject = item ? subjectById.get(id(item.primarySubjectId)) : null;
    candidates.push({
      itemId: edition.itemId,
      itemEditionId: edition._id,
      itemRevisionId: revision._id,
      title: revision.label,
      subject: subject ? { id: subject._id, preferredLabel: subject.preferredLabel } : null,
      version: revision.version,
      authorCredits: revision.authorCredits || [],
      license: revision.metadata?.license || null,
      representationCount: (revision.presentationVariants || []).reduce((total, variant) => total + (variant.representations || []).length, 0),
      accessBasis: usage.access?.basis || null,
    });
  }

  const currentRelease = context.publishedReleaseId
    ? await EditorialRelease.findById(context.publishedReleaseId).select("itemBindings version").lean()
    : null;
  const selectedEditionIds = new Set((currentRelease?.itemBindings || []).map((entry) => id(entry.itemEditionId)));
  return {
    context: { id: context._id, name: context.displayName, description: context.description || context.shortDescription || "" },
    contentSpace: { id: contentSpace._id, name: contentSpace.name },
    namespace: { id: namespace._id, name: namespace.name },
    releaseInputs: {
      namespaceRevisionId: namespaceRevision._id,
      graphRevisionId: graphRevision._id,
      selectionSignals: (namespaceRevision.selectionSignals || []).map((entry) => ({ definitionId: entry.definitionId, label: entry.label, description: entry.description || "" })),
    },
    currentRelease: currentRelease ? { id: currentRelease._id, version: currentRelease.version } : null,
    candidates: candidates.map((candidate) => ({ ...candidate, selectedByCurrentRelease: selectedEditionIds.has(id(candidate.itemEditionId)) })),
  };
}

module.exports = { getEditorialReleaseComposer };
