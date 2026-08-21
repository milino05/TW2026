const subjectService = require("../services/subject.service");

async function createSubject(req, res, next) {
  try {
    res.status(201).json(await subjectService.createSubject({
      payload: req.body || {},
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function listSubjects(req, res, next) {
  try {
    res.status(200).json(await subjectService.listSubjects({
      search: req.query?.search || "",
      limit: req.query?.limit,
    }));
  } catch (error) { next(error); }
}

async function getSubject(req, res, next) {
  try {
    res.status(200).json(await subjectService.getSubjectById({ subjectId: req.params.subjectId }));
  } catch (error) { next(error); }
}

module.exports = { createSubject, listSubjects, getSubject };
