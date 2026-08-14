import type {
  MemorySequenceSpecification,
  MiniGameStakeType,
  StopBarSpecification,
} from "../core/contracts";

export function previewMatchedStake(
  challengerScore: number,
  opponentScore: number,
  stakeType: MiniGameStakeType,
) {
  const matchedLimit = Math.max(0, Math.min(challengerScore, opponentScore));
  const stakePerPlayer =
    stakeType === "all" ? matchedLimit : Math.floor(matchedLimit / 2 / 50) * 50;
  return { stakePerPlayer, pot: stakePerPlayer * 2 };
}

export function stopBarPosition(
  specification: StopBarSpecification,
  elapsedMs: number,
) {
  const travel = (elapsedMs / 1000) * specification.markerSpeed;
  const initial = specification.initialDirection === 1 ? 0 : 1;
  const raw = initial + specification.initialDirection * travel;
  const wrapped = ((raw % 2) + 2) % 2;
  return wrapped <= 1 ? wrapped : 2 - wrapped;
}

export function correctConsecutiveSymbols(
  specification: MemorySequenceSpecification,
  submitted: string[],
) {
  let correct = 0;
  for (let index = 0; index < submitted.length; index += 1) {
    if (submitted[index] !== specification.sequence[index]) break;
    correct += 1;
  }
  return correct;
}

export function differentSymbolAdjustedTime(
  elapsedMs: number,
  incorrectTaps: number,
  penaltyMs: number,
) {
  return elapsedMs + incorrectTaps * penaltyMs;
}
