/**
 * SMS client — wraps Africa's Talking SDK
 * Reads AT_USERNAME / AT_API_KEY from environment.
 * Falls back to a no-op when credentials are absent (CI / unit tests).
 */

import AfricasTalking from "africastalking";

const username = process.env.AT_USERNAME;
const apiKey = process.env.AT_API_KEY;
const senderId = process.env.AT_SENDER_ID || "AFRICASTALKING";

let smsClient: ReturnType<typeof AfricasTalking>["SMS"] | null = null;

if (username && apiKey) {
  smsClient = AfricasTalking({ username, apiKey }).SMS;
} else {
  console.warn("[sms] AT_USERNAME / AT_API_KEY not set — SMS sending disabled");
}

export async function sendSms(to: string, message: string): Promise<void> {
  if (!smsClient) return;
  const normalised = to.startsWith("+") ? to : `+${to}`;
  try {
    const opts = senderId
      ? { to: [normalised], message, from: senderId }
      : ({ to: [normalised], message } as Parameters<typeof smsClient.send>[0]);
    const result = await smsClient.send(opts);
    console.log("[sms] Sent to", normalised, JSON.stringify(result));
  } catch (err) {
    console.error(
      "[sms] Failed to send SMS to",
      normalised,
      JSON.stringify(err),
    );
  }
}

/** Format cents as "R X.XX" */
function rands(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function txSentMessage(
  amountCents: number,
  toWalletNumber: string,
  newBalanceCents: number,
): string {
  return `Ahava: You sent R${rands(amountCents)} to ${toWalletNumber}. New balance: R${rands(newBalanceCents)}.`;
}

export function txReceivedMessage(
  amountCents: number,
  fromWalletNumber: string,
  newBalanceCents: number,
): string {
  return `Ahava: You received R${rands(amountCents)} from ${fromWalletNumber}. New balance: R${rands(newBalanceCents)}.`;
}
