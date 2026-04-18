export function parseZarToCents(input: string): number {
  const cleaned = input
    .trim()
    .replace(/^R\s*/i, "")
    .replace(/,/g, "")
    .replace(/\s+/g, "");

  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new Error("Invalid money amount");
  }

  const isNegative = cleaned.startsWith("-");
  const unsigned = isNegative ? cleaned.slice(1) : cleaned;

  const [intPart, fracRaw] = unsigned.split(".");
  const fracPart = (fracRaw ?? "").padEnd(2, "0").slice(0, 2);

  const cents =
    BigInt(intPart) * BigInt(100) +
    (fracPart.length ? BigInt(fracPart) : BigInt(0));

  const signed = isNegative ? -cents : cents;
  const asNumber = Number(signed);
  if (!Number.isSafeInteger(asNumber)) {
    throw new Error("Amount exceeds safe integer range");
  }
  return asNumber;
}

export function formatZarFromCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new Error("Cents must be an integer");
  }
  const isNegative = cents < 0;
  const abs = Math.abs(cents);
  const rands = Math.floor(abs / 100);
  const frac = abs % 100;
  const formatted =
    rands.toLocaleString("en-ZA") + "." + frac.toString().padStart(2, "0");
  return (isNegative ? "-" : "") + "R" + formatted;
}

export function assertIntegerCents(cents: number): void {
  if (!Number.isSafeInteger(cents)) {
    throw new Error("Cents must be an integer");
  }
}
