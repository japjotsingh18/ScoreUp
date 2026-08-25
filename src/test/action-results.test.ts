import { describe, expect, it } from "vitest";
import { actionResultMessages } from "../game/core/action-results";
import type {
  ActionCardCode,
  ActionDrawSnapshot,
} from "../game/core/contracts";

const players = [
  { id: "player-self", displayName: "You" },
  { id: "player-target", displayName: "Riley" },
];

function draw(
  cardCode: ActionCardCode,
  publicResult: Record<string, unknown>,
  privateResult: Record<string, unknown> = {},
): ActionDrawSnapshot {
  return {
    id: "action-draw",
    cardCode,
    displayName: cardCode,
    category: "unpredictable",
    description: "",
    status: "resolved",
    targetPlayerId: null,
    targetDeadline: null,
    eligibleTargetIds: [],
    privateResult,
    publicResult,
    drawnAt: "2026-08-24T00:00:00.000Z",
    resolvedAt: "2026-08-24T00:00:01.000Z",
  };
}

const resolvedCards: Array<{
  card: ActionDrawSnapshot;
  expected: string;
}> = [
  {
    card: draw("score_boost", { pointsChanged: 500 }),
    expected: "Score Boost worked: You gained 500 points.",
  },
  {
    card: draw("double_up", { cardModified: true }, { newCardValue: 1_000 }),
    expected: "Double Up worked: your point card is now 1,000.",
  },
  {
    card: draw("point_swipe", {
      targetPlayerId: "player-target",
      blocked: false,
      pointsTransferred: 300,
    }),
    expected: "You took 300 points from Riley.",
  },
  {
    card: draw("shield", { shieldApplied: true }, { shieldActive: true }),
    expected:
      "Your shield is active and will block one eligible attack this round.",
  },
  {
    card: draw(
      "fresh_draw",
      { cardReplaced: true },
      { oldCardValue: 250, newCardValue: 750 },
    ),
    expected: "Fresh Draw replaced your 250 point card with 750.",
  },
  {
    card: draw("bonus_momentum", { pointsChanged: 150 }),
    expected: "Bonus Momentum worked: You gained 150 points.",
  },
  {
    card: draw("point_penalty", { pointsChanged: -400 }),
    expected: "Point Penalty applied: You lost 400 points.",
  },
  {
    card: draw("bad_move", { cardModified: true }, { newCardValue: 250 }),
    expected: "Bad Move halved your point card. It is now 250.",
  },
  {
    card: draw("forced_share", {
      targetPlayerId: "player-target",
      pointsTransferred: 300,
    }),
    expected: "You gave 300 points to Riley.",
  },
  {
    card: draw("score_drop", { pointsChanged: -150 }),
    expected: "Score Drop applied: You lost 150 points.",
  },
  {
    card: draw("empty_round", { cardModified: true }, { newCardValue: 0 }),
    expected: "Empty Round set your point card to 0 for this round.",
  },
  {
    card: draw("leader_bonus", {
      targetPlayerId: null,
      pointsTransferred: 150,
      drawerChange: -150,
    }),
    expected: "You were the sole leader, so you lost 150 points.",
  },
  {
    card: draw(
      "double_or_zero",
      { multiplier: 0, cardModified: true },
      { multiplier: 0, newCardValue: 0 },
    ),
    expected: "Double or Zero rolled 0×. Your point card is now 0.",
  },
  {
    card: draw(
      "random_card_swap",
      { targetPlayerId: "player-target", cardsSwapped: true },
      { targetPlayerId: "player-target", newCardValue: 250 },
    ),
    expected: "You swapped point cards with Riley. Your card is now 250.",
  },
  {
    card: draw("shared_fate", {
      targetPlayerId: "player-target",
      drawerChange: -300,
      targetChange: 300,
    }),
    expected: "You lost 300 points. Riley gained 300 points.",
  },
  {
    card: draw("comeback_card", {
      half: "bottom",
      pointsChanged: 500,
    }),
    expected: "Bottom-half comeback bonus: You gained 500 points.",
  },
  {
    card: draw(
      "mystery_multiplier",
      { multiplier: 2, cardModified: true },
      { multiplier: 2, newCardValue: 1_000 },
    ),
    expected: "Mystery Multiplier rolled 2×. Your point card is now 1,000.",
  },
  {
    card: draw("reverse_swipe", {
      targetPlayerId: "player-target",
      direction: "to_target",
      pointsTransferred: 300,
    }),
    expected: "You gave 300 points to Riley.",
  },
];

describe("actionResultMessages", () => {
  it.each(resolvedCards)(
    "explains the $card.cardCode result",
    ({ card, expected }) => {
      const messages = actionResultMessages(card, players);

      expect(messages).toEqual([expected]);
      expect(messages.join(" ")).not.toMatch(
        /server applied|resolved securely/i,
      );
    },
  );

  it("explains a shielded swipe with the target name", () => {
    const card = draw("point_swipe", {
      targetPlayerId: "player-target",
      blocked: true,
      pointsTransferred: 0,
    });

    expect(actionResultMessages(card, players)).toEqual([
      "Riley's shield blocked your Point Swipe. No points moved.",
    ]);
  });

  it("explains a successful leader transfer", () => {
    const card = draw("leader_bonus", {
      targetPlayerId: "player-target",
      pointsTransferred: 300,
      drawerChange: -300,
    });

    expect(actionResultMessages(card, players)).toEqual([
      "You gave 300 points to Riley.",
    ]);
  });
});
