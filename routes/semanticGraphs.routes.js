const express = require("express");
const { requireAuth } = require("../middlewares/auth");
const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const { requireStandaloneSemanticGraph } = require("../middlewares/requireStandaloneSemanticGraph");
const controller = require("../controllers/semanticGraphs.controller");

const router = express.Router();
const semanticGraphId = validateObjectIdParam("semanticGraphId");
const subjectId = validateObjectIdParam("subjectId");
const edgeId = validateObjectIdParam("edgeId");

// Keep authentication local to this router's own URL family. An unscoped
// middleware here would also intercept public routes mounted after this router.
router.use("/semantic-graphs", requireAuth);

router.route("/semantic-graphs")
  .get(controller.list)
  .post(controller.create);

router.get("/semantic-graphs/:semanticGraphId/authoring", semanticGraphId, controller.authoring);
router.post("/semantic-graphs/:semanticGraphId/restore", semanticGraphId, requireStandaloneSemanticGraph, controller.restore);
router.post("/semantic-graphs/:semanticGraphId/fork", semanticGraphId, requireStandaloneSemanticGraph, controller.fork);
router.get("/semantic-graphs/:semanticGraphId/snapshot", semanticGraphId, controller.getSnapshot);
router.get("/semantic-graphs/:semanticGraphId/neighborhood", semanticGraphId, controller.getNeighborhood);
router.get("/semantic-graphs/:semanticGraphId/subjects", semanticGraphId, controller.listSubjects);

router.route("/semantic-graphs/:semanticGraphId")
  .all(semanticGraphId)
  .get(controller.get)
  .patch(requireStandaloneSemanticGraph, controller.update)
  .delete(requireStandaloneSemanticGraph, controller.trash);

router.route("/semantic-graphs/:semanticGraphId/subjects/:subjectId")
  .all(semanticGraphId, subjectId)
  .post(requireStandaloneSemanticGraph, controller.addSubject)
  .delete(requireStandaloneSemanticGraph, controller.removeSubject);

router.put("/semantic-graphs/:semanticGraphId/subjects/:subjectId/classes", semanticGraphId, subjectId, requireStandaloneSemanticGraph, controller.setSubjectClasses);
router.post("/semantic-graphs/:semanticGraphId/edges", semanticGraphId, requireStandaloneSemanticGraph, controller.addEdge);
router.route("/semantic-graphs/:semanticGraphId/edges/:edgeId")
  .all(semanticGraphId, edgeId)
  .patch(requireStandaloneSemanticGraph, controller.updateEdge)
  .delete(requireStandaloneSemanticGraph, controller.removeEdge);

module.exports = router;
