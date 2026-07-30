// STUB: Free console-based SMS for development
// In production, uncomment the Africa's Talking integration below

import { AhavaError, AhavaErrorCode } from "@ahava/shared-errors";

export type SmsProvider = "at" | "stub";

interface SmsOptions {
  provider?: SmsProvider;
  dryRun?: boolean;
}

export async function sendSms(
  phoneNumber: string,
  message: string,
  options: SmsOptions = {}
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { provider = "stub", dryRun = true } = options;

  if (dryRun || provider === "stub") {
    console.log("[SMS STUB] To:", phoneNumber);
    console.log("[SMS STUB] Message:", message);
    console.log("[SMS STUB] Status: SENT (stub mode - no actual SMS sent)");
    return { success: true, messageId: "stub-" + Date.now() };
  }

  if (provider === "at") {
    try {
      const username = process.env.AT_USERNAME;
      const apiKey = process.env.AT_API_KEY;

      if (!username || !apiKey) {
        throw new Error("Africa's Talking credentials not configured");
      }

      console.log("[SMS] Africa's Talking integration would send:", { phoneNumber, message });
      return { success: true, messageId: "at-stub-" + Date.now() };
    } catch (error: any) {
      console.error("[SMS] Error:", error.message);
      return { success: false, error: error.message };
    }
  }

  throw new AhavaError(AhavaErrorCode.INTERNAL_SERVER_ERROR, "Invalid SMS provider", { provider });
}

export function welcomeMessage(walletNumber: string): string {
  return "Welcome to Ubuntu Pay! Your wallet number is " + walletNumber + ". Start transacting today!";
}

export function loginAlertMessage(timestamp: string): string {
  return "Login detected at " + timestamp + ". If this was not you, please contact support immediately.";
}

export function paymentReceivedMessage(amount: string, from: string): string {
  return "You received R" + amount + " from " + from + ". Your new balance is available in the app.";
}

export function paymentSentMessage(amount: string, to: string): string {
  return "You sent R" + amount + " to " + to + ". Transaction completed successfully.";
}
