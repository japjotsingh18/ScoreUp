import type { Metadata } from "next";
import { LobbyClient } from "./lobby-client";

export const metadata: Metadata = { title: "Game lobby" };

export default async function LobbyPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string | string[] }>;
}) {
  const room = (await searchParams).room;
  return <LobbyClient roomId={typeof room === "string" ? room : null} />;
}
