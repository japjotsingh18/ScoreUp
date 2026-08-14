import type { Metadata } from "next";
import { PageShell } from "../components/page-shell";
import { CreateGameForm } from "./create-game-form";

export const metadata: Metadata = { title: "Create a game" };

export default function CreatePage() {
  return (
    <PageShell
      eyebrow="YOU'RE CALLING THE SHOTS"
      title="BUILD YOUR ROOM"
      description="Pick the pace, invite your crew, and get ready to defend the top spot. You can change nothing once the match begins."
    >
      <CreateGameForm />
    </PageShell>
  );
}
