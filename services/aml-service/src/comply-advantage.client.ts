// Minimal stub for ComplyAdvantage integration.
// In production, this should call the real ComplyAdvantage API and map
// results to the expected shape.

export interface SanctionsResult {
  status: 'CLEAR' | 'MATCH' | 'POTENTIAL_MATCH';
  matchDetails?: unknown;
}

export class ComplyAdvantageClient {
  constructor(private readonly apiKey?: string) {}

  async screen(_opts: { entityId: string }): Promise<SanctionsResult> {
    // TODO: Implement real API call. For now, always return CLEAR.
    return { status: 'CLEAR' };
  }
}
