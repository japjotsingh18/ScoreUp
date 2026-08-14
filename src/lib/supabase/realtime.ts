import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

export type RealtimeConnectionState =
  "connecting" | "connected" | "reconnecting" | "error";

export function subscribeToLobby(
  client: SupabaseClient,
  roomId: string,
  onInvalidate: () => void,
  onStatus: (status: RealtimeConnectionState) => void,
): () => void {
  let disposed = false;
  let channel: RealtimeChannel | null = null;
  onStatus("connecting");

  void client.realtime
    .setAuth()
    .then(() => {
      if (disposed) return;
      channel = client
        .channel(`room:${roomId}:lobby`, { config: { private: true } })
        .on("broadcast", { event: "lobby_changed" }, onInvalidate)
        .subscribe((status) => {
          if (disposed) return;
          if (status === "SUBSCRIBED") {
            onStatus("connected");
            onInvalidate();
          } else if (status === "CHANNEL_ERROR") onStatus("error");
          else if (status === "TIMED_OUT" || status === "CLOSED")
            onStatus("reconnecting");
        });
    })
    .catch(() => {
      if (!disposed) onStatus("error");
    });

  return () => {
    disposed = true;
    if (channel) void client.removeChannel(channel);
  };
}
