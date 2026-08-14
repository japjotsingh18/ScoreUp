import { describe, expect, it } from "vitest";
import type { MemorySequenceSpecification } from "../game/core/contracts";
import {
  correctConsecutiveSymbols,
  differentSymbolAdjustedTime,
  previewMatchedStake,
  stopBarPosition,
} from "../game/minigames/domain";

describe("Mini-Game domain rules", () => {
  it("previews Half from the lower score and floors to 50", () => {
    expect(previewMatchedStake(2_000, 1_225, "half")).toEqual({
      stakePerPlayer: 600,
      pot: 1_200,
    });
  });

  it("previews All as the complete matched limit", () => {
    expect(previewMatchedStake(2_000, 1_225, "all")).toEqual({
      stakePerPlayer: 1_225,
      pot: 2_450,
    });
  });

  it("calculates a deterministic reflected Stop Bar position", () => {
    const specification = {
      type: "stop_bar" as const,
      targetPosition: 0.4,
      markerSpeed: 0.5,
      initialDirection: 1 as const,
      maximumDurationMs: 15_000,
    };
    expect(stopBarPosition(specification, 1_000)).toBeCloseTo(0.5);
    expect(stopBarPosition(specification, 3_000)).toBeCloseTo(0.5);
  });

  it("counts only the correct consecutive Memory prefix", () => {
    const specification: MemorySequenceSpecification = {
      type: "memory_sequence" as const,
      symbols: ["star", "circle", "triangle", "diamond"],
      sequence: ["star", "circle", "diamond"],
      displayIntervalMs: 500,
      maximumDurationMs: 15_000,
    };
    expect(
      correctConsecutiveSymbols(specification, ["star", "triangle", "diamond"]),
    ).toBe(1);
  });

  it("adds Different Symbol penalties without trusting the score", () => {
    expect(differentSymbolAdjustedTime(875, 2, 350)).toBe(1_575);
  });
});
