const express=require("express"),router=express.Router(),{requireAuth}=require("../middlewares/auth"),{validateObjectIdParam}=require("../middlewares/validateObjectIdParam"),controller=require("../controllers/generatedVisits.controller");
const validateMuseumId=validateObjectIdParam("museumId"),validatePlanId=validateObjectIdParam("planId");
router.post("/museums/:museumId/generated-plans",requireAuth,validateMuseumId,controller.generate);
router.get("/generated-plans/:planId",requireAuth,validatePlanId,controller.get);
router.post("/generated-plans/:planId/accept",requireAuth,validatePlanId,controller.accept);
router.post("/generated-plans/:planId/start",requireAuth,validatePlanId,controller.start);
module.exports=router;
