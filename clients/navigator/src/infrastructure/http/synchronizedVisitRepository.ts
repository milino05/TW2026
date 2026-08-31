import { apiClient } from "./apiClient";

export interface SynchronizedParticipant {
  userId: string;
  username: string;
  role: "host" | "participant";
  status: "active" | "removed" | "completed";
  joinedAt: string;
  visitSessionId: string;
  experience?: {
    status: "not_started" | "in_progress" | "completed";
    completionRatio: number;
    personalAdaptationActive: boolean;
    lastActivityAt: string | null;
  };
}

export type SynchronizedQuizProjection = {
  role: "participant";
  status: string;
  questions: Array<{ id: string; question: string; options: string[]; points: number | null }>;
  attempt: null | {
    status: "submitted";
    score: number;
    maxScore: number;
    answers: Array<{ questionId: string; selectedOptionIndex: number; correct: boolean; pointsAwarded: number }>;
    submittedAt: string;
    evaluation: { confirmedByHost: boolean; value: string | null };
  };
} | {
  role: "host";
  status: string;
  questions: Array<{ id: string; question: string; points: number | null }>;
  submittedCount: number;
  participantCount: number;
  results: Array<{
    userId: string;
    username: string;
    status: "submitted" | "waiting";
    score: number | null;
    maxScore: number | null;
    submittedAt: string | null;
    evaluation: null | { confirmedByHost: boolean; value: string | null };
  }>;
};

export interface SynchronizedVisitProjection {
  synchronizedSession: {
    id: string;
    visitId: string;
    visitRevisionId: string;
    title: string;
    joinAlias: string;
    status: "lobby" | "active" | "quiz" | "completed" | "cancelled";
    currentEntryIndex: number;
    contentEntryCount: number;
    runtimeVersion: number;
    playback: {
      state: "idle" | "playing" | "paused";
      contentEntryId: string | null;
      commandVersion: number;
      changedAt: string | null;
    };
    participantCount: number;
    quizQuestionCount: number;
  };
  membership: {
    id: string;
    role: "host" | "participant";
    status: "active" | "removed" | "completed";
    visitSessionId: string;
    joinedAt: string;
  };
  participants: SynchronizedParticipant[] | null;
  rejoined?: boolean;
}

export const synchronizedVisitRepository = {
  join(joinAlias: string) {
    return apiClient.request<SynchronizedVisitProjection>("/v2/synchronized-visit-sessions/join", {
      method: "POST",
      body: JSON.stringify({ joinAlias }),
    });
  },
  current(synchronizedSessionId: string) {
    return apiClient.request<SynchronizedVisitProjection>(
      `/v2/synchronized-visit-sessions/${encodeURIComponent(synchronizedSessionId)}`,
    );
  },
  async quiz(synchronizedSessionId: string) {
    const response = await apiClient.request<{ quiz: SynchronizedQuizProjection }>(
      `/v2/synchronized-visit-sessions/${encodeURIComponent(synchronizedSessionId)}/quiz`,
    );
    return response.quiz;
  },
  confirmEvaluation(synchronizedSessionId: string, participantUserId: string, value: string) {
    return apiClient.request<{ evaluation: { confirmedByHost: boolean; value: string | null } }>(
      `/v2/synchronized-visit-sessions/${encodeURIComponent(synchronizedSessionId)}/quiz-results/${encodeURIComponent(participantUserId)}/evaluation`,
      { method: "PATCH", body: JSON.stringify({ value }) },
    );
  },
};
