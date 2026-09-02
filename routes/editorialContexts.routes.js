const express = require("express");
const { requireAuth } = require("../middlewares/auth");
const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const controller = require("../controllers/editorialContexts.controller");
const router = express.Router();
const editorialContextId = validateObjectIdParam("editorialContextId");
const entryId = validateObjectIdParam("entryId");
const revisionId = validateObjectIdParam("revisionId");
const edgeId = validateObjectIdParam("edgeId");
const subjectId = validateObjectIdParam("subjectId");

router.use(requireAuth);
router.route("/editorial-contexts")
  .get(controller.list)
  .post(controller.create);

router.route("/editorial-contexts/:editorialContextId")
  .all(editorialContextId)
  .get(controller.get)
  .patch(controller.update);

router.route("/editorial-contexts/:editorialContextId/entries")
  .all(editorialContextId)
  .get(controller.listEntries)
  .post(controller.addEntry);
router.route("/editorial-contexts/:editorialContextId/entries/:entryId")
  .all(editorialContextId, entryId)
  .patch(controller.updateEntry)
  .delete(controller.removeEntry);

router.get("/editorial-contexts/:editorialContextId/semantic-graph", editorialContextId, controller.getGraph);
router.get("/editorial-contexts/:editorialContextId/semantic-graph/subject-candidates", editorialContextId, controller.searchGraphSubjectCandidates);
router.route("/editorial-contexts/:editorialContextId/semantic-graph/subjects/:subjectId")
  .all(editorialContextId, subjectId)
  .post(controller.addGraphSubject)
  .delete(controller.removeGraphSubject);
router.post("/editorial-contexts/:editorialContextId/semantic-graph/edges", editorialContextId, controller.addGraphEdge);
router.route("/editorial-contexts/:editorialContextId/semantic-graph/edges/:edgeId")
  .all(editorialContextId, edgeId)
  .patch(controller.updateGraphEdge)
  .delete(controller.removeGraphEdge);
router.put("/editorial-contexts/:editorialContextId/semantic-graph/subjects/:subjectId/classes", editorialContextId, subjectId, controller.setGraphSubjectClasses);

router.post("/editorial-contexts/:editorialContextId/check", editorialContextId, controller.checkReadiness);
router.route("/editorial-contexts/:editorialContextId/review")
  .all(editorialContextId)
  .post(controller.requestReview)
  .delete(controller.withdrawReview);
router.post("/editorial-contexts/:editorialContextId/review/:revisionId/request-changes", editorialContextId, revisionId, controller.requestChanges);
router.post("/editorial-contexts/:editorialContextId/review/:revisionId/approve", editorialContextId, revisionId, controller.approveReview);
router.get("/editorial-contexts/:editorialContextId/revisions", editorialContextId, controller.listRevisions);

router.route("/editorial-contexts/:editorialContextId/releases")
  .all(editorialContextId)
  .get(controller.listReleases)
  .post(controller.createRelease);
router.get("/editorial-contexts/:editorialContextId/releases/current", editorialContextId, controller.getCurrentRelease);

module.exports = router;
