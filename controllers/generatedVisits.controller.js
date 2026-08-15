const generator=require("../services/visitGenerator.service");
const sessions=require("../services/visitSession.service");
const UserGenerationPreference=require("../models/userGenerationPreference.model");
const AppError=require("../utils/AppError");
const{validateGenerationRequest}=require("../services/validation/generation.validation");
const PREFERENCE_FIELDS=new Set(["semanticGoals","relationGoals","coverageGoal","audience","knowledge","depthPreference","languageComplexityPreference","movementPacePreference","navigationRequirements","observationEmphasis","visitDensity","discoveryPreference","timeRiskTolerance"]);
async function generate(req,res,next){try{res.status(201).json(await generator.generateVisitPlan({userId:req.user._id,museumId:req.params.museumId,request:req.body||{}}))}catch(error){next(error)}}
async function get(req,res,next){try{res.status(200).json(await generator.getGeneratedPlan({planId:req.params.planId,userId:req.user._id}))}catch(error){next(error)}}
async function accept(req,res,next){try{res.status(200).json(await generator.acceptGeneratedPlan({planId:req.params.planId,userId:req.user._id}))}catch(error){next(error)}}
async function start(req,res,next){try{res.status(201).json(await sessions.startGeneratedPlanSession({userId:req.user._id,planId:req.params.planId}))}catch(error){next(error)}}
async function getPreferences(req,res,next){try{res.json({preferences:await UserGenerationPreference.findOne({userId:req.user._id}).lean()})}catch(error){next(error)}}
async function setPreferences(req,res,next){try{const payload=req.body||{},unknown=Object.keys(payload).filter(key=>!PREFERENCE_FIELDS.has(key));if(unknown.length)throw new AppError("Preferenze di generazione non valide",400,unknown.map(field=>({field,code:"UNKNOWN_FIELD",message:`Campo non supportato: ${field}`})));const errors=validateGenerationRequest({timeBudgetSeconds:1,...payload});if(errors.length)throw new AppError("Preferenze di generazione non valide",400,errors);const set={};for(const field of PREFERENCE_FIELDS)if(Object.prototype.hasOwnProperty.call(payload,field))set[field]=payload[field];const preferences=await UserGenerationPreference.findOneAndUpdate({userId:req.user._id},{$set:set,$setOnInsert:{userId:req.user._id}},{upsert:true,new:true,runValidators:true,setDefaultsOnInsert:true});res.json({preferences})}catch(error){next(error)}}
async function clearPreferences(req,res,next){try{await UserGenerationPreference.deleteOne({userId:req.user._id});res.json({cleared:true})}catch(error){next(error)}}
module.exports={generate,get,accept,start,getPreferences,setPreferences,clearPreferences};
