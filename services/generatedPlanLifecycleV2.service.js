const GeneratedVisitPlanV2 = require("../models/generatedVisitPlanV2.model");
const AppError = require("../utils/AppError");

async function getGeneratedPlanForUserV2({ planId, userId }) {
  const plan = await GeneratedVisitPlanV2.findOne({ _id: planId, userId });
  if (!plan) throw new AppError("Piano generato v2 non trovato", 404);
  return plan;
}

async function acceptGeneratedPlanForUserV2({ planId, userId }) {
  const plan = await getGeneratedPlanForUserV2({ planId, userId });
  if (plan.status === "accepted") return plan;
  if (plan.status !== "proposed") {
    throw new AppError("Il GeneratedPlan non è più accettabile", 409, [{
      code: "GENERATED_PLAN_NOT_ACCEPTABLE",
      context: { status: plan.status },
    }]);
  }
  plan.status = "accepted";
  plan.acceptedAt = new Date();
  await plan.save();
  return plan;
}

module.exports = {
  getGeneratedPlanForUserV2,
  acceptGeneratedPlanForUserV2,
};
