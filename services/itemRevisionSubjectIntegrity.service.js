const Subject = require("../models/subject.model");

function id(value) { return String(value?._id || value || ""); }

function collectRevisionSubjectRefs(revision) {
  const refs = [];
  for (const [index, subjectId] of (revision?.relatedSubjectIds || []).entries()) {
    refs.push({ subjectId: id(subjectId), field: `relatedSubjectIds[${index}]` });
  }
  for (const [variantIndex, variant] of (revision?.presentationVariants || []).entries()) {
    for (const [focusIndex, focus] of (variant.semanticFocus || []).entries()) {
      refs.push({
        subjectId: id(focus.subjectId),
        field: `presentationVariants[${variantIndex}].semanticFocus[${focusIndex}].subjectId`,
      });
    }
    for (const [requirementIndex, requirement] of (variant.knowledgeRequirements || []).entries()) {
      refs.push({
        subjectId: id(requirement.subjectId),
        field: `presentationVariants[${variantIndex}].knowledgeRequirements[${requirementIndex}].subjectId`,
      });
    }
  }
  return refs.filter((entry) => entry.subjectId);
}

function collectRevisionSubjectIds(revision) {
  return [...new Set(collectRevisionSubjectRefs(revision).map((entry) => entry.subjectId))];
}

async function validateReferencedSubjects(revision) {
  const refs = collectRevisionSubjectRefs(revision);
  if (!refs.length) return [];
  const uniqueIds = [...new Set(refs.map((entry) => entry.subjectId))];
  const existing = await Subject.find({
    _id: { $in: uniqueIds },
    lifecycleStatus: { $ne: "trashed" },
  }).select("_id").lean();
  const found = new Set(existing.map((entry) => id(entry)));
  return refs
    .filter((entry) => !found.has(entry.subjectId))
    .map((entry) => ({
      field: entry.field,
      code: "SUBJECT_REFERENCE_NOT_FOUND",
      message: "Un Subject referenziato dalla revisione non esiste o non e attivo",
      severity: "error",
      context: { subjectId: entry.subjectId },
    }));
}

module.exports = {
  collectRevisionSubjectRefs,
  collectRevisionSubjectIds,
  validateReferencedSubjects,
};
