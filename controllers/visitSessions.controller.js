const service=require("../services/visitSession.service"),adaptation=require("../services/planAdaptation.service"),sessionPlans=require("../services/sessionPlan.service");
async function start(req,res,next){try{res.status(201).json(await service.startSession({userId:req.user._id,visitId:req.body.visitId,movementPacePreference:req.body.movementPacePreference,timeBudgetSeconds:req.body.timeBudgetSeconds}))}catch(error){next(error)}}
async function transition(req,res,next){try{res.json(await service.recordTransition({sessionId:req.params.sessionId,userId:req.user._id,payload:req.body}))}catch(error){next(error)}}
async function stop(req,res,next){try{res.json(await service.recordStop({sessionId:req.params.sessionId,userId:req.user._id,payload:req.body}))}catch(error){next(error)}}
async function interaction(req,res,next){try{res.json(await service.recordInteraction({sessionId:req.params.sessionId,userId:req.user._id,payload:req.body}))}catch(error){next(error)}}
async function presentationDepth(req,res,next){try{res.json(await service.changePresentationDepth({sessionId:req.params.sessionId,userId:req.user._id,payload:req.body||{}}))}catch(error){next(error)}}
async function pause(req,res,next){try{res.json(await service.pauseSession({sessionId:req.params.sessionId,userId:req.user._id}))}catch(error){next(error)}}
async function resume(req,res,next){try{res.json(await service.resumeSession({sessionId:req.params.sessionId,userId:req.user._id}))}catch(error){next(error)}}
async function routeCompleted(req,res,next){try{res.json(await service.markRouteCompleted({sessionId:req.params.sessionId,userId:req.user._id}))}catch(error){next(error)}}
async function complete(req,res,next){try{res.json(await service.completeSession({sessionId:req.params.sessionId,userId:req.user._id}))}catch(error){next(error)}}
async function currentPlan(req,res,next){try{res.json(await sessionPlans.getCurrentSessionPlan({sessionId:req.params.sessionId,userId:req.user._id,allowCompleted:true}))}catch(error){next(error)}}
async function proposeChange(req,res,next){try{res.status(201).json(await adaptation.proposePlanChange({userId:req.user._id,sessionId:req.params.sessionId,payload:req.body||{}}))}catch(error){next(error)}}
async function acceptChange(req,res,next){try{res.json(await adaptation.resolvePlanChangeProposal({userId:req.user._id,proposalId:req.params.proposalId,accept:true}))}catch(error){next(error)}}
async function rejectChange(req,res,next){try{res.json(await adaptation.resolvePlanChangeProposal({userId:req.user._id,proposalId:req.params.proposalId,accept:false}))}catch(error){next(error)}}
module.exports={start,transition,stop,interaction,presentationDepth,pause,resume,routeCompleted,complete,currentPlan,proposeChange,acceptChange,rejectChange};
