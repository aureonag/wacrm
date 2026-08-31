// ============================================================
// Prospecting: ICP (ideal customer profile) scoring rubric.
//
// A pure, versioned, unit-testable scorer — no I/O, no Supabase, no
// OpenAI. `pontuar_icp` (the tool) is a thin wrapper around this.
//
// Weights (sum to 100, per the client-specified rubric):
//   segment match              25
//   region match                10
//   reputation (Google)         15
//   apparent business structure 15
//   digital-improvement gap     20  (more room to improve = more
//                                    opportunity for Aureon's own
//                                    services — higher, not lower)
//   contact availability        10
//   other commercial signals     5
//
// Grades: A >= 75, B 50-74, C < 50.
//
// Every factor degrades to 0 when its evidence is unknown/null rather
// than assuming a benefit of the doubt — an unscored candidate should
// never outrank one we actually have positive evidence for.
// ============================================================

export const PROSPECTING_ICP_RUBRIC_VERSION = "v1";

export type DigitalOpportunityLevel = "high" | "medium" | "low" | null;

export interface IcpScoringInput {
  /** Candidate's segment matches one of the search's target segments. `null` = unknown. */
  segmentMatch: boolean | null;
  /** Candidate's city/state falls inside the requested search region. `null` = unknown. */
  regionMatch: boolean | null;
  /** Google rating, 0-5. `null` when no Google Places data was found. */
  googleRating: number | null;
  googleReviewCount: number | null;
  /** Website/structure signals suggest a real, functioning business (site, contact info, HTTPS). `null` = not analyzed. */
  hasStrongStructureSignals: boolean | null;
  /** How much room the candidate's digital presence has to improve — Aureon's own commercial opportunity. */
  digitalImprovementOpportunity: DigitalOpportunityLevel;
  hasPhone: boolean;
  hasEmail: boolean;
  hasWebsite: boolean;
  /** Count of other positive commercial signals found (capped at 5 points total). */
  otherPositiveSignals: number;
}

export interface IcpScoreResult {
  score: number;
  grade: "A" | "B" | "C";
  reason: string;
  rubricVersion: string;
}

function gradeFor(score: number): "A" | "B" | "C" {
  if (score >= 75) return "A";
  if (score >= 50) return "B";
  return "C";
}

export function scoreIcp(input: IcpScoringInput): IcpScoreResult {
  const segmentScore = input.segmentMatch === true ? 25 : 0;
  const regionScore = input.regionMatch === true ? 10 : 0;

  let reputationScore = 0;
  if (input.googleRating !== null) {
    const ratingPart = (Math.max(0, Math.min(5, input.googleRating)) / 5) * 10;
    const reviewPart = (Math.min(50, Math.max(0, input.googleReviewCount ?? 0)) / 50) * 5;
    reputationScore = Math.round(ratingPart + reviewPart);
  }

  let structureScore = 0;
  if (input.hasStrongStructureSignals === true) structureScore = 15;
  else if (input.hasStrongStructureSignals === false) structureScore = 5;

  const digitalOpportunityScore =
    input.digitalImprovementOpportunity === "high"
      ? 20
      : input.digitalImprovementOpportunity === "medium"
        ? 10
        : 0;

  const contactCount = [input.hasPhone, input.hasEmail, input.hasWebsite].filter(Boolean).length;
  const contactScore = Math.round((contactCount / 3) * 10);

  const otherScore = Math.max(0, Math.min(5, input.otherPositiveSignals));

  const score = Math.max(
    0,
    Math.min(
      100,
      segmentScore + regionScore + reputationScore + structureScore + digitalOpportunityScore + contactScore + otherScore,
    ),
  );

  const grade = gradeFor(score);

  const positives: string[] = [];
  const gaps: string[] = [];
  if (segmentScore > 0) positives.push("segmento aderente");
  if (reputationScore >= 10) positives.push("bem avaliada no Google");
  else if (input.googleRating === null) gaps.push("sem avaliações no Google");
  if (structureScore >= 15) positives.push("estrutura comercial aparente");
  if (contactCount >= 2) positives.push("contato disponível");
  else gaps.push("poucos canais de contato encontrados");
  if (digitalOpportunityScore >= 10) gaps.push("presença digital pouco desenvolvida");

  const summary = [
    positives.length > 0 ? `Pontos positivos: ${positives.join(", ")}.` : null,
    gaps.length > 0 ? `Oportunidades: ${gaps.join(", ")}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const reason = `ICP ${grade} · ${score} pontos.${summary ? ` ${summary}` : ""}`;

  return { score, grade, reason, rubricVersion: PROSPECTING_ICP_RUBRIC_VERSION };
}
