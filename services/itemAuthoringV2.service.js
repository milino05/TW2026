const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const Subject = require("../models/subject.model");
const User = require("../models/user");
const Organization = require("../models/organization.model");
const ContentSpace = require("../models/contentSpace.model");
const ContentSpaceMembership = require("../models/contentSpaceMembership.model");
const Venue = require("../models/venue.model");
const VenueRelease = require("../models/venueRelease.model");
const VenueTarget = require("../models/venueTarget.model");
const AppError = require("../utils/AppError");
const itemService = require("./itemV2.service");
const { listContentSpaces } = require("./contentSpace.service");
const { resolveActorPrincipals } = require("./principalResolution.service");
const { projectEditorialWorkflowOperations } = require("./editorialWorkflowOperationsV2.service");

function id(value) { return String(value?._id || value || ""); }

function collectRevisionSubjectRefs(revision) {
  const refs = [];
  for (const [index, subjectId] of (revision?.relatedSubjectIds || []).entries()) {
    refs.push({ subjectId: id(subjectId), field: `relatedSubjectIds[${index}]` });
  }
  for (const [variantIndex, variant] of (revision?.presentationVariants || []).entries()) {
    for (const [focusIndex, focus] of (variant.semanticFocus || []).entries()) {
      refs.push({ subjectId: id(focus.subjectId), field: `presentationVariants[${variantIndex}].semanticFocus[${focusIndex}].subjectId` });
    }
    for (const [requirementIndex, requirement] of (variant.knowledgeRequirements || []).entries()) {
      refs.push({ subjectId: id(requirement.subjectId), field: `presentationVariants[${variantIndex}].knowledgeRequirements[${requirementIndex}].subjectId` });
    }
  }
  return [...new Map(refs.filter((entry) => entry.subjectId).map((entry) => [entry.subjectId, entry])).values()];
}

function collectRevisionSubjectIds(revision) {
  return collectRevisionSubjectRefs(revision).map((entry) => entry.subjectId);
}

async function validateReferencedSubjects(revision) {
  const refs = collectRevisionSubjectRefs(revision);
  if (!refs.length) return [];
  const existing = await Subject.find({ _id: { $in: refs.map((entry) => entry.subjectId) } }).select("_id").lean();
  const found = new Set(existing.map((entry) => id(entry)));
  return refs
    .filter((entry) => !found.has(entry.subjectId))
    .map((entry) => ({
      field: entry.field,
      code: "SUBJECT_REFERENCE_NOT_FOUND",
      message: "Un Subject referenziato dalla revisione non esiste",
      context: { subjectId: entry.subjectId },
    }));
}

async function checkEditionConsistency({ editionId, actorUserId }) {
  const result = await itemService.checkEditionConsistency({ editionId, actorUserId });
  const subjectIssues = await validateReferencedSubjects(result.revision);
  if (!subjectIssues.length) return result;
  const previousIssues = (result.revision.integrity?.issues || []).filter((issue) => issue.code !== "SUBJECT_REFERENCE_NOT_FOUND");
  result.revision.integrity = {
    status: "needs_review",
    issues: [...previousIssues, ...subjectIssues],
    checkedAt: new Date(),
    checkedBy: actorUserId,
  };
  await result.revision.save();
  return { revision: result.revision, issues: result.revision.integrity.issues };
}

function projectSubject(subject) {
  if (!subject) return null;
  return {
    id: subject._id,
    preferredLabel: subject.preferredLabel,
    description: subject.description || "",
    externalIdentities: (subject.externalIdentities || []).map((identity) => ({
      scheme: identity.scheme,
      id: identity.id,
      role: identity.role,
      canonicalId: identity.canonicalId || null,
      verificationStatus: identity.verification?.status,
    })),
  };
}

function definitionMaps(namespaceRevision) {
  return {
    duration: new Map((namespaceRevision?.durationTypes || []).map((entry) => [entry.definitionId, entry])),
    language: new Map((namespaceRevision?.languageLevels || []).map((entry) => [entry.definitionId, entry])),
    aspect: new Map((namespaceRevision?.presentationAspects || []).map((entry) => [entry.definitionId, entry])),
    signal: new Map((namespaceRevision?.selectionSignals || []).map((entry) => [entry.definitionId, entry])),
  };
}

function projectRepresentation(representation, maps) {
  const duration = maps.duration.get(representation.durationTypeDefinitionId);
  const language = maps.language.get(representation.languageLevelDefinitionId);
  return {
    id: representation._id,
    duration: {
      definitionId: representation.durationTypeDefinitionId,
      label: duration?.label || representation.durationTypeDefinitionId,
      targetSeconds: duration?.targetSeconds ?? null,
    },
    languageComplexity: {
      definitionId: representation.languageLevelDefinitionId,
      label: language?.label || representation.languageLevelDefinitionId,
    },
    locale: representation.locale,
    text: representation.text,
  };
}

function projectNamespaceControls(namespace, revision) {
  return {
    id: namespace._id,
    name: namespace.name,
    description: namespace.description || "",
    revision: {
      id: revision._id,
      version: revision.version,
      durationTypes: (revision.durationTypes || []).map((entry) => ({
        definitionId: entry.definitionId,
        label: entry.label,
        description: entry.description || "",
        targetSeconds: entry.targetSeconds,
      })),
      languageLevels: (revision.languageLevels || []).map((entry) => ({
        definitionId: entry.definitionId,
        label: entry.label,
        description: entry.description || "",
      })),
      presentationAspects: (revision.presentationAspects || []).map((entry) => ({
        definitionId: entry.definitionId,
        label: entry.label,
        description: entry.description || "",
      })),
      selectionSignals: (revision.selectionSignals || []).map((entry) => ({
        definitionId: entry.definitionId,
        label: entry.label,
        description: entry.description || "",
      })),
    },
  };
}

async function ownerSummary(item) {
  if (item.ownerType === "organization") {
    const organization = await Organization.findById(item.ownerId).select("name").lean();
    return { type: "organization", id: item.ownerId, name: organization?.name || "Organization" };
  }
  const user = await User.findById(item.ownerId).select("username").lean();
  return { type: "user", id: item.ownerId, name: user?.username || "Autore" };
}

async function actorRoleForOwner(item, actorUserId) {
  const { principals } = await resolveActorPrincipals(actorUserId);
  const principal = principals.find((entry) => entry.type === item.ownerType && id(entry.id) === id(item.ownerId));
  if (!principal) throw new AppError("Principal proprietario non disponibile per l'actor", 403, [{ code: "PRINCIPAL_AUTHORITY_REQUIRED" }]);
  return principal.role;
}

async function projectMemberships({ itemId, actorUserId }) {
  const spaces = await listContentSpaces({ actorUserId });
  const spaceIds = spaces.map((space) => space._id);
  const memberships = spaceIds.length
    ? await ContentSpaceMembership.find({ itemId, contentSpaceId: { $in: spaceIds } }).select("contentSpaceId").lean()
    : [];
  const memberOf = new Set(memberships.map((entry) => id(entry.contentSpaceId)));
  return spaces.map((space) => ({
    contentSpaceId: space._id,
    name: space.name,
    owner: { type: space.ownerType, id: space.ownerId },
    member: memberOf.has(id(space._id)),
  }));
}

async function getItemAuthoringProjection({ itemId, editionId = null, actorUserId }) {
  const item = await itemService.findItemOrFail(itemId);
  await itemService.assertCanManageItem(item, actorUserId);
  const [subject, editions, owner, memberships, actorRole] = await Promise.all([
    Subject.findById(item.primarySubjectId).lean(),
    ItemEdition.find({ itemId: item._id }).sort({ createdAt: 1 }).lean(),
    ownerSummary(item),
    projectMemberships({ itemId: item._id, actorUserId }),
    actorRoleForOwner(item, actorUserId),
  ]);
  if (!subject) throw new AppError("Primary Subject dell'Item non disponibile", 409, [{ code: "PRIMARY_SUBJECT_NOT_FOUND" }]);

  const selectedEdition = editionId
    ? editions.find((edition) => id(edition._id) === id(editionId))
    : editions[0] || null;
  if (editionId && !selectedEdition) throw new AppError("ItemEdition non appartenente all'Item", 404);

  const editionSummaries = [];
  for (const edition of editions) {
    const namespace = await Namespace.findOne({ _id: edition.namespaceId, lifecycleStatus: "active" }).select("name description").lean();
    editionSummaries.push({
      id: edition._id,
      namespace: namespace ? { id: namespace._id, name: namespace.name } : null,
      workingRevisionId: edition.workingRevisionId || null,
      publishedRevisionId: edition.publishedRevisionId || null,
    });
  }

  let selected = null;
  let workflowRevision = null;
  if (selectedEdition) {
    const revisionId = selectedEdition.workingRevisionId || selectedEdition.publishedRevisionId;
    const revision = revisionId ? await ItemRevisionV2.findById(revisionId).lean() : null;
    workflowRevision = revision;
    const namespace = await Namespace.findOne({ _id: selectedEdition.namespaceId, lifecycleStatus: "active" }).lean();
    if (!namespace) throw new AppError("Namespace della Edition non disponibile", 409);
    const namespaceRevisionId = revision?.authoredAgainstNamespaceRevisionId || namespace.workingRevisionId || namespace.publishedRevisionId;
    const namespaceRevision = namespaceRevisionId ? await NamespaceRevision.findById(namespaceRevisionId).lean() : null;
    if (!namespaceRevision) throw new AppError("NamespaceRevision di authoring non disponibile", 409);
    const maps = definitionMaps(namespaceRevision);
    const referencedSubjectIds = revision ? collectRevisionSubjectIds(revision) : [];
    const referencedSubjects = referencedSubjectIds.length
      ? await Subject.find({ _id: { $in: referencedSubjectIds } }).lean()
      : [];
    const subjectById = new Map(referencedSubjects.map((entry) => [id(entry), entry]));
    selected = {
      edition: { id: selectedEdition._id },
      namespace: projectNamespaceControls(namespace, namespaceRevision),
      revision: revision ? {
        id: revision._id,
        version: revision.version,
        status: revision.status,
        integrity: revision.integrity,
        label: revision.label,
        relatedSubjects: (revision.relatedSubjectIds || []).map((subjectId) => projectSubject(subjectById.get(id(subjectId))) || { id: subjectId, missing: true }),
        authorCredits: revision.authorCredits || [],
        license: revision.metadata?.license || null,
        tags: revision.tags || [],
        illustrativeMedia: (revision.illustrativeMedia || []).map((media) => ({ id: media._id, url: media.url, altText: media.altText || null })),
        selectionSignals: (revision.selectionSignals || []).map((signal) => ({
          definitionId: signal.definitionId,
          label: maps.signal.get(signal.definitionId)?.label || signal.definitionId,
          weight: signal.weight,
        })),
        presentationVariants: (revision.presentationVariants || []).map((variant) => ({
          id: variant._id,
          key: variant.key,
          label: variant.label,
          description: variant.description || "",
          semanticFocus: (variant.semanticFocus || []).map((focus) => ({
            subject: projectSubject(subjectById.get(id(focus.subjectId))) || { id: focus.subjectId, missing: true },
            weight: focus.weight,
          })),
          presentationAspects: (variant.presentationAspects || []).map((aspect) => ({
            definitionId: aspect.definitionId,
            label: maps.aspect.get(aspect.definitionId)?.label || aspect.definitionId,
            weight: aspect.weight,
          })),
          knowledgeRequirements: (variant.knowledgeRequirements || []).map((requirement) => ({
            subject: projectSubject(subjectById.get(id(requirement.subjectId))) || { id: requirement.subjectId, missing: true },
            minLevel: requirement.minLevel,
            maxLevel: requirement.maxLevel,
            weight: requirement.weight,
          })),
          representations: (variant.representations || []).map((representation) => projectRepresentation(representation, maps)),
        })),
        defaultPresentation: revision.defaultPresentation || null,
      } : null,
    };
  }

  const workflowOperations = projectEditorialWorkflowOperations({
    ownerType: item.ownerType,
    actorRole,
    revision: workflowRevision,
  });
  const editAllowed = Boolean(workflowRevision && workflowRevision.status !== "in_review");
  return {
    subject: projectSubject(subject),
    lineage: { id: item._id, owner, provenance: item.provenance || null },
    editions: editionSummaries,
    selected,
    workspaceMemberships: memberships,
    publicationState: selected?.revision ? {
      status: selected.revision.status,
      integrityStatus: selected.revision.integrity?.status || "needs_review",
    } : null,
    availableOperations: [
      ...(editAllowed ? [{ code: "item.edit", label: "Modifica contenuto" }] : []),
      { code: "item.create_edition", label: "Crea Edition" },
      { code: "content_space.membership", label: "Gestisci ContentSpace" },
      ...workflowOperations,
    ],
  };
}

async function getVenueTargetAuthoringContext({ venueTargetId }) {
  const target = await VenueTarget.findOne({ _id: venueTargetId, lifecycleStatus: "active" }).lean();
  if (!target) throw new AppError("VenueTarget non disponibile", 404);
  const [venue, subject] = await Promise.all([
    Venue.findOne({ _id: target.venueId, lifecycleStatus: "active" }).select("name description publishedReleaseId").lean(),
    Subject.findById(target.subjectId).lean(),
  ]);
  if (!venue || !subject) throw new AppError("Contesto fisico del VenueTarget non coerente", 409);
  let recognitionMedia = [];
  if (venue.publishedReleaseId) {
    const release = await VenueRelease.findById(venue.publishedReleaseId).select("targetBindings").lean();
    const binding = (release?.targetBindings || []).find((entry) => id(entry.venueTargetId) === id(target._id));
    recognitionMedia = (binding?.recognitionMedia || []).map((media) => ({ url: media.url, altText: media.altText || null }));
  }
  return {
    venue: { id: venue._id, name: venue.name, description: venue.description || "" },
    venueTarget: { id: target._id, label: target.label, description: target.description || "" },
    subject: projectSubject(subject),
    recognitionMedia,
  };
}

module.exports = {
  collectRevisionSubjectIds,
  validateReferencedSubjects,
  checkEditionConsistency,
  getItemAuthoringProjection,
  getVenueTargetAuthoringContext,
};
