const Subject = require("../models/subject.model");

function id(value) { return String(value?._id || value || ""); }

async function venueTargetIdentityMap(targets = []) {
  const subjectIds = [...new Map(targets.map((target) => [id(target.subjectId), target.subjectId]).filter(([key]) => key)).values()];
  const subjects = subjectIds.length
    ? await Subject.find({ _id: { $in: subjectIds } }).select("preferredLabel description externalIdentities").lean()
    : [];
  const subjectById = new Map(subjects.map((subject) => [id(subject._id), subject]));
  return new Map(targets.map((target) => {
    const subject = subjectById.get(id(target.subjectId));
    return [id(target._id), {
      label: target.displayLabelOverride || subject?.preferredLabel || "Entità della sede",
      description: target.inventoryNote || subject?.description || "",
      subject: subject || null,
    }];
  }));
}

module.exports = { venueTargetIdentityMap };
