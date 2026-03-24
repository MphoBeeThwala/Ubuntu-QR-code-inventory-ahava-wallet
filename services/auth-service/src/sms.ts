/**
 * SMS client — wraps Africa's Talking SDK
 * Reads AT_USERNAME / AT_API_KEY from environment.
 * Falls back to a no-op logger when credentials are absent (CI / unit tests).
 */

import AfricasTalking from "africastalking";

const username = process.env.AT_USERNAME;
const apiKey = process.env.AT_API_KEY;
const senderId = process.env.AT_SENDER_ID || "AHAVA";

let smsClient: ReturnType<typeof AfricasTalking>["SMS"] | null = null;

if (username && apiKey) {
  smsClient = AfricasTalking({ username, apiKey }).SMS;
} else {
  console.warn("[sms] AT_USERNAME / AT_API_KEY not set — SMS sending disabled");
}

/**
 * Send an SMS. Silently swallows errors so a failed SMS never breaks the
 * primary auth/wallet flow.
 */
export async function sendSms(to: string, message: string): Promise<void> {
  if (!smsClient) return;

  // Ensure E.164 format (+27…)
  const normalised = to.startsWith("+") ? to : `+${to}`;

  try {
    await smsClient.send({ to: [normalised], message, from: senderId });
  } catch (err) {
    console.error("[sms] Failed to send SMS to", normalised, err);
  }
}

// ─── Pre-composed message helpers ─────────────────────────────────────────────

export function welcomeMessage(walletNumber: string): string {
  return (
    `Welcome to Ahava eWallet! Your wallet ${walletNumber} is ready. ` +
    `Keep your PIN safe and never share it. Support: support@ahava.co.za`
  );
}

export function loginAlertMessage(timestamp: string): string {
  return (
    `Ahava: New login to your wallet at ${timestamp}. ` +
    `Not you? Contact support immediately at support@ahava.co.za`
  );
}

export function transactionMessage(
  type: "sent" | "received",
  amountRands: string,
  counterparty: string,
  balance: string,
): string {
  if (type === "sent") {
    return `Ahava: You sent R${amountRands} to ${counterparty}. Available balance: R${balance}.`;
  }
  return `Ahava: You received R${amountRands} from ${counterparty}. Available balance: R${balance}.`;
}
