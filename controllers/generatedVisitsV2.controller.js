const generator = require("../services/visitGeneratorV2.service");
const { assertGenerationRequestAccess } = require("../services/generationAccess.service");

async function generate(req, res, next) {
  try {
    const request = req.body || {};
    await assertGenerationRequestAccess({ request, actorUserId: req.user._id });
    res.status(201).json(await generator.generateVisitPlanV2({ userId: req.user._id, request }));
  } catch (error) { next(error); }
}
async function get(req, res, next) {
  try { res.status(200).json(await generator.getGeneratedPlanV2({ planId: req.params.planId, userId: req.user._id })); }
  catch (error) { next(error); }
}
async function accept(req, res, next) {
  try { res.status(200).json(await generator.acceptGeneratedPlanV2({ planId: req.params.planId, userId: req.user._id })); }
  catch (error) { next(error); }
}

module.exports = { generate, get, accept };
