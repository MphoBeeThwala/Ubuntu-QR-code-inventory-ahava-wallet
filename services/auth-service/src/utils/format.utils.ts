// Utility helpers for formatting values.

export function generateWalletNumber(): string {
  // Simple placeholder wallet number generator.
  return `AHAVA-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}
