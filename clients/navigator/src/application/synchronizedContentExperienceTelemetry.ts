import type { Router } from "vue-router";
import { browserTts } from "../capabilities/browserTts";
import type { TextToSpeechLifecycleEvent } from "../capabilities";
import { sessionRepository } from "../infrastructure/http/sessionRepository";
import { synchronizedVisitRepository } from "../infrastructure/http/synchronizedVisitRepository";

type ExperienceContext = {
  visitSessionId: string;
  contentEntryId: string;
  contentSeconds: number;
};

function normalizedSeconds(value: unknown) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
}

async function resolveParticipantExperienceContext(router: Router): Promise<ExperienceContext | null> {
  const route = router.currentRoute.value;
  if (route.name !== "together-session") return null;
  const synchronizedSessionId = String(route.params.synchronizedSessionId || "");
  if (!synchronizedSessionId) return null;

  const group = await synchronizedVisitRepository.current(synchronizedSessionId);
  if (group.membership.role !== "participant" || group.synchronizedSession.status !== "active") return null;

  const runtime = await sessionRepository.current(group.membership.visitSessionId);
  if (runtime.synchronization?.role !== "participant" || !runtime.current) return null;

  return {
    visitSessionId: group.membership.visitSessionId,
    contentEntryId: runtime.current.contentEntryId,
    contentSeconds: normalizedSeconds(runtime.current.presentation.estimatedContentSeconds),
  };
}

async function reportExperience(
  context: ExperienceContext,
  { activeSeconds, completed }: { activeSeconds: number; completed: boolean },
) {
  const experiencedSeconds = normalizedSeconds(activeSeconds);
  const completionRatio = completed
    ? 1
    : context.contentSeconds > 0
      ? Math.min(0.94, experiencedSeconds / context.contentSeconds)
      : 0;

  await sessionRepository.recordContentExperience(context.visitSessionId, {
    contentEntryId: context.contentEntryId,
    contentSeconds: context.contentSeconds,
    experiencedSeconds,
    completionRatio,
  });
}

export function installSynchronizedContentExperienceTelemetry(router: Router) {
  let activeContext: ExperienceContext | null = null;
  let reporting = Promise.resolve();

  async function handle(event: TextToSpeechLifecycleEvent) {
    if (event.type === "started") {
      activeContext = await resolveParticipantExperienceContext(router);
      if (activeContext) {
        await reportExperience(activeContext, { activeSeconds: 0, completed: false });
      }
      return;
    }

    if (!activeContext || event.type === "resumed") return;

    if (event.type === "paused") {
      await reportExperience(activeContext, { activeSeconds: event.activeSeconds, completed: false });
      return;
    }

    const context = activeContext;
    activeContext = null;
    await reportExperience(context, {
      activeSeconds: event.activeSeconds,
      completed: event.type === "completed",
    });
  }

  return browserTts.subscribeLifecycle((event) => {
    // Serializzare gli eventi evita che uno start lento arrivi dopo completion/stop
    // e diventi erroneamente l'ultima esperienza osservata dal docente.
    reporting = reporting
      .catch(() => {})
      .then(() => handle(event))
      .catch(() => {
        // Telemetria best-effort: un errore di rete non deve interrompere la visita.
      });
  });
}
