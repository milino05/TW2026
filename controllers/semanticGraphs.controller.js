const graphResourceService = require("../services/semanticGraphResource.service");
const graphCommandService = require("../services/editorialGraphCommand.service");

async function list(req, res, next) {
  try {
    res.status(200).json(await graphResourceService.listSemanticGraphs({
      actorUserId: req.user._id,
      ownerType: req.query?.ownerType,
      ownerId: req.query?.ownerId,
      namespaceId: req.query?.namespaceId || null,
      q: req.query?.q || "",
      page: req.query?.page,
      limit: req.query?.limit,
    }));
  } catch (error) { next(error); }
}

async function create(req, res, next) {
  try {
    res.status(201).json(await graphResourceService.createSemanticGraphResource({
      payload: req.body || {},
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function get(req, res, next) {
  try {
    res.status(200).json(await graphResourceService.getSemanticGraphResource({
      semanticGraphId: req.params.semanticGraphId,
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function update(req, res, next) {
  try {
    res.status(200).json(await graphResourceService.updateSemanticGraphResource({
      semanticGraphId: req.params.semanticGraphId,
      payload: req.body || {},
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function fork(req, res, next) {
  try {
    res.status(201).json(await graphResourceService.forkSemanticGraphResource({
      semanticGraphId: req.params.semanticGraphId,
      payload: req.body || {},
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function trash(req, res, next) {
  try {
    res.status(200).json(await graphResourceService.trashSemanticGraphResource({
      semanticGraphId: req.params.semanticGraphId,
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function restore(req, res, next) {
  try {
    res.status(200).json(await graphResourceService.restoreSemanticGraphResource({
      semanticGraphId: req.params.semanticGraphId,
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function getSnapshot(req, res, next) {
  try {
    res.status(200).json(await graphResourceService.getSemanticGraphSnapshot({
      semanticGraphId: req.params.semanticGraphId,
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function getNeighborhood(req, res, next) {
  try {
    res.status(200).json(await graphResourceService.getSemanticGraphNeighborhood({
      semanticGraphId: req.params.semanticGraphId,
      actorUserId: req.user._id,
      focusSubjectId: req.query?.focusSubjectId || null,
      limit: req.query?.limit,
    }));
  } catch (error) { next(error); }
}

async function listSubjects(req, res, next) {
  try {
    res.status(200).json(await graphResourceService.listSemanticGraphSubjects({
      semanticGraphId: req.params.semanticGraphId,
      actorUserId: req.user._id,
      q: req.query?.q || "",
      page: req.query?.page,
      limit: req.query?.limit,
    }));
  } catch (error) { next(error); }
}

async function addSubject(req, res, next) {
  try {
    const graph = await graphCommandService.addGraphSubject({
      semanticGraphId: req.params.semanticGraphId,
      subjectId: req.params.subjectId,
      actorUserId: req.user._id,
    });
    res.status(201).json(graphResourceService.projectSemanticGraphSnapshot(graph));
  } catch (error) { next(error); }
}

async function removeSubject(req, res, next) {
  try {
    const graph = await graphCommandService.removeGraphSubject({
      semanticGraphId: req.params.semanticGraphId,
      subjectId: req.params.subjectId,
      actorUserId: req.user._id,
    });
    res.status(200).json(graphResourceService.projectSemanticGraphSnapshot(graph));
  } catch (error) { next(error); }
}

async function setSubjectClasses(req, res, next) {
  try {
    const graph = await graphCommandService.setGraphSubjectClasses({
      semanticGraphId: req.params.semanticGraphId,
      subjectId: req.params.subjectId,
      subjectClassDefinitionIds: req.body?.subjectClassDefinitionIds || [],
      actorUserId: req.user._id,
    });
    res.status(200).json(graphResourceService.projectSemanticGraphSnapshot(graph));
  } catch (error) { next(error); }
}

async function addEdge(req, res, next) {
  try {
    const graph = await graphCommandService.addGraphEdge({
      semanticGraphId: req.params.semanticGraphId,
      payload: req.body || {},
      actorUserId: req.user._id,
    });
    res.status(201).json(graphResourceService.projectSemanticGraphSnapshot(graph));
  } catch (error) { next(error); }
}

async function updateEdge(req, res, next) {
  try {
    const graph = await graphCommandService.updateGraphEdge({
      semanticGraphId: req.params.semanticGraphId,
      edgeId: req.params.edgeId,
      payload: req.body || {},
      actorUserId: req.user._id,
    });
    res.status(200).json(graphResourceService.projectSemanticGraphSnapshot(graph));
  } catch (error) { next(error); }
}

async function removeEdge(req, res, next) {
  try {
    const graph = await graphCommandService.removeGraphEdge({
      semanticGraphId: req.params.semanticGraphId,
      edgeId: req.params.edgeId,
      actorUserId: req.user._id,
    });
    res.status(200).json(graphResourceService.projectSemanticGraphSnapshot(graph));
  } catch (error) { next(error); }
}

module.exports = {
  list,
  create,
  get,
  update,
  fork,
  trash,
  restore,
  getSnapshot,
  getNeighborhood,
  listSubjects,
  addSubject,
  removeSubject,
  setSubjectClasses,
  addEdge,
  updateEdge,
  removeEdge,
};
