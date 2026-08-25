import type { ActionDrawSnapshot, MatchPlayer } from "./contracts";

type ResultPlayer = Pick<MatchPlayer, "id" | "displayName">;

function numberValue(result: Record<string, unknown>, key: string) {
  const value = result[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function playerName(result: Record<string, unknown>, players: ResultPlayer[]) {
  const targetId = result.targetPlayerId;
  if (typeof targetId !== "string") return "another player";
  return (
    players.find((player) => player.id === targetId)?.displayName ??
    "another player"
  );
}

function points(value: number) {
  return `${Math.abs(value).toLocaleString()} point${Math.abs(value) === 1 ? "" : "s"}`;
}

function scoreChange(value: number) {
  if (value > 0) return `You gained ${points(value)}.`;
  if (value < 0) return `You lost ${points(value)}.`;
  return "Your score did not change.";
}

function playerScoreChange(name: string, value: number) {
  if (value > 0) return `${name} gained ${points(value)}.`;
  if (value < 0) return `${name} lost ${points(value)}.`;
  return `${name}'s score did not change.`;
}

/**
 * Turns the authoritative result saved by the database into a complete,
 * card-specific explanation for the player who drew the card.
 */
export function actionResultMessages(
  draw: ActionDrawSnapshot,
  players: ResultPlayer[],
) {
  const result = { ...draw.publicResult, ...draw.privateResult };
  const target = playerName(result, players);
  const transferred = numberValue(result, "pointsTransferred");
  const changed = numberValue(result, "pointsChanged");
  const newCardValue = numberValue(result, "newCardValue");

  switch (draw.cardCode) {
    case "score_boost":
      return [`Score Boost worked: ${scoreChange(changed)}`];
    case "double_up":
      return [
        `Double Up worked: your point card is now ${newCardValue.toLocaleString()}.`,
      ];
    case "point_swipe":
      return result.blocked === true
        ? [`${target}'s shield blocked your Point Swipe. No points moved.`]
        : transferred > 0
          ? [`You took ${points(transferred)} from ${target}.`]
          : [`${target} had no points available to swipe. No points moved.`];
    case "shield":
      return [
        "Your shield is active and will block one eligible attack this round.",
      ];
    case "fresh_draw": {
      const oldCardValue = numberValue(result, "oldCardValue");
      return [
        `Fresh Draw replaced your ${oldCardValue.toLocaleString()} point card with ${newCardValue.toLocaleString()}.`,
      ];
    }
    case "bonus_momentum":
      return [`Bonus Momentum worked: ${scoreChange(changed)}`];
    case "point_penalty":
      return [`Point Penalty applied: ${scoreChange(changed)}`];
    case "bad_move":
      return [
        `Bad Move halved your point card. It is now ${newCardValue.toLocaleString()}.`,
      ];
    case "forced_share":
      return transferred > 0
        ? [`You gave ${points(transferred)} to ${target}.`]
        : ["You had no points available to share. No points moved."];
    case "score_drop":
      return [`Score Drop applied: ${scoreChange(changed)}`];
    case "empty_round":
      return ["Empty Round set your point card to 0 for this round."];
    case "leader_bonus": {
      const drawerChange = numberValue(result, "drawerChange");
      if (typeof result.targetPlayerId === "string" && transferred > 0)
        return [`You gave ${points(transferred)} to ${target}.`];
      if (drawerChange < 0)
        return [
          `You were the sole leader, so you lost ${points(drawerChange)}.`,
        ];
      return [
        "No eligible leader could receive points. Your score did not change.",
      ];
    }
    case "double_or_zero": {
      const multiplier = numberValue(result, "multiplier");
      return [
        `Double or Zero rolled ${multiplier}×. Your point card is now ${newCardValue.toLocaleString()}.`,
      ];
    }
    case "random_card_swap":
      return result.cardsSwapped === true
        ? [
            `You swapped point cards with ${target}. Your card is now ${newCardValue.toLocaleString()}.`,
          ]
        : [
            "No other unresolved point card was available, so no cards were swapped.",
          ];
    case "shared_fate": {
      const drawerChange = numberValue(result, "drawerChange");
      const targetChange = numberValue(result, "targetChange");
      return [
        `${playerScoreChange("You", drawerChange)} ${playerScoreChange(target, targetChange)}`,
      ];
    }
    case "comeback_card":
      return result.half === "bottom"
        ? [`Bottom-half comeback bonus: ${scoreChange(changed)}`]
        : [`Top-half comeback penalty: ${scoreChange(changed)}`];
    case "mystery_multiplier": {
      const multiplier = numberValue(result, "multiplier");
      return [
        `Mystery Multiplier rolled ${multiplier}×. Your point card is now ${newCardValue.toLocaleString()}.`,
      ];
    }
    case "reverse_swipe":
      if (transferred === 0)
        return ["No eligible player had points available, so no points moved."];
      return result.direction === "to_drawer"
        ? [`You took ${points(transferred)} from ${target}.`]
        : [`You gave ${points(transferred)} to ${target}.`];
  }
}
