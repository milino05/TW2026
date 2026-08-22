const AppError = require("../utils/AppError");
const { resolveResourceAuthority } = require("./marketplaceResourceV2.service");
const { forkItem } = require("./itemV2.service");
const { forkNamespace } = require("./namespace.service");
const { copyVisitV2 } = require("./visitV2.service");
const { importEditorialContextSnapshot } = require("./marketplaceContextImportV2.service");

async function sourceAuthorityOrFail(sourceRef) {
  if (!sourceRef?.resourceType || !sourceRef?.resourceId) {
    throw new AppError("sourceRef e obbligatorio", 400, [{ field: "sourceRef", code: "REQUIRED" }]);
  }
  const authority = await resolveResourceAuthority(sourceRef.resourceType, sourceRef.resourceId);
  if (!authority) throw new AppError("Risorsa sorgente Workspace non disponibile", 404);
  return authority;
}

async function executeWorkspaceOperation({ operationCode, sourceRef, targetPrincipal, payload = {}, actorUserId }) {
  const ownerType = targetPrincipal?.type || "user";
  const ownerId = targetPrincipal?.id || actorUserId;
  const authority = await sourceAuthorityOrFail(sourceRef);

  if (operationCode === "content.fork") {
    const edition = sourceRef.resourceType === "item_edition" ? authority.resource : authority.edition;
    const item = authority.aggregate;
    if (!edition || !item) throw new AppError("ItemEdition sorgente non risolvibile", 409);
    const result = await forkItem({
      sourceItemId: item._id,
      sourceEditionId: edition._id,
      ownerType,
      ownerId,
      actorUserId,
    });
    return { operationCode, resultRef: { resourceType: "item", resourceId: result.item._id } };
  }

  if (operationCode === "namespace.fork") {
    const namespace = sourceRef.resourceType === "namespace" ? authority.resource : authority.aggregate;
    if (!namespace) throw new AppError("Namespace sorgente non risolvibile", 409);
    const result = await forkNamespace({
      namespaceId: namespace._id,
      payload: { ownerType, ownerId, name: payload.name || null },
      actorUserId,
    });
    return { operationCode, resultRef: { resourceType: "namespace", resourceId: result.namespace._id } };
  }

  if (operationCode === "visit.copy_detached") {
    const visit = sourceRef.resourceType === "visit" ? authority.resource : authority.aggregate;
    if (!visit) throw new AppError("Visit sorgente non risolvibile", 409);
    const result = await copyVisitV2({
      sourceVisitId: visit._id,
      sourceRevisionId: sourceRef.resourceType === "visit_revision" ? authority.resource._id : null,
      ownerType,
      ownerId,
      title: payload.title || null,
      actorUserId,
    });
    return { operationCode, resultRef: { resourceType: "visit", resourceId: result.visit._id } };
  }

  if (operationCode === "context.import_snapshot") {
    const context = sourceRef.resourceType === "editorial_context" ? authority.resource : authority.context;
    if (!context) throw new AppError("EditorialContext sorgente non risolvibile", 409);
    const result = await importEditorialContextSnapshot({
      sourceEditorialContextId: context._id,
      ownerType,
      ownerId,
      actorUserId,
      contentSpaceName: payload.contentSpaceName || null,
      displayName: payload.displayName || null,
    });
    return { operationCode, resultRef: { resourceType: "editorial_context", resourceId: result.editorialContext.id } };
  }

  throw new AppError("Operazione Workspace non eseguibile senza un editor target", 409, [{
    code: "WORKSPACE_OPERATION_REQUIRES_EDITOR_CONTEXT",
    context: { operationCode },
  }]);
}

module.exports = { executeWorkspaceOperation };
