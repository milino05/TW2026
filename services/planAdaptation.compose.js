const UserAdaptiveProfile=require("../models/userAdaptiveProfile.model");
const policy=require("../config/adaptivePolicy");
const{generateVisitPlan}=require("./visitGenerator.service");
const{materializePhysicalRoute}=require("./visitPhysicalRoute.service");
const{timingFromPlan}=require("./physicalRoute.service");
const{id}=require("./sessionPlan.service");
const H=require("./planAdaptation.helpers");
async function buildTail({userId,plan,prepared}){
 const{reason,futureSegment,request,museumId,plannerConstraints}=prepared;
 if(reason!=="route_only")return generateVisitPlan({userId,museumId,request,persist:false,plannerConstraints});
 const profile=await UserAdaptiveProfile.findOne({userId}).lean();
 const result=await materializePhysicalRoute({contentEntries:futureSegment.map(H.plain),adaptiveProfile:profile,navigation:{movementPacePreference:request.movementPacePreference,requirements:request.navigationRequirements||[],startPlaceId:request.startPlaceId},defaultMovementSpeedMps:plan.contextSnapshot?.effectiveMovementSpeedMps||policy.coldStart.movementSpeedMps});
 return{contentEntries:result.contentEntries,physicalRoute:result.physicalRoute,contextSnapshot:plan.contextSnapshot,adaptivePolicyVersion:policy.version,utilityScore:0,sourceVocabularyRevisionId:null,sourceLayoutRevisionId:result.sourceLayoutRevisionIds?.[0]||null,estimatedTiming:timingFromPlan(result.contentEntries,result.physicalRoute)};
}
function composeRevision({plan,prepared,tail,currentEntryIndex,elapsed}){
 const{reason,fidelity,futureSegment,suffixEntries,pieces,constraints,request,remainingBudget,museumId}=prepared;
 const originalRoles=new Map(futureSegment.map(e=>[id(e.itemId),e.role])),mustCore=new Set([...constraints.include,...constraints.visit].map(id));
 const tailEntries=(tail.contentEntries||[]).map(e=>({...H.plain(e),role:originalRoles.get(id(e.itemId))||(mustCore.has(id(e.itemId))?"core":"recommended")}));
 const normalizedTail=H.normalizeTailStart(tailEntries,tail.physicalRoute||{},pieces.currentAnchorId);
 const prefixEntries=plan.contentEntries.slice(0,currentEntryIndex+1).map(H.plain),contentEntries=[...prefixEntries,...normalizedTail.entries,...suffixEntries];
 const physicalRoute=H.mergeRoute({prefix:{anchors:pieces.prefixAnchors,legs:pieces.prefixLegs,currentAnchorId:pieces.currentAnchorId},tail:normalizedTail,suffix:{anchors:pieces.suffixAnchors,legs:pieces.suffixLegs},boundary:pieces.boundaryLeg});
 const totalSessionBudgetSeconds=Math.round(elapsed+remainingBudget),estimatedTiming=timingFromPlan(contentEntries,physicalRoute,tail.estimatedTiming?.reservedSeconds||0);
 const sourceLayoutRevisionIds=H.uniqueIds([...(plan.sourceLayoutRevisionIds||[]),...(physicalRoute.legs||[]).map(l=>l.layoutRevisionId).filter(Boolean)]);
 return{totalSessionBudgetSeconds,revision:{origin:H.plain(plan.origin),createdReason:reason,fidelity,executedThroughEntryIndex:currentEntryIndex,requestSnapshot:{...request,timeBudgetSeconds:totalSessionBudgetSeconds},contextSnapshot:tail.contextSnapshot||H.plain(plan.contextSnapshot),sourceVocabularyRevisionIds:H.uniqueIds([...(plan.sourceVocabularyRevisionIds||[]),tail.sourceVocabularyRevisionId]),sourceLayoutRevisionIds,adaptivePolicyVersion:tail.adaptivePolicyVersion||policy.version,contentEntries,physicalRoute,estimatedTiming,utilityScore:(Number(plan.utilityScore)||0)+(Number(tail.utilityScore)||0),explanation:{...H.plain(plan.explanation||{}),adaptationReason:reason,fidelity,generatedMuseumId:museumId}}};
}
module.exports={buildTail,composeRevision};
