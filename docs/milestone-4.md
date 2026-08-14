# Milestone 4: Action Cards

Milestone 4 implements the complete initial Mystery Action Card system without beginning Mini-Game Challenges, tiebreakers, rematches, or deployment.

## Phase and deadline model

Each dealt round enters `action_choice` before `point_decisions`. Every active participant submits one Draw or Skip. The shared deadline is server-owned; after it expires, any participant may trigger a transaction that records automatic Skip for all unanswered players. Point-decision order does not exist until all choices and targeted effects resolve.

A player cannot know a random card before drawing. Draw first securely selects and persists the card. Non-targeted cards resolve in that transaction. Point Swipe enters `awaiting_target`, exposes its identity and eligible player IDs only to the owner, and receives a ten-second server deadline. The owner may submit one eligible target. After expiry, any participant may trigger uniform secure target selection. The draw cannot be cancelled, skipped, rejected, exchanged, saved, or redrawn.

Deadline processing remains activity-triggered for the MVP: a connected client observes an expired server timestamp and invokes the idempotent processor. There is no external scheduler in this milestone.

## Allowances and selection

Six- and eight-round matches allow two draws per player; ten-round matches allow three. Skip does not consume allowance, Draw consumes exactly one, and a player can draw at most once per round. Unused allowance has no value after match completion.

The private catalog contains 18 enabled cards. Positive weights total 40, negative weights 30, and unpredictable weights 30. Percentages are approximate weights over repeated selection, not guaranteed per match. Selection and every random branch use server cryptographic bytes. Database-owner-only transaction settings provide deterministic pgTAP outcomes; browser roles cannot execute those helpers.

## Catalog

| Category      | Card               | Authoritative effect                                                 |
| ------------- | ------------------ | -------------------------------------------------------------------- |
| Positive      | Score Boost        | Add 500 score                                                        |
| Positive      | Double Up          | Double the current point card                                        |
| Positive      | Point Swipe        | Owner chooses another active player; transfer up to 300 from target  |
| Positive      | Shield             | Block the next eligible targeted negative effect this round          |
| Positive      | Fresh Draw         | Replace the current point card from the secure point deck            |
| Positive      | Bonus Momentum     | Add 15% of score, rounded to nearest 50                              |
| Negative      | Point Penalty      | Lose up to 400                                                       |
| Negative      | Bad Move           | Halve current point card, rounded to nearest 50                      |
| Negative      | Forced Share       | Pay up to 300 to a securely selected eligible last-place player      |
| Negative      | Score Drop         | Lose 15% of score, rounded to nearest 50                             |
| Negative      | Empty Round        | Set current point card to zero                                       |
| Negative      | Leader Bonus       | Pay an eligible leader up to 300, or lose up to 150 when sole leader |
| Unpredictable | Double or Zero     | Secure equal-probability 0× or 2× point-card result                  |
| Unpredictable | Random Card Swap   | Swap current cards with a securely selected eligible participant     |
| Unpredictable | Shared Fate        | Securely select a player; independently add or remove 300 for each   |
| Unpredictable | Comeback Card      | Bottom half gains 500; top half loses up to 300                      |
| Unpredictable | Mystery Multiplier | Secure equal-probability 0×, 1×, or 2× point-card result             |
| Unpredictable | Reverse Swipe      | Secure player and direction; transfer up to 300                      |

“Up to” is the lesser of configured amount and available score. Scores are clamped at zero. Percentage calculations use the score at serial resolution time. Card modifiers use the current card value.

## Rounding and ranking

Nearest-50 rounding is half-up: add 25, divide by 50, floor, then multiply by 50. Thus 25 rounds to 50 and 24 rounds to 0.

Comeback ranking orders score descending, then immutable join order. Positions after `floor(player_count / 2)` are bottom half, so the middle player in an odd roster receives comeback treatment.

## Shields and privacy

Point Swipe is the only initial player-selected, shield-blockable targeted harm. A successful block stops the whole transfer, consumes the shield, and still consumes the drawer's card. Self-applied negative cards and unpredictable cards do not consume it. An unused shield is naturally scoped to its round and is absent from the next-round snapshot.

The owner receives card identity, description, category, target state, eligible target IDs, and private result. Others receive a public-safe event only. Fresh Draw and Random Card Swap public events never contain old or new card values. Realtime remains a private room-scoped invalidation hint; recovery always refetches the authoritative actor-specific snapshot.

## Migration and recovery

Migration `20260813030000_action_cards.sql` alters the phase/event enums, extends rounds/cards/ledger, creates normalized Action Card state and private audit relations, replaces the round initializer, and grants only public RPC execution plus owner-select policies.

For local recovery, keep Docker healthy, then run:

```bash
npm run db:start
npm run db:reset
npm run db:lint
npm run test:db
```

`db:reset` rebuilds Milestones 2–4 in order. Never repair a reset by weakening RLS, grants, constraints, authorization, or private schema boundaries. Hosted migration application is intentionally deferred to the deployment milestone.
