const generator=require("../services/visitGenerator.service"),sessions=require("../services/visitSession.service");
async function generate(req,res,next){try{res.status(201).json(await generator.generateVisitPlan({userId:req.user._id,museumId:req.params.museumId,request:req.body||{}}))}catch(error){next(error)}}
async function get(req,res,next){try{res.status(200).json(await generator.getGeneratedPlan({planId:req.params.planId,userId:req.user._id}))}catch(error){next(error)}}
async function accept(req,res,next){try{res.status(200).json(await generator.acceptGeneratedPlan({planId:req.params.planId,userId:req.user._id}))}catch(error){next(error)}}
async function start(req,res,next){try{res.status(201).json(await sessions.startGeneratedPlanSession({userId:req.user._id,planId:req.params.planId}))}catch(error){next(error)}}
module.exports={generate,get,accept,start};
