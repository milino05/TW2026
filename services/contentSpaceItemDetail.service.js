const mongoose = require("mongoose");
const ContentSpace = require("../models/contentSpace.model");
const ContentSpaceItemMembership = require("../models/contentSpaceItemMembership.model");
const ItemV2 = require("../models/itemV2.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const Subject = require("../models/subject.model");
const Namespace = require("../models/namespace.model");
const EditorialContext = require("../models/editorialContext.model");
const CollectionItemMembership = require("../models/collectionItemMembership.model");
const SemanticGraph = require("../models/semanticGraph.model");
const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
const AppError = require("../utils/AppError");
const { findContentSpaceOrFail, assertCanManageContentSpace } = require("./contentSpace.service");
const { resolveOrganizationAuthority } = require("./organizationAuthorization.service");

function id(value) { return String(value?._id || value?.id || value || ""); }
function assertObjectId(value, field) {
  if (!mongoose.isValidObjectId(value)) throw new AppError(`${field} non valido`, 400, [{ field, code: "INVALID_OBJECT_ID" }]);
}
function mediaProjection(media) {
  if (!media) return null;
  const source = media.toObject ? media.toObject() : media;
  return {
    url: source.url,
    originalUrl: source.originalUrl || null,
    altText: source.altText || null,
    mimeType: source.mimeType || null,
    width: source.width || null,
    height: source.height || null,
    source: source.source || null,
    rights: source.rights || null,
  };
}
function revisionProjection(revision) {
  if (!revision) return null;
  const variants = revision.presentationVariants || [];
  const representations = variants.flatMap((variant) => variant.representations || []);
  return {
    id: revision._id,
    label: revision.label,
    status: revision.status,
    version: revision.version,
    authorCredits: revision.authorCredits || [],
    license: revision.metadata?.license || null,
    presentationCount: representations.length,
    locales: [...new Set(representations.map((entry) => entry.locale).filter(Boolean))],
  };
}

async function loadSpace({ contentSpaceId, actorUserId }) {
  assertObjectId(contentSpaceId, "contentSpaceId");
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId });
  await assertCanManageContentSpace(contentSpace, actorUserId, "editorial_space.view");
  return contentSpace;
}

async function effectivePermissions(contentSpace, actorUserId) {
  if (contentSpace.ownerType === "user") return null;
  const authority = await resolveOrganizationAuthority({ userId: actorUserId, organizationId: contentSpace.ownerId });
  return new Set(authority?.effectivePermissions || []);
}
function hasPermission(contentSpace, permissionSet, code) {
  return contentSpace.ownerType === "user" || permissionSet?.has(code) === true;
}

async function getItemAddContext({ contentSpaceId, subjectId, actorUserId }) {
  assertObjectId(subjectId, "subjectId");
  const contentSpace = await loadSpace({ contentSpaceId, actorUserId });
  const permissions = await effectivePermissions(contentSpace, actorUserId);
  const subject = await Subject.findById(subjectId).lean();
  if (!subject) throw new AppError("Subject non trovato", 404);

  const items = await ItemV2.find({
    primarySubjectId: subject._id,
    ownerType: contentSpace.ownerType,
    ownerId: contentSpace.ownerId,
    lifecycleStatus: "active",
  }).sort({ updatedAt: -1, _id: -1 }).lean();
  const itemIds = items.map((item) => item._id);
  const memberships = itemIds.length
    ? await ContentSpaceItemMembership.find({ itemId: { $in: itemIds } }).select("itemId contentSpaceId").lean()
    : [];
  const spaceIds = [...new Set(memberships.map((membership) => id(membership.contentSpaceId)).filter(Boolean))];
  const spaces = spaceIds.length
    ? await ContentSpace.find({ _id: { $in: spaceIds }, lifecycleStatus: "active", ownerType: contentSpace.ownerType, ownerId: contentSpace.ownerId }).select("name").lean()
    : [];
  const spaceById = new Map(spaces.map((space) => [id(space), space]));
  const spacesByItem = new Map();
  for (const membership of memberships) {
    const key = id(membership.itemId);
    const space = spaceById.get(id(membership.contentSpaceId));
    if (!space) continue;
    if (!spacesByItem.has(key)) spacesByItem.set(key, []);
    spacesByItem.get(key).push({ id: space._id, name: space.name, current: id(space._id) === id(contentSpace._id) });
  }
  const editionCounts = itemIds.length
    ? await ItemEdition.aggregate([
      { $match: { itemId: { $in: itemIds } } },
      { $group: { _id: "$itemId", count: { $sum: 1 } } },
    ])
    : [];
  const editionCountByItem = new Map(editionCounts.map((entry) => [id(entry._id), Number(entry.count || 0)]));

  return {
    space: { id: contentSpace._id, name: contentSpace.name },
    subject: {
      id: subject._id,
      preferredLabel: subject.preferredLabel,
      description: subject.description || "",
      externalIdentities: subject.externalIdentities || [],
    },
    ownedItems: items.map((item) => ({
      id: item._id,
      recognitionMedia: mediaProjection(item.recognitionMedia),
      spaces: spacesByItem.get(id(item._id)) || [],
      alreadyInCurrentSpace: (spacesByItem.get(id(item._id)) || []).some((space) => space.current),
      editionCount: editionCountByItem.get(id(item._id)) || 0,
      updatedAt: item.updatedAt,
    })),
    availableOperations: {
      canCreateItem: hasPermission(contentSpace, permissions, "item.create"),
      canAddExistingItem: hasPermission(contentSpace, permissions, "editorial_space.manage"),
    },
  };
}

async function getItemLibraryDetail({ contentSpaceId, itemId, actorUserId }) {
  assertObjectId(itemId, "itemId");
  const contentSpace = await loadSpace({ contentSpaceId, actorUserId });
  const permissions = await effectivePermissions(contentSpace, actorUserId);
  const membership = await ContentSpaceItemMembership.findOne({ contentSpaceId: contentSpace._id, itemId }).lean();
  if (!membership) throw new AppError("Il contenuto non appartiene a questo spazio editoriale", 404, [{ code: "ITEM_NOT_IN_CONTENT_SPACE" }]);
  const item = await ItemV2.findOne({ _id: itemId, lifecycleStatus: "active" }).lean();
  if (!item) throw new AppError("Item non trovato", 404);
  const subject = await Subject.findById(item.primarySubjectId).lean();
  if (!subject) throw new AppError("Subject dell'Item non disponibile", 409);

  const [editions, contexts, itemMemberships] = await Promise.all([
    ItemEdition.find({ itemId: item._id }).sort({ createdAt: 1 }).lean(),
    EditorialContext.find({ contentSpaceId: contentSpace._id, lifecycleStatus: "active" }).sort({ displayName: 1, createdAt: 1 }).lean(),
    ContentSpaceItemMembership.find({ itemId: item._id }).select("contentSpaceId").lean(),
  ]);
  const namespaceIds = [...new Set([...editions.map((edition) => id(edition.namespaceId)), ...contexts.map((context) => id(context.namespaceId))].filter(Boolean))];
  const namespaces = namespaceIds.length ? await Namespace.find({ _id: { $in: namespaceIds } }).select("name description").lean() : [];
  const namespaceById = new Map(namespaces.map((namespace) => [id(namespace), namespace]));
  const revisionIds = [...new Set(editions.map((edition) => id(edition.workingRevisionId || edition.publishedRevisionId)).filter(Boolean))];
  const revisions = revisionIds.length
    ? await ItemRevisionV2.find({ _id: { $in: revisionIds } }).select("label status version authorCredits metadata presentationVariants").lean()
    : [];
  const revisionById = new Map(revisions.map((revision) => [id(revision), revision]));
  const editionByNamespace = new Map(editions.map((edition) => [id(edition.namespaceId), edition]));

  const contextIds = contexts.map((context) => context._id);
  const graphIds = [...new Set(contexts.map((context) => id(context.semanticGraphId)).filter(Boolean))];
  const [collectionMemberships, graphs] = await Promise.all([
    contextIds.length ? CollectionItemMembership.find({ editorialContextId: { $in: contextIds }, itemId: item._id }).lean() : [],
    graphIds.length ? SemanticGraph.find({ _id: { $in: graphIds }, lifecycleStatus: "active" }).select("displayName workingRevisionId namespaceId").lean() : [],
  ]);
  const collectionMembershipByContext = new Map(collectionMemberships.map((entry) => [id(entry.editorialContextId), entry]));
  const graphById = new Map(graphs.map((graph) => [id(graph), graph]));
  const graphRevisionIds = [...new Set(graphs.map((graph) => id(graph.workingRevisionId)).filter(Boolean))];
  const bindings = graphRevisionIds.length
    ? await GraphSubjectBinding.find({ graphRevisionId: { $in: graphRevisionIds }, subjectId: subject._id }).select("graphRevisionId").lean()
    : [];
  const coveredGraphRevisionIds = new Set(bindings.map((binding) => id(binding.graphRevisionId)));

  const ownedSpaceIds = [...new Set(itemMemberships.map((entry) => id(entry.contentSpaceId)).filter(Boolean))];
  const itemSpaces = ownedSpaceIds.length
    ? await ContentSpace.find({ _id: { $in: ownedSpaceIds }, lifecycleStatus: "active" }).select("name ownerType ownerId").lean()
    : [];
  const visibleSpaces = itemSpaces.filter((space) => space.ownerType === contentSpace.ownerType && id(space.ownerId) === id(contentSpace.ownerId));
  const itemOwnedByCurrentPrincipal = item.ownerType === contentSpace.ownerType && id(item.ownerId) === id(contentSpace.ownerId);
  const canEditItem = itemOwnedByCurrentPrincipal && hasPermission(contentSpace, permissions, "item.edit");
  const canEditCollections = hasPermission(contentSpace, permissions, "editorial_context.edit");

  return {
    space: { id: contentSpace._id, name: contentSpace.name, ownerType: contentSpace.ownerType, ownerId: contentSpace.ownerId },
    item: {
      id: item._id,
      recognitionMedia: mediaProjection(item.recognitionMedia),
      provenance: item.provenance || null,
      ownerType: item.ownerType,
      ownerId: item.ownerId,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    },
    subject: {
      id: subject._id,
      preferredLabel: subject.preferredLabel,
      description: subject.description || "",
      externalIdentities: subject.externalIdentities || [],
    },
    spaces: visibleSpaces.map((space) => ({ id: space._id, name: space.name, current: id(space._id) === id(contentSpace._id) })),
    editions: editions.map((edition) => {
      const namespace = namespaceById.get(id(edition.namespaceId));
      const revision = revisionById.get(id(edition.workingRevisionId || edition.publishedRevisionId)) || null;
      return {
        id: edition._id,
        namespace: { id: edition.namespaceId, name: namespace?.name || "Regole editoriali", description: namespace?.description || "" },
        revision: revisionProjection(revision),
        workingRevisionId: edition.workingRevisionId || null,
        publishedRevisionId: edition.publishedRevisionId || null,
        availableOperations: { canOpen: canEditItem, canEdit: canEditItem },
      };
    }),
    collections: contexts.map((context) => {
      const collectionMembership = collectionMembershipByContext.get(id(context._id)) || null;
      const namespace = namespaceById.get(id(context.namespaceId));
      const edition = editionByNamespace.get(id(context.namespaceId)) || null;
      const revision = edition ? revisionById.get(id(edition.workingRevisionId || edition.publishedRevisionId)) || null : null;
      const graph = graphById.get(id(context.semanticGraphId)) || null;
      const graphRevisionId = graph?.workingRevisionId || null;
      return {
        id: context._id,
        name: context.displayName,
        shortDescription: context.shortDescription || null,
        containsItem: Boolean(collectionMembership),
        entryId: collectionMembership?._id || null,
        locked: Boolean(context.activeReviewRevisionId),
        namespace: { id: context.namespaceId, name: namespace?.name || "Regole editoriali" },
        compatibleEdition: edition ? {
          id: edition._id,
          revision: revisionProjection(revision),
        } : null,
        semanticGraph: graph ? { id: graph._id, name: graph.displayName, workingRevisionId: graphRevisionId } : null,
        semanticCoverage: graphRevisionId ? (coveredGraphRevisionIds.has(id(graphRevisionId)) ? "covered" : "missing") : "unavailable",
        availableOperations: {
          canAdd: canEditCollections && !context.activeReviewRevisionId && !collectionMembership,
          canRemove: canEditCollections && !context.activeReviewRevisionId && Boolean(collectionMembership),
          canOpenGraph: Boolean(graph),
          canOpenCollection: true,
          canCreateEdition: canEditItem && !edition,
          canOpenEdition: canEditItem && Boolean(edition),
        },
      };
    }),
    availableOperations: {
      canEditItem,
      canCreateEdition: canEditItem,
      canManageSpaceMembership: itemOwnedByCurrentPrincipal && hasPermission(contentSpace, permissions, "editorial_space.manage"),
      canEditCollections,
    },
  };
}

module.exports = { getItemAddContext, getItemLibraryDetail };
