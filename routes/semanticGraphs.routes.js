const express = require("express");
const { requireAuth } = require("../middlewares/auth");
const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const controller = require("../controllers/semanticGraphs.controller");

const router = express.Router();
const semanticGraphId = validateObjectIdParam("semanticGraphId");
const subjectId = validateObjectIdParam("subjectId");
const edgeId = validateObjectIdParam("edgeId");

router.use(requireAuth);

router.route("/semantic-graphs")
  .get(controller.list)
  .post(controller.create);

router.get("/semantic-graphs/:semanticGraphId/authoring", semanticGraphId, controller.authoring);
router.post("/semantic-graphs/:semanticGraphId/restore", semanticGraphId, controller.restore);
router.post("/semantic-graphs/:semanticGraphId/fork", semanticGraphId, controller.fork);
router.get("/semantic-graphs/:semanticGraphId/snapshot", semanticGraphId, controller.getSnapshot);
router.get("/semantic-graphs/:semanticGraphId/neighborhood", semanticGraphId, controller.getNeighborhood);
router.get("/semantic-graphs/:semanticGraphId/subjects", semanticGraphId, controller.listSubjects);

router.route("/semantic-graphs/:semanticGraphId")
  .all(semanticGraphId)
  .get(controller.get)
  .patch(controller.update)
  .delete(controller.trash);

router.route("/semantic-graphs/:semanticGraphId/subjects/:subjectId")
  .all(semanticGraphId, subjectId)
  .post(controller.addSubject)
  .delete(controller.removeSubject);

router.put("/semantic-graphs/:semanticGraphId/subjects/:subjectId/classes", semanticGraphId, subjectId, controller.setSubjectClasses);
router.post("/semantic-graphs/:semanticGraphId/edges", semanticGraphId, controller.addEdge);
router.route("/semantic-graphs/:semanticGraphId/edges/:edgeId")
  .all(semanticGraphId, edgeId)
  .patch(controller.updateEdge)
  .delete(controller.removeEdge);

module.exports = router;
