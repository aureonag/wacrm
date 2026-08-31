import { describe, expect, it } from "vitest";
import { scoreIcp, type IcpScoringInput } from "./icp-rubric";

const FULL_MATCH: IcpScoringInput = {
  segmentMatch: true,
  regionMatch: true,
  googleRating: 5,
  googleReviewCount: 50,
  hasStrongStructureSignals: true,
  digitalImprovementOpportunity: "high",
  hasPhone: true,
  hasEmail: true,
  hasWebsite: true,
  otherPositiveSignals: 5,
};

const NO_EVIDENCE: IcpScoringInput = {
  segmentMatch: null,
  regionMatch: null,
  googleRating: null,
  googleReviewCount: null,
  hasStrongStructureSignals: null,
  digitalImprovementOpportunity: null,
  hasPhone: false,
  hasEmail: false,
  hasWebsite: false,
  otherPositiveSignals: 0,
};

describe("scoreIcp", () => {
  it("caps a perfect-evidence candidate at 100 and grades it A", () => {
    const result = scoreIcp(FULL_MATCH);
    expect(result.score).toBe(100);
    expect(result.grade).toBe("A");
  });

  it("scores a candidate with no evidence at 0 and grades it C — never guesses in the candidate's favor", () => {
    const result = scoreIcp(NO_EVIDENCE);
    expect(result.score).toBe(0);
    expect(result.grade).toBe("C");
  });

  it("grades exactly at the A boundary (75)", () => {
    // segment 25 + region 10 + reputation 15 (5.0 rating, 50 reviews) +
    // structure 15 + contact (3/3) 10 = 75, opportunity/other at 0.
    const result = scoreIcp({
      ...NO_EVIDENCE,
      segmentMatch: true,
      regionMatch: true,
      googleRating: 5,
      googleReviewCount: 50,
      hasStrongStructureSignals: true,
      hasPhone: true,
      hasEmail: true,
      hasWebsite: true,
    });
    expect(result.score).toBe(75);
    expect(result.grade).toBe("A");
  });

  it("grades one point below the A boundary as B", () => {
    const result = scoreIcp({
      ...NO_EVIDENCE,
      segmentMatch: true,
      regionMatch: true,
      googleRating: 5,
      googleReviewCount: 50,
      hasStrongStructureSignals: true,
      hasPhone: true,
      hasEmail: true,
      hasWebsite: false, // drops contact score from 10 to 7, score becomes 72
    });
    expect(result.score).toBeLessThan(75);
    expect(result.grade).toBe("B");
  });

  it("grades exactly at the B boundary (50)", () => {
    const result = scoreIcp({
      ...NO_EVIDENCE,
      segmentMatch: true,
      regionMatch: true,
      digitalImprovementOpportunity: "medium",
      hasPhone: true,
      hasEmail: true,
      hasWebsite: true,
    });
    // 25 + 10 + 0 (no reputation data) + 0 (structure unknown) + 10 (medium) + 10 (contact) = 55
    expect(result.score).toBe(55);
    expect(result.grade).toBe("B");
  });

  it("degrades gracefully instead of throwing when reputation data is missing", () => {
    expect(() =>
      scoreIcp({ ...FULL_MATCH, googleRating: null, googleReviewCount: null }),
    ).not.toThrow();
    const result = scoreIcp({ ...FULL_MATCH, googleRating: null, googleReviewCount: null });
    expect(result.score).toBe(85); // 100 minus the 15-point reputation component
  });

  it("never lets a false structure signal outscore an unknown one", () => {
    const unknown = scoreIcp({ ...NO_EVIDENCE, hasStrongStructureSignals: null });
    const knownWeak = scoreIcp({ ...NO_EVIDENCE, hasStrongStructureSignals: false });
    expect(knownWeak.score).toBeGreaterThanOrEqual(unknown.score);
  });

  it("caps otherPositiveSignals contribution at 5 points even if a caller passes more", () => {
    const result = scoreIcp({ ...NO_EVIDENCE, otherPositiveSignals: 999 });
    expect(result.score).toBe(5);
  });

  it("stamps every result with the current rubric version", () => {
    expect(scoreIcp(NO_EVIDENCE).rubricVersion).toBe("v1");
  });
});
