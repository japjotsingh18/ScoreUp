import type { Metadata } from "next";
import { GameClient } from "./game-client";

export const metadata: Metadata = { title: "Core game" };

export default async function GamePage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string | string[] }>;
}) {
  const room = (await searchParams).room;
  return <GameClient roomId={typeof room === "string" ? room : null} />;
}
