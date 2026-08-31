import { io, type Socket } from "socket.io-client";

export type SynchronizedRealtimeSubscription = {
  close(): void;
};

type PresenceEvent = { sessionId: string; userId: string; online: boolean };
type InvalidationEvent = { sessionId: string; runtimeVersion: number | null };

export function subscribeToSynchronizedVisit({
  sessionId,
  onInvalidated,
  onPresence,
  onPresenceSnapshot,
}: {
  sessionId: string;
  onInvalidated: (event: InvalidationEvent) => void;
  onPresence: (event: PresenceEvent) => void;
  onPresenceSnapshot: (onlineUserIds: string[]) => void;
}): SynchronizedRealtimeSubscription {
  const socket: Socket = io({ withCredentials: true });
  const subscribe = () => {
    socket.emit("synchronized:subscribe", { sessionId }, (result: { ok: boolean; onlineUserIds?: string[] }) => {
      if (result?.ok) onPresenceSnapshot(result.onlineUserIds || []);
    });
  };
  socket.on("connect", subscribe);
  socket.on("synchronized:invalidated", (event: InvalidationEvent) => {
    if (String(event.sessionId) === String(sessionId)) onInvalidated(event);
  });
  socket.on("synchronized:presence", (event: PresenceEvent) => {
    if (String(event.sessionId) === String(sessionId)) onPresence(event);
  });
  return {
    close() { socket.disconnect(); },
  };
}
