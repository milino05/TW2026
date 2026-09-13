import { io, type Socket } from "socket.io-client";

export type SynchronizedParticipantActivity = {
  activity: "active" | "inactive";
  mode: "reading" | "audio" | null;
};

export type SynchronizedParticipantPresence = SynchronizedParticipantActivity & {
  sessionId?: string;
  userId: string;
  online: boolean;
  changedAt: string | null;
};

export type SynchronizedRealtimeSubscription = {
  setParticipantActivity(activity: SynchronizedParticipantActivity): void;
  close(): void;
};

type InvalidationEvent = { sessionId: string; runtimeVersion: number | null };

export function subscribeToSynchronizedVisit({
  sessionId,
  onInvalidated,
  onPresence,
  onPresenceSnapshot,
}: {
  sessionId: string;
  onInvalidated: (event: InvalidationEvent) => void;
  onPresence: (event: SynchronizedParticipantPresence) => void;
  onPresenceSnapshot: (presence: SynchronizedParticipantPresence[]) => void;
}): SynchronizedRealtimeSubscription {
  const socket: Socket = io({ withCredentials: true });
  let subscribed = false;
  let latestActivity: SynchronizedParticipantActivity | null = null;

  const emitLatestActivity = () => {
    if (!subscribed || !latestActivity) return;
    socket.emit("synchronized:activity", { sessionId, ...latestActivity });
  };

  const subscribe = () => {
    subscribed = false;
    socket.emit("synchronized:subscribe", { sessionId }, (result: {
      ok: boolean;
      onlineUserIds?: string[];
      presence?: SynchronizedParticipantPresence[];
    }) => {
      if (!result?.ok) return;
      subscribed = true;
      const snapshot = result.presence || (result.onlineUserIds || []).map((userId) => ({
        userId,
        online: true,
        activity: "inactive" as const,
        mode: null,
        changedAt: null,
      }));
      onPresenceSnapshot(snapshot);
      emitLatestActivity();
    });
  };

  socket.on("connect", subscribe);
  socket.on("disconnect", () => { subscribed = false; });
  socket.on("synchronized:invalidated", (event: InvalidationEvent) => {
    if (String(event.sessionId) === String(sessionId)) onInvalidated(event);
  });
  socket.on("synchronized:presence", (event: SynchronizedParticipantPresence) => {
    if (String(event.sessionId) === String(sessionId)) onPresence(event);
  });

  return {
    setParticipantActivity(activity) {
      latestActivity = activity;
      emitLatestActivity();
    },
    close() {
      subscribed = false;
      socket.disconnect();
    },
  };
}
