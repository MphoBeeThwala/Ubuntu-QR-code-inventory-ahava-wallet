// STUB: Free AML screening stub for development
// In production, uncomment the ComplyAdvantage integration below

import { AhavaError, AhavaErrorCode } from "@ahava/shared-errors";

export type AmlProvider = "complyadvantage" | "stub";

interface AmlScreeningOptions {
  provider?: AmlProvider;
  dryRun?: boolean;
}

interface AmlResult {
  riskScore: number;
  status: "CLEAR" | "REVIEW" | "BLOCKED";
  reasons: string[];
  checkedAt: Date;
}

export async function screenForAML(
  userData: {
    firstName: string;
    lastName: string;
    idNumber?: string;
    phoneNumber?: string;
    email?: string;
    dateOfBirth?: string;
  },
  options: AmlScreeningOptions = {}
): Promise<AmlResult> {
  const { provider = "stub", dryRun = true } = options;

  if (dryRun || provider === "stub") {
    console.log("[AML STUB] Screening user:", {
      firstName: userData.firstName,
      lastName: userData.lastName,
      idNumber: userData.idNumber ? "***REDACTED***" : undefined,
    });

    return {
      riskScore: 0.05,
      status: "CLEAR",
      reasons: ["Stub mode - no actual AML screening performed"],
      checkedAt: new Date(),
    };
  }

  if (provider === "complyadvantage") {
    try {
      const apiKey = process.env.COMPLYADVANTAGE_API_KEY;

      if (!apiKey) {
        throw new Error("ComplyAdvantage API key not configured");
      }

      console.log("[AML] ComplyAdvantage integration would screen:", {
        firstName: userData.firstName,
        lastName: userData.lastName,
      });

      return {
        riskScore: 0.05,
        status: "CLEAR",
        reasons: ["ComplyAdvantage stub - would perform real screening in production"],
        checkedAt: new Date(),
      };
    } catch (error: any) {
      console.error("[AML] Error:", error.message);
      return {
        riskScore: 1.0,
        status: "REVIEW",
        reasons: ["ComplyAdvantage API error: " + error.message],
        checkedAt: new Date(),
      };
    }
  }

  throw new AhavaError(AhavaErrorCode.INTERNAL_SERVER_ERROR, "Invalid AML provider", { provider });
}

export async function screenAddress(address: { street: string; city: string; country: string }): Promise<AmlResult> {
  console.log("[AML STUB] Screening address:", address);
  return {
    riskScore: 0.01,
    status: "CLEAR",
    reasons: ["Stub mode - no actual address screening performed"],
    checkedAt: new Date(),
  };
}

export async function screenTransaction(
  amount: number,
  senderId: string,
  receiverId: string
): Promise<AmlResult> {
  console.log("[AML STUB] Screening transaction:", { amount, senderId, receiverId });
  return {
    riskScore: 0.02,
    status: "CLEAR",
    reasons: ["Stub mode - no actual transaction screening performed"],
    checkedAt: new Date(),
  };
}
