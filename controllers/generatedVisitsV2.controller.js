const generator = require("../services/visitGeneratorV2.service");
const { assertGenerationRequestAccess } = require("../services/generationAccess.service");
const { materializeGeneratedPlanV2 } = require("../services/generatedPlanMaterializationV2.service");
const { projectGeneratedPlanV2 } = require("../services/generatedPlanProjectionV2.service");

async function generate(req, res, next) {
  try {
    const request = req.body || {};
    await assertGenerationRequestAccess({ request, actorUserId: req.user._id });
    const plan = await generator.generateVisitPlanV2({ userId: req.user._id, request });
    res.status(201).json(await projectGeneratedPlanV2(plan));
  } catch (error) { next(error); }
}
async function get(req, res, next) {
  try {
    const plan = await generator.getGeneratedPlanV2({ planId: req.params.planId, userId: req.user._id });
    res.status(200).json(await projectGeneratedPlanV2(plan));
  } catch (error) { next(error); }
}
async function accept(req, res, next) {
  try {
    const plan = await generator.acceptGeneratedPlanV2({ planId: req.params.planId, userId: req.user._id });
    res.status(200).json(await projectGeneratedPlanV2(plan));
  } catch (error) { next(error); }
}
async function materialize(req, res, next) {
  try {
    res.status(201).json(await materializeGeneratedPlanV2({
      planId: req.params.planId,
      userId: req.user._id,
      title: req.body?.title || null,
    }));
  } catch (error) { next(error); }
}

module.exports = { generate, get, accept, materialize };
