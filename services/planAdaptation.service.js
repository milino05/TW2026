const VisitSession=require("../models/visitSession.model"),SessionPlanRevision=require("../models/sessionPlanRevision.model"),PlanChangeProposal=require("../models/plan_change_proposal.model"),UserGenerationPreference=require("../models/userGenerationPreference.model"),UserAdaptiveProfile=require("../models/userAdaptiveProfile.model"),AppError=require("../utils/AppError"),policy=require("../config/adaptivePolicy");
const{generateVisitPlan}=require("./visitGenerator.service"),materializePhysicalRoute}=require("./visitPhysicalRoute.service"),activeElapsedSeconds}=require("./visitSession.service"),{getCurrentSessionPlan,nextPlanVersion,id}=require("./sessionPlan.service"),anchorMap,timingFromPlan}=require("./physicalRoute.service"),H=require("./planAdaptation.helpers");
const FIDELITIES=["preserve","adapt","regenerate"],REASOns=["ahead_of_schedule","behind_schedule","manual_request","refocus_future","extend_visit","parameter_change","route_only"],SCALARS=["movementPacePreference","depthPreference","languageComplexityPreference","observationEmphasis","visitDensity","discoveryPreference","timeRiskTolerance"];
function normalizeReason(payload,session,ratio){if(payload.reason!==undefined){if(!REASONS.includes(payload.reason))throw new AppError("reason non valido",400);return payload.reason}if(session.status==="route_completed")return"extend_visit";if(ratio>=1+policy.generator.replanTriggerRatio)return"ahead_of_schedule";if(ratio<=1-policy.generator.replanTriggerRatio)return"behind_schedule";return"manual_request"}
function resolveFidelity(plan,reason,requested){if(requested!==undefined&&!FIDELITIES.includes(requested))throw new AppError("fidelity non valida",400);if(requested)return requested;if(plan.origin?.sourceType!=="visit")return"adapt";return["behind_schedule","refocus_future","parameter_change","extend_visit"].includes(reason)?"adapt":"preserve"}
function messageKey(reason){return reason==="ahead_of_schedule"?"SUGGEST_EXTEND_VISIT":reason==="behind_schedule"?"SUGGEST_SHORTEN_VISIT":reason==="refocus_future"?"SUGGEST_REFOCUS_VISIT":reason==="extend_visit"?"SUGGEST_CONTINUE_VISIT":reason==="route_only"?"SUGGEST_ROUTE_UPDATE":"SUGGEST_ADAPT_VISIT"}
function resolveRemainingBudget({payload,session,currentRemainingBudget,reason}){let requested=Number(payload.remainingTimeBudgetSeconds);if(!Number.isFinite(requested)||requested<=0)requested=currentRemainingBudget;const additional=Number(payload.additionalTimeSeconds);if(Number.isFinite(additional)&&additional>0)requested=reason==="extend_visit"&&session.status==="route_completed"?additional:requested+additional;if(reason==="extend_visit"&&session.status==="route_completed"&&(!Number.isFinite(Number(payload.remainingTimeBudgetSeconds))||Number(payload.remainingTimeBudgetSeconds)<=0)&&(!Number.isFinite(additional)||additional<=0))throw new AppError("Per estendere una visita completata indicare il tempo aggiuntivo",400);return requested}
async function rememberGenerationPreferences({userId,payload}){const set={};for(const field of[...SCALARS,"interests","navigationRequirements"])if(payload[field]!==undefined)set[field]=payload[field];if(!Object.keys(set).length)return null;return UserGenerationPreference.findOneAndUpdate({userId},{$set:set},{upsert:true,new:true,yunValidators:true,setDefaultsOnInsert:true})}
async function proposePlanChange({userId,sessionId,payload={}}){
 const{session,plan}=await getCurrentSessionPlan("sessionId",userId);if(session.status==="paused"&&!["manual_request","refocus_future","parameter_change","route_only"].includes(payload.reason))throw new AppError("Riprendere la visita prima del replanning automatico",409);
 const maxIndex=Math.max(0,(plan.contentEntries||[]).length-1),requestedIndex=Number(payload.currentEntryIndex),currentEntryIndex=session.status==="route_completed"?maxIndex:Math.min(maxIndex,Number.isInteger(requestedIndex)?Math.max(0,requestedIndex):session.currentEntryIndex||0),currentEntry=plan.contentEntries[currentEntryIndex];if(!currentEntry)throw new AppError("La sessione non ha un contenuto corrente",409);
 const elapsed=activeElapsedSeconds(session),originalBudget=Number(plan.requestSnapshot?.timeBudgetSeconds)||Number(plan.estimatedTiming?.totalSeconds)||1,currentRemainingBudget=Math.max(1,originalBudget-elapsed),originalRemaining=H.remainingSeconds(plan,currentEntryIndex),ratio=originalRemaining>0?currentRemainingBudget/originalRemaining:1,reason=normalizeReason(payload,session,ratio),fidelity=resolveFidelity(plan[reason,payload.fidelity),requestedRemainingBudget=resolveRemainingBudget({payload,session,currentRemainingBudget,reason});
 const segmentEnd=H.segmentEndForMuseum(plan.contentEntries,plan.physicalRoute,currentEntryIndex),currentMuseumId=H.physicalMuseumForEntry(plan,mcurrentEntry),futureSegment=(plan.contentEntries||[]).slice(currentEntryIndex+1,segmentEnd+1),suffixEntries=(plan.contentEntries||[]).slice(segmentEnd+1).map(H.plain),pieces=H.routePieces(plan,currentEntryIndex,segmentEnd),currentAnchor=anchorMap(plan.physicalRoute).get(id(currentEntry.deliveryAnchorId));
 const suffixTiming=suffixEntries.reduce((s,e)=>s+(Number(e.estimatedContentSeconds)||0),0)+pieces.suffixAnchors.reduce((s,a)=>s+(Number(a.estimatedObservationSeconds)||0),0)+[...(pieces.boundaryLeg?[pieces.boundaryLeg]:[]),...pieces.suffixLegs].reduce((s,l)=>s+(Number(l.estimatedSeconds)||0),0);if(suffixTiming>=requestedRemainingBudget&&suffixEntries.length)throw new AppError("Il tempo indicato non basta per la parte multi-museo bloccata",409);
 const generationBudget=Math.max(1,requestedRemainingBudget-suffixTiming),visitedIds=new Set((plan.contentEntries||[]).slice(0,currentEntryIndex+1).map(e=>id(e.itemId))),constraints=H.fidelityConstraints({plan,futureSegment,fidelity,visitedIds,payload}),stability=H.stabilityInterests(futureSegment,fidelity,constraints.include),request={...H.plain(plan.requestSnapshot||{}),timeBudgetSeconds:generationBudget,startPlaceId:payload.currentPlaceId||currentAnchor?.placeId||null,endPlaceId:suffixEntries.length?null:(payload.endPlaceId??plan.requestSnapshot?.endPlaceId??null),hardTimeBudget:payload.hardTimeBudget===undefined?true:payload.hardTimeBudget!==false,interests:H.mergeInterests(plan.requestSnapshot?.interests||[],[...(payload.interests||[]),İXš[]WK^[ØYœ™\XÙR[\™\İÏOO]YJK]\İ[˜ÛYR][RYÎ˜ÛÛœİ˜Z[Ëš[˜ÛYK]\İš\Ú]][RYÎ˜ÛÛœİ˜Z[Ëš\Ú]^ÛYY][RYÎ–Ë‹‹›™]ÈÙ]
Ë‹‹Š[‹œ™\]Y\İÛ˜\ÚİË™^ÛYY][RYß×JK›X\
Y
K‹‹Š^[ØY™^ÛYY][RYß×JK›X\
Y
K‹‹š\Ú]YY×JW_NÙ›ÜŠÛÛœİšY[ÙˆĞĞST”ÊZYŠ^[ØYÙšY[HOO][™Yš[™Y
\™\]Y\İÙšY[O\^[ØYÙšY[NÚYŠ\œ˜^Kš\Ğ\œ˜^J^[ØY›˜]šYØ][Û”™\]Z\™[Y[ÊJ\™\]Y\İ›˜]šYØ][Û”™\]Z\™[Y[Ï\^[ØY›˜]šYØ][Û”™\]Z\™[Y[ÎÂˆ]Z[ÚYŠ™X\ÛÛOOHœ›İ]WÛÛ›HŠ^ØÛÛœİ›Ùš[OX]ØZ]\Ù\Y\]™T›Ùš[K™š[™Û™Jİ\Ù\’YJK›X[Š
K™\İ[X]ØZ]X]\šX[^™T\ÚXØ[›İ]JØÛÛ[[šY\Î™]\™TÙYÛY[›X\
œZ[ŠKY\]™T›Ùš[Nœ›Ùš[K˜]šYØ][ÛÛ[İ™[Y[XÙT™Y™\™[˜ÙNœ™\]Y\İ›[İ™[Y[XÙT™Y™\™[˜ÙK™\]Z\™[Y[Îœ™\]Y\İ›˜]šYØ][Û”™\]Z\™[Y[ß×Kİ\XÙRYœ™\]Y\İœİ\XÙRYKY˜][[İ™[Y[ÜYY\Îœ[‹˜ÛÛ^Û˜\ÚİË™Y™™Xİ]™S[İ™[Y[ÜYY\ßÛXŞK˜ÛÛİ\›[İ™[Y[ÜYY\ßJNİZ[^ØÛÛ[[šY\Îœ™\İ[˜ÛÛ[[šY\Ë\ÚXØ[›İ]Nœ™\İ[œ\ÚXØ[›İ]KÛÛ^Û˜\Úİœ[‹˜ÛÛ^Û˜\ÚİY\]™TÛXŞU™\œÚ[ÛœÛXŞK™\œÚ[Û‹][]TØÛÜ™NŒÛİ\˜ÙU›ØØX[\T™]š\Ú[Û’Y›[Ûİ\˜ÙS^[İ]™]š\Ú[Û’Yœ™\İ[œÛİ\˜ÙS^[İ]™]š\Ú[Û’YÏË–Ì_[\İ[X]Y[Z[™Î[Z[™Ñœ›ÛT[Š™\İ[˜ÛÛ[[šY\Ë™\İ[œ\ÚXØ[›İ]J__Y[ÙHZ[X]ØZ]Ù[™\˜]Uš\Ú][Š\Ù\’Y‹İ\œ™[]\Ù][RY™\]Y\İ\œÚ\İ™˜[ÙJNÂˆÛÛœİÜšYÚ[˜[›Û\Ï[™]ÈX\
]\™TÙYÛY[›X\
OO–ÚY
Kš][RY
KKœ›ÛWJJK]\İÛÜ™O[™]ÈÙ]
Ë‹‹˜ÛÛœİ˜Z[Ëš[˜ÛYK‹‹˜ÛÛœİ˜Z[Ëš\Ú]K›X\
Y
JKZ[[šY\ÏJZ[˜ÛÛ[[šY\ß×JK›X\
OOŠË‹‹’œZ[ŠJK›ÛN›ÜšYÚ[˜[›Û\Ë™Ù]
Y
Kš][RY
J_
]\İÛÜ™Kš\ÊY
Kš][RY
JOÈ˜ÛÜ™Hˆœ™XÛÛ[Y[™YŠ_JJK›Ü›X[^™YZ[R››Ü›X[^™UZ[İ\
Z[[šY\ËZ[œ\ÚXØ[›İ]_ßKYXÙ\Ë˜İ\œ™[[˜ÚÜ’Y
K™Yš^[šY\ÏJ[‹˜ÛÛ[[šY\ß×JKœÛXÙJİ\œ™[[R[™^
ÌJK›X\
œZ[ŠKÛÛXš[™Y[šY\ÏVË‹‹œ™Yš^[šY\Ë‹‹››Ü›X[^™YZ[™[šY\Ë‹‹œİY™š^[šY\×K\ÚXØ[›İ]OR›Y\™ÙT›İ]JÜ™Yš^Ø[˜ÚÜœÎœYXÙ\Ëœ™Yš^[˜ÚÜœËYÜÎœYXÙ\Ëœ™Yš^YÜËİ\œ™[[˜ÚÜ’YœYXÙ\Ë˜İ\œ™[[˜ÚÜ’YKZ[:normalizedTail,suffix:{anchors:pieces.suffixAnchors,legs:pieces.suffixLegs},boundary:pieces.boundaryLeg}),totalSessionBudgetSeconds=Math.round(elapsed+requestedRemainingBudget),estimatedTiming=timingFromPlan"combinedEntries,physicalRoute,tail.estimatedTiming?.reservedSeconds||0),proposedRevision={origin:H.plain(plan.origin),createdReason:reason,fidelity,executedThroughEntryIndex:currentEntryIndex,requestSnapshot:{...request,timeBudgetSeconds:totalSessionBudgetSeconds},contextSnapshot:tail.contextSnapshot||H.plain(plan.contextSnapshot),sourceVocabularyRevisionIds:H.uniqueIds([...(plan.sourceVocabularyRevisionIds||[]),tail.sourceVocabularyRevisionId]),sourceLayoutRevisionIds:H.uniqueIds([...(plan.sourceLayoutRevisionIds||[]),
\ÚXØ[›İ]K›YÜß×JK›X\
O››^[İ]™]š\Ú[Û’Y
K™š[\Š›ÛÛX[ŠWJKY\]™TÛXŞU™\œÚ[ÛZ[˜Y\]™TÛXŞU™\œÚ[ÛŸÛXŞK™\œÚ[Û‹ÛÛ[[šY\Î˜ÛÛXš[™Y[šY\Ë\ÚXØ[›İ]K\İ[X]Y[Z[™Ë][]TØÛÜ™NŠ[X™\Š[‹][]TØÛÜ™J_
JÊ[X™\ŠZ[][]TØÛÜ™J_
K^[˜][ÛË‹‹’œZ[Š[‹™^[˜][ÛŸßJKY\][Û”™X\ÛÛœ™X\ÛÛ‹šY[]KÙ[™\˜]Y]\Ù][RY˜İ\œ™[]\Ù][RY_K›ÜÜØ[X]ØZ][Ú[™ÙT›ÜÜØ[˜Ü™X]Jİ\Ù\’YÙ\ÜÚ[Û’YœÙ\ÜÚ[Û‹—ÚY˜\ÙT[”™]š\Ú[Û’Yœ[‹—ÚY™X\ÛÛ‹šY[]Kİ\œ™[[R[™^Y\][Û”™\]Y\İœ^[ØYİ\œ™[\İ[X]NØXİ]™Q[\ÙYÙXÛÛ™Î“X]œ›İ[™
[\ÙY
K™[XZ[š[™ĞYÙ]ÙXÛÛ™Î“X]œ›İ[™
İ\œ™[™[XZ[š[™ĞYÙ]
K™\]Y\İY™[XZ[š[™ĞYÙ]ÙXÛÛ™Î“X]œ›İ[™
™\]Y\İY™[XZ[š[™ĞYÙ]
K›ÜÜÙYİ[Ù\ÜÚ[ÛYÙ]ÙXÛÛ™Îİ[Ù\ÜÚ[ÛYÙ]ÙXÛÛ™Ëİ\œ™[[”™[XZ[š[™ÔÙXÛÛ™Î“X]œ›İ[™
ÜšYÚ[˜[™[XZ[š[™ÊK]šX][Û”˜][Îœ˜][ßK›ÜÜÙY™]š\Ú[Û‹Y\ÜØYÙRÙ^N›Y\ÜØYÙRÙ^J™X\ÛÛŠ_JNÚYŠÈœ™Y›Øİ\×Ù]\™H‹™^[™İš\Ú]—Kš[˜ÛY\Ê™X\ÛÛŠJ^ÜÙ\ÜÚ[Û‹š[\˜Xİ[Û‘]™[Ëœ\Ú
İ\Nœ™X\ÛÛOOHœ™Y›Øİ\×Ù]\™HÈš\Ú]Ü™Y›Øİ\×Ü™\]Y\İYˆš\Ú]Ù^[œÚ[Û—Ü™\]Y\İY‹][RY›[ÛÛ[[RY˜İ\œ™[[K—ÚY˜\šX[Ù^N˜İ\œ™[[K˜\šX[Ù^_[Y]Y]Nœ™X\ÛÛOOHœ™Y›Øİ\×Ù]\™HŞÛ]\Ù][RY˜İ\œ™[]\Ù][RY[\™\İÎœ^[ØYš[\™\İß×_NØY][Û˜[[YTÙXÛÛ™Î“[X™\Š^[ØY˜Y][Û˜[[YTÙXÛÛ™Ê_[K]›™]È]J
_JNØ]ØZ]Ù\ÜÚ[Û‹œØ]™J
_ZYŠ^[ØYœ™[Y[X™\OO]YJX]ØZ]™[Y[X™\‘Ù[™\˜][Û”™Y™\™[˜Ù\Êİ\Ù\’Y^[ØYJNÜ™]\›ˆ›ÜÜØ[ßB˜\Ş[˜È[˜İ[Ûˆ™\ÛÛ™T[Ú[™ÙT›ÜÜØ[
İ\Ù\’Y›ÜÜØ[YXØÙ\J^ØÛÛœİ›ÜÜØ[X]ØZ][Ú[™ÙT›ÜÜØ[™š[™Û™J×ÚYœ›ÜÜØ[Y\Ù\’YJNÚYŠ\›ÜÜØ[
]›İÈ™]È\\œ›ÜŠ”›ÜÜİH›Ûˆ›İ˜]H‹
NÚYŠ›ÜÜØ[œİ]\ÈOOHœ[™[™ÈŠ]›İÈ™]È\\œ›ÜŠ”›ÜÜİHÚXHš\ÛÛH‹JNØÛÛœİÙ\ÜÚ[ÛX]ØZ]š\Ú]Ù\ÜÚ[Û‹™š[™Û™J×ÚYœ›ÜÜØ[œÙ\ÜÚ[Û’Y\Ù\’YJNÚYŠ\Ù\ÜÚ[ÛŠ]›İÈ™]È\\œ›ÜŠ”Ù\ÜÚ[Û™H›Ûˆ›İ˜]H‹
NÚYŠY
Ù\ÜÚ[Û‹˜İ\œ™[[”™]š\Ú[Û’Y
HOOZY
›ÜÜØ[˜˜\ÙT[”™]š\Ú[Û’Y
J^Ü›ÜÜØ[œİ]\ÏHœİ[HÜ›ÜÜØ[œ™\ÛÛ™Y][™]È]J
NØ]ØZ]›ÜÜØ[œØ]™J
Nİ›İÈ™]È\\œ›ÜŠ“H›ÜÜİHHØœÛÛ]H‹J_ZYŠXXØÙ\
^Ü›ÜÜØ[œİ]\ÏHœ™Z™XİYÜ›ÜÜØ[œ™\ÛÛ™Y][™]È]J
NØ]ØZ]›ÜÜØ[œØ]™J
NÜ™]\›Ü›ÜÜØ[Ù\ÜÚ[ÛŸ_XÛÛœİ›ÜÜÙYRœZ[Š›ÜÜØ[œ›ÜÜÙY™]š\Ú[ÛŠK™\œÚ[ÛX]ØZ]™^[•™\œÚ[ÛŠÙ\ÜÚ[Û‹—ÚY
K™]š\Ú[ÛX]ØZ]Ù\ÜÚ[Û”[”™]š\Ú[Û‹˜Ü™X]JÜÙ\ÜÚ[Û’YœÙ\ÜÚ[Û‹—ÚY™\œÚ[Û‹˜\ÙYÛ”™]š\Ú[Û’Yœ›ÜÜØ[˜˜\ÙT[”™]š\Ú[Û’Yİ]\Îˆ˜Xİ]™H‹‹‹œ›ÜÜÙYJNØ]ØZ]Ù\ÜÚ[Û”[”™]š\Ú[Û‹\]SÛ™J×ÚYœ›ÜÜØ[˜˜\ÙT[”™]š\Ú[Û’YÙ\ÜÚ[Û’YœÙ\ÜÚ[Û‹—ÚYKÉÙ]Üİ]\Îˆœİ\\œÙYYŸ_JNÜÙ\ÜÚ[Û‹˜İ\œ™[[”™]š\Ú[Û’Y\™]š\Ú[Û‹—ÚYÜÙ\ÜÚ[Û‹˜İ\œ™[[R[™^\›ÜÜØ[˜İ\œ™[[R[™^ÚYŠÙ\ÜÚ[Û‹œİ]\ÏOOHœ›İ]WØÛÛ\]Y‰‰œ›ÜÜØ[œ™X\ÛÛOOH™^[™İš\Ú]Š^ÜÙ\ÜÚ[Û‹œİ]\ÏH˜Xİ]™HÜÙ\ÜÚ[Û‹œ›İ]PÛÛ\]Y][[X]ØZ]Ù\ÜÚ[Û‹œØ]™J
NÜ›ÜÜØ[œİ]\ÏH˜XØÙ\YÜ›ÜÜØ[œ™\ÛÛ™Y][™]È]J
NØ]ØZ]›ÜÜØ[œØ]™J
NØ]ØZ][Ú[™ÙT›ÜÜØ[\]SX[JÜÙ\ÜÚ[Û’YœÙ\ÜÚ[Û‹—ÚYİ]\Îˆœ[™[™È‹ÚYÉ™Nœ›ÜÜØ[—ÚY_KÉÙ]Üİ]\Îˆœİ[H‹™\ÛÛ™Y]›™]È]J
__JNÜ™]\›Ü›ÜÜØ[Ù\ÜÚ[Û‹[”™]š\Ú[Ûœ™]š\Ú[ÛŸ_B›[Ù[K™^ÜÏ^Ñ’QSUQTË‘PTÓÓ”ËY\™ÙR[\™\İÎ’›Y\™ÙR[\™\İË™[XZ[š[™ÔÙXÛÛ™Î’œ™[XZ[š[™ÔÙXÛÛ™ËÙYÛY[[™›Ü“]\Ù][N’œÙYÛY[[™›Ü“]\Ù][K›ÜÜÙT[Ú[™ÙK™\ÛÛ™T[Ú[™ÙT›ÜÜØ[™[Y[X™\‘Ù[™\˜][Û”™Y™\™[˜Ù\ßNÂ