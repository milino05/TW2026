const express = require("express");
const router = express.Router();
const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const { requireAuth } = require("../middlewares/auth");
const controller = require("../controllers/subjects.controller");

const validateSubjectId = validateObjectIdParam("subjectId");

router.route("/subjects")
  .get(controller.listSubjects)
  .post(requireAuth, controller.createSubject);

router.get("/subjects/:subjectId", validateSubjectId, controller.getSubject);

module.exports = router;
