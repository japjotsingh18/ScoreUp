import type { Metadata } from "next";
import { PageShell } from "../components/page-shell";
import { JoinGameForm } from "./join-game-form";

export const metadata: Metadata = { title: "Join a game" };

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const code = (await searchParams).code;
  return (
    <PageShell
      eyebrow="YOUR CREW IS WAITING"
      title="ENTER THE ROOM"
      description="Grab the room code from your host, choose the name the leaderboard will remember, and step into the game."
    >
      <JoinGameForm initialCode={typeof code === "string" ? code : ""} />
    </PageShell>
  );
}
