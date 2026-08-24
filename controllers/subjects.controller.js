const subjectService = require("../services/subject.service");
const subjectExternalIdentityService = require("../services/subjectExternalIdentity.service");
const { projectSubject } = require("../services/subjectProjection.service");

async function createSubject(req, res, next) {
  try {
    const subject = await subjectService.createSubject({
      payload: req.body || {},
      actorUserId: req.user._id,
    });
    res.status(201).json(projectSubject(subject));
  } catch (error) { next(error); }
}

async function listSubjects(req, res, next) {
  try {
    const subjects = await subjectService.listSubjects({
      search: req.query?.search || "",
      limit: req.query?.limit,
      externalScheme: req.query?.externalScheme || null,
      externalId: req.query?.externalId || null,
    });
    res.status(200).json(subjects.map(projectSubject));
  } catch (error) { next(error); }
}

async function getSubject(req, res, next) {
  try {
    res.status(200).json(projectSubject(await subjectService.getSubjectById({ subjectId: req.params.subjectId })));
  } catch (error) { next(error); }
}

async function createSubjectFromExternalIdentity(req, res, next) {
  try {
    const result = await subjectExternalIdentityService.createSubjectFromExternalIdentity({
      payload: req.body || {},
      actorUserId: req.user._id,
    });
    res.status(result.created ? 201 : 200).json(result);
  } catch (error) { next(error); }
}

module.exports = { createSubject, createSubjectFromExternalIdentity, listSubjects, getSubject };
