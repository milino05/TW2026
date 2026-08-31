const VisitRevisionV2 = require("../models/visitRevisionV2.model");
const SynchronizedVisitQuizAttempt = require("../models/synchronizedVisitQuizAttempt.model");
const SynchronizedVisitMembership = require("../models/synchronizedVisitMembership.model");
const User = require("../models/user");
const AppError = require("../utils/AppError");
const { loadMembershipRuntime } = require("./synchronizedVisitSession.service");

function id(value) { return String(value?._id || value || ""); }
function pointsForQuestion(question) {
  return question?.points == null ? 1 : Number(question.points);
}

async function loadQuizRuntime({ synchronizedSessionId, userId }) {
  const runtime = await loadMembershipRuntime({ synchronizedSessionId, userId, allowFinished: true });
  const revision = await VisitRevisionV2.findById(runtime.group.visitRevisionId).select("quiz.questions").lean();
  if (!revision) throw new AppError("Snapshot del quiz non disponibile", 409);
  return { ...runtime, questions: revision.quiz?.questions || [] };
}

function normalizeSubmittedAnswers(rawAnswers, questions) {
  if (!Array.isArray(rawAnswers)) throw new AppError("Le risposte del quiz sono obbligatorie", 400, [{ field: "answers", code: "REQUIRED" }]);
  const submittedByQuestion = new Map();
  for (const answer of rawAnswers) {
    const questionId = id(answer?.questionId);
    const selectedOptionIndex = Number(answer?.selectedOptionIndex);
    if (!questionId || submittedByQuestion.has(questionId)) throw new AppError("Ogni domanda deve avere una sola risposta", 400, [{ field: "answers", code: "INVALID_QUIZ_ANSWERS" }]);
    submittedByQuestion.set(questionId, selectedOptionIndex);
  }
  return questions.map((question, index) => {
    const questionId = id(question._id);
    const selectedOptionIndex = submittedByQuestion.get(questionId);
    if (!Number.isInteger(selectedOptionIndex) || selectedOptionIndex < 0 || selectedOptionIndex >= (question.options || []).length) {
      throw new AppError(`Scegli una risposta per la domanda ${index + 1}`, 400, [{ field: `answers[${index}]`, code: "QUIZ_ANSWER_REQUIRED" }]);
    }
    const availablePoints = pointsForQuestion(question);
    const correct = selectedOptionIndex === Number(question.correctOptionIndex);
    return {
      questionId: question._id,
      selectedOptionIndex,
      correct,
      pointsAwarded: correct ? availablePoints : 0,
      answeredAt: new Date(),
    };
  });
}

async function submitSynchronizedQuiz({ synchronizedSessionId, userId, answers }) {
  const runtime = await loadQuizRuntime({ synchronizedSessionId, userId });
  if (runtime.membership.role !== "participant") throw new AppError("Il quiz deve essere compilato da un partecipante", 403);
  if (runtime.group.status !== "quiz") throw new AppError("Il quiz non è aperto", 409, [{ code: "SYNCHRONIZED_QUIZ_NOT_ACTIVE" }]);
  if (!runtime.questions.length) throw new AppError("Il quiz non contiene domande", 409);
  const existing = await SynchronizedVisitQuizAttempt.findOne({ synchronizedSessionId, userId, attemptNumber: 1 });
  if (existing) throw new AppError("Hai già inviato il quiz", 409, [{ code: "SYNCHRONIZED_QUIZ_ALREADY_SUBMITTED" }]);
  const normalizedAnswers = normalizeSubmittedAnswers(answers, runtime.questions);
  const maxScore = runtime.questions.reduce((sum, question) => sum + pointsForQuestion(question), 0);
  const score = normalizedAnswers.reduce((sum, answer) => sum + answer.pointsAwarded, 0);
  return SynchronizedVisitQuizAttempt.create({
    synchronizedSessionId,
    membershipId: runtime.membership._id,
    userId,
    attemptNumber: 1,
    answers: normalizedAnswers,
    score,
    maxScore,
    submittedAt: new Date(),
  });
}

async function participantQuizProjection({ synchronizedSessionId, userId }) {
  const runtime = await loadQuizRuntime({ synchronizedSessionId, userId });
  if (runtime.membership.role === "host") {
    const [memberships, attempts] = await Promise.all([
      SynchronizedVisitMembership.find({ synchronizedSessionId, role: "participant", status: { $ne: "removed" } }).sort({ joinedAt: 1 }).lean(),
      SynchronizedVisitQuizAttempt.find({ synchronizedSessionId, attemptNumber: 1 }).lean(),
    ]);
    const users = await User.find({ _id: { $in: memberships.map((entry) => entry.userId) } }).select("username").lean();
    const userById = new Map(users.map((entry) => [id(entry._id), entry]));
    const attemptByUserId = new Map(attempts.map((entry) => [id(entry.userId), entry]));
    return {
      role: "host",
      status: runtime.group.status,
      questions: runtime.questions.map((question) => ({ id: question._id, question: question.question, points: question.points ?? null })),
      submittedCount: attempts.length,
      participantCount: memberships.length,
      results: memberships.map((membership) => {
        const attempt = attemptByUserId.get(id(membership.userId));
        return {
          userId: membership.userId,
          username: userById.get(id(membership.userId))?.username || "Partecipante",
          status: attempt ? "submitted" : "waiting",
          score: attempt?.score ?? null,
          maxScore: attempt?.maxScore ?? null,
          submittedAt: attempt?.submittedAt || null,
          evaluation: attempt?.evaluation || null,
        };
      }),
    };
  }
  const attempt = await SynchronizedVisitQuizAttempt.findOne({ synchronizedSessionId, userId, attemptNumber: 1 }).lean();
  return {
    role: "participant",
    status: runtime.group.status,
    questions: runtime.questions.map((question) => ({
      id: question._id,
      question: question.question,
      options: question.options || [],
      points: question.points ?? null,
    })),
    attempt: attempt ? {
      status: attempt.status,
      score: attempt.score,
      maxScore: attempt.maxScore,
      answers: attempt.answers.map((answer) => ({
        questionId: answer.questionId,
        selectedOptionIndex: answer.selectedOptionIndex,
        correct: answer.correct,
        pointsAwarded: answer.pointsAwarded,
      })),
      submittedAt: attempt.submittedAt,
      evaluation: attempt.evaluation,
    } : null,
  };
}

async function confirmQuizEvaluation({ synchronizedSessionId, userId, participantUserId, value }) {
  const runtime = await loadQuizRuntime({ synchronizedSessionId, userId });
  if (runtime.membership.role !== "host") throw new AppError("Operazione riservata alla guida", 403);
  const attempt = await SynchronizedVisitQuizAttempt.findOneAndUpdate(
    { synchronizedSessionId, userId: participantUserId, status: "submitted" },
    { $set: { evaluation: { confirmedByHost: true, value: String(value || "").trim() || null, confirmedAt: new Date(), confirmedBy: userId } } },
    { new: true, runValidators: true },
  );
  if (!attempt) throw new AppError("Risultato del partecipante non disponibile", 404);
  return attempt;
}

module.exports = {
  normalizeSubmittedAnswers,
  submitSynchronizedQuiz,
  participantQuizProjection,
  confirmQuizEvaluation,
};
