// Minimal formatting utilities for payment-service.

export function formatZAR(cents: number): string {
  const rands = (cents / 100).toFixed(2);
  return `R${rands}`;
}

export function generateTransactionRef(): string {
  // Use a simple timestamp-based ref for local development.
  return `TXN-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

export function generateWalletNumber(): string {
  // Wallet numbers are typically 10-12 digits. This is a stub.
  return `WALLET-${Math.floor(100_000_000 + Math.random() * 900_000_000)}`;
}
