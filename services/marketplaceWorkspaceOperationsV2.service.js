const AppError = require("../utils/AppError");
const { resolveResourceAuthority } = require("./marketplaceResourceV2.service");
const itemService = require("./itemV2.service");
const itemAuthoring = require("./itemAuthoringV2.service");
const namespaceService = require("./namespace.service");
const namespaceRevisionService = require("./namespaceRevision.service");
const physicalVocabularyService = require("./physicalVocabulary.service");
const physicalVocabularyRevisionService = require("./physicalVocabularyRevision.service");
const visitService = require("./visitV2.service");
const visitPublicationService = require("./visitV2Publication.service");
const { importEditorialContextSnapshot } = require("./marketplaceContextImportV2.service");

async function sourceAuthorityOrFail(sourceRef) {
  if (!sourceRef?.resourceType || !sourceRef?.resourceId) {
    throw new AppError("sourceRef e obbligatorio", 400, [{ field: "sourceRef", code: "REQUIRED" }]);
  }
  const authority = await resolveResourceAuthority(sourceRef.resourceType, sourceRef.resourceId);
  if (!authority) throw new AppError("Risorsa sorgente Workspace non disponibile", 404);
  return authority;
}

function workflowTarget(sourceRef, authority) {
  if (sourceRef.resourceType === "item_edition") return { kind: "item_edition", id: authority.edition?._id || authority.resource?._id };
  if (sourceRef.resourceType === "namespace") return { kind: "namespace", id: authority.aggregate?._id || authority.resource?._id };
  if (sourceRef.resourceType === "physical_vocabulary") return { kind: "physical_vocabulary", id: authority.aggregate?._id || authority.resource?._id };
  if (sourceRef.resourceType === "visit") return { kind: "visit", id: authority.aggregate?._id || authority.resource?._id };
  return null;
}

async function executeEditorialWorkflowOperation({ operationCode, sourceRef, authority, payload, actorUserId }) {
  const target = workflowTarget(sourceRef, authority);
  if (!target) throw new AppError("Questa risorsa non espone un workflow editoriale", 409, [{ code: "EDITORIAL_WORKFLOW_UNSUPPORTED_RESOURCE" }]);

  if (target.kind === "item_edition") {
    if (operationCode === "workflow.check") return itemAuthoring.checkEditionConsistency({ editionId: target.id, actorUserId });
    if (operationCode === "workflow.request_review") return itemService.requestEditionReview({ editionId: target.id, actorUserId });
    if (operationCode === "workflow.withdraw_review") return itemService.withdrawEditionReview({ editionId: target.id, actorUserId });
    if (operationCode === "workflow.request_changes") return itemService.requestEditionChanges({ editionId: target.id, actorUserId, message: payload?.message });
    if (operationCode === "workflow.publish") return itemService.publishEdition({ editionId: target.id, actorUserId });
  }

  if (target.kind === "namespace") {
    if (operationCode === "workflow.check") return namespaceRevisionService.evaluateNamespace({ namespaceId: target.id, actorUserId });
    if (operationCode === "workflow.request_review") return namespaceRevisionService.requestNamespaceReview({ namespaceId: target.id, actorUserId });
    if (operationCode === "workflow.withdraw_review") return namespaceRevisionService.withdrawNamespaceReview({ namespaceId: target.id, actorUserId });
    if (operationCode === "workflow.request_changes") return namespaceRevisionService.requestNamespaceChanges({ namespaceId: target.id, actorUserId, message: payload?.message });
    if (operationCode === "workflow.publish") return namespaceRevisionService.publishNamespace({ namespaceId: target.id, actorUserId });
  }

  if (target.kind === "physical_vocabulary") {
    if (operationCode === "workflow.check") return physicalVocabularyRevisionService.evaluatePhysicalVocabulary({ physicalVocabularyId: target.id, actorUserId });
    if (operationCode === "workflow.request_review") return physicalVocabularyRevisionService.requestPhysicalVocabularyReview({ physicalVocabularyId: target.id, actorUserId });
    if (operationCode === "workflow.withdraw_review") return physicalVocabularyRevisionService.withdrawPhysicalVocabularyReview({ physicalVocabularyId: target.id, actorUserId });
    if (operationCode === "workflow.request_changes") return physicalVocabularyRevisionService.requestPhysicalVocabularyChanges({ physicalVocabularyId: target.id, actorUserId, message: payload?.message });
    if (operationCode === "workflow.publish") return physicalVocabularyRevisionService.publishPhysicalVocabulary({ physicalVocabularyId: target.id, actorUserId });
  }

  if (target.kind === "visit") {
    if (operationCode === "workflow.check") return visitPublicationService.evaluateVisitV2Consistency({ visitId: target.id, actorUserId });
    if (operationCode === "workflow.request_review") return visitPublicationService.requestVisitV2Review({ visitId: target.id, actorUserId });
    if (operationCode === "workflow.withdraw_review") return visitPublicationService.withdrawVisitV2Review({ visitId: target.id, actorUserId });
    if (operationCode === "workflow.request_changes") return visitPublicationService.requestVisitV2Changes({ visitId: target.id, actorUserId, message: payload?.message });
    if (operationCode === "workflow.publish") return visitPublicationService.publishVisitV2({ visitId: target.id, actorUserId });
  }

  throw new AppError("Operazione workflow editoriale non supportata", 400, [{ code: "UNKNOWN_EDITORIAL_WORKFLOW_OPERATION", context: { operationCode } }]);
}

async function executeWorkspaceOperation({ operationCode, sourceRef, targetPrincipal, payload = {}, actorUserId }) {
  const ownerType = targetPrincipal?.type || "user";
  const ownerId = targetPrincipal?.id || actorUserId;
  const authority = await sourceAuthorityOrFail(sourceRef);

  if (String(operationCode || "").startsWith("workflow.")) {
    const result = await executeEditorialWorkflowOperation({ operationCode, sourceRef, authority, payload, actorUserId });
    return { operationCode, result };
  }

  if (operationCode === "content.fork") {
    const edition = sourceRef.resourceType === "item_edition" ? authority.resource : authority.edition;
    const item = authority.aggregate;
    if (!edition || !item) throw new AppError("ItemEdition sorgente non risolvibile", 409);
    const result = await itemService.forkItem({
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
    const result = await namespaceService.forkNamespace({
      namespaceId: namespace._id,
      payload: { ownerType, ownerId, name: payload.name || null },
      actorUserId,
    });
    return { operationCode, resultRef: { resourceType: "namespace", resourceId: result.namespace._id } };
  }

  if (operationCode === "physical_vocabulary.fork") {
    const physicalVocabulary = sourceRef.resourceType === "physical_vocabulary" ? authority.resource : authority.aggregate;
    if (!physicalVocabulary) throw new AppError("Physical Vocabulary sorgente non risolvibile", 409);
    const result = await physicalVocabularyService.forkPhysicalVocabulary({
      physicalVocabularyId: physicalVocabulary._id,
      payload: { ownerType, ownerId, name: payload.name || null },
      actorUserId,
    });
    return { operationCode, resultRef: { resourceType: "physical_vocabulary", resourceId: result.physicalVocabulary._id } };
  }

  if (operationCode === "visit.copy_detached") {
    const visit = sourceRef.resourceType === "visit" ? authority.resource : authority.aggregate;
    if (!visit) throw new AppError("Visit sorgente non risolvibile", 409);
    const result = await visitService.copyVisitV2({
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
