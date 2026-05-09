import fetch from "node-fetch";

export interface SanctionsResult {
  status: "CLEAR" | "MATCH" | "POTENTIAL_MATCH";
  matchDetails?: unknown;
}

export class ComplyAdvantageClient {
  private readonly baseUrl = "https://api.complyadvantage.com/v1";

  constructor(private readonly apiKey?: string) {
    if (!this.apiKey && process.env.NODE_ENV === "production") {
      console.warn(
        "COMPLYADVANTAGE_API_KEY is not set. AML sanctions screening will run in degraded mode.",
      );
    }
  }

  async screen(opts: {
    entityId: string;
    searchTerm?: string;
  }): Promise<SanctionsResult> {
    if (!this.apiKey) {
      return { status: "CLEAR" }; // Fallback for dev/test without key
    }

    try {
      const response = await fetch(`${this.baseUrl}/searches`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${this.apiKey}`,
        },
        body: JSON.stringify({
          search_term: opts.searchTerm || opts.entityId,
          fuzziness: 0.8,
          exact_match: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`ComplyAdvantage API error: ${response.statusText}`);
      }

      const data = await response.json();

      // Basic mapping from ComplyAdvantage response format
      if (
        data.content &&
        data.content.data &&
        data.content.data.total_hits > 0
      ) {
        const hits = data.content.data.hits;
        const highestScore = Math.max(...hits.map((h: any) => h.score || 0));

        return {
          status: highestScore >= 0.95 ? "MATCH" : "POTENTIAL_MATCH",
          matchDetails: {
            hits: hits.slice(0, 3), // store top 3 hits
            highestScore,
          },
        };
      }

      return { status: "CLEAR" };
    } catch (error) {
      console.error("Failed to screen against ComplyAdvantage", error);
      // Fail open or fail closed? Usually fail closed for AML, but returning POTENTIAL_MATCH
      // allows the transaction to be held for manual review rather than completely blocked.
      return {
        status: "POTENTIAL_MATCH",
        matchDetails: { error: "API_UNAVAILABLE" },
      };
    }
  }
}
