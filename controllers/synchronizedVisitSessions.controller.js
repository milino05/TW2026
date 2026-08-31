const service = require("../services/synchronizedVisitSession.service");
const quiz = require("../services/synchronizedVisitQuiz.service");

async function join(req, res, next) {
  try {
    const joined = await service.joinSynchronizedVisitSession({
      userId: req.user._id,
      alias: req.body?.joinAlias,
    });
    const projection = await service.projectSynchronizedVisitSession({
      synchronizedSessionId: joined.synchronizedSession._id,
      userId: req.user._id,
    });
    require("../services/synchronizedVisitRealtime.service").notifySynchronizedVisitChanged({
      synchronizedSessionId: joined.synchronizedSession._id,
      runtimeVersion: joined.synchronizedSession.runtimeVersion,
    });
    res.status(joined.rejoined ? 200 : 201).json({ ...projection, rejoined: joined.rejoined });
  } catch (error) { next(error); }
}

async function current(req, res, next) {
  try {
    res.json(await service.projectSynchronizedVisitSession({
      synchronizedSessionId: req.params.synchronizedSessionId,
      userId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function quizProjection(req, res, next) {
  try {
    res.json({ quiz: await quiz.participantQuizProjection({
      synchronizedSessionId: req.params.synchronizedSessionId,
      userId: req.user._id,
    }) });
  } catch (error) { next(error); }
}

async function confirmEvaluation(req, res, next) {
  try {
    const attempt = await quiz.confirmQuizEvaluation({
      synchronizedSessionId: req.params.synchronizedSessionId,
      userId: req.user._id,
      participantUserId: req.params.participantUserId,
      value: req.body?.value,
    });
    require("../services/synchronizedVisitRealtime.service").notifySynchronizedVisitChanged({
      synchronizedSessionId: req.params.synchronizedSessionId,
      runtimeVersion: null,
    });
    res.json({ evaluation: attempt.evaluation });
  } catch (error) { next(error); }
}

module.exports = { join, current, quizProjection, confirmEvaluation };
