// apps/ussd/src/main.ts
// Ahava USSD Gateway — Africa's Talking feature-phone interface
// Stateless USSD flow: balance, send money, mini-statement, profile

import express from "express";
import type { Request, Response } from "express";
import bodyParser from "body-parser";
import { PrismaClient } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import { createSuccessResponse } from "@ahava/shared-errors";
import { hashForLookup } from "@ahava/shared-crypto";

// ─────────────────────────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────────────────────────

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 6008;

// Africa's Talking sends form-encoded POST
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.json());

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

/** Normalise +27XXXXXXXXX or 27XXXXXXXXX → 0XXXXXXXXX */
function normalisePhone(raw: string): string {
  const cleaned = raw.replace(/\s+/g, "");
  if (cleaned.startsWith("+27")) return "0" + cleaned.slice(3);
  if (cleaned.startsWith("27") && cleaned.length === 11)
    return "0" + cleaned.slice(2);
  return cleaned;
}

/** Format BigInt cents → "R 1 234.56" */
function fmtRand(cents: bigint | number): string {
  const rands = Number(cents) / 100;
  return (
    "R" +
    rands.toLocaleString("en-ZA", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/** Look up a user + active wallet by phone number (using hash — never raw PII in query) */
async function findByPhone(phone: string) {
  const hash = hashForLookup(normalisePhone(phone));
  return prisma.user.findFirst({
    where: { phoneNumberHash: hash, isDeleted: false },
    include: {
      wallets: {
        where: { isDeleted: false, status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });
}

// ─────────────────────────────────────────────────────────────────
// MENUS
// ─────────────────────────────────────────────────────────────────

const MAIN_MENU = `CON Ahava Wallet
1. Check Balance
2. Send Money
3. Mini Statement
4. My Profile
5. Help
0. Exit`;

const HELP_MSG = `END Ahava Wallet Help
- Min transfer: R1.00
- Fee: 0.5% (min R0.25)
- Tier 0 daily limit: R500
- Upgrade KYC at www.ahava.co.za
Support: support@ahava.co.za`;

// ─────────────────────────────────────────────────────────────────
// HANDLERS
// ─────────────────────────────────────────────────────────────────

async function handleBalance(phoneNumber: string): Promise<string> {
  const user = await findByPhone(phoneNumber);
  if (!user || user.wallets.length === 0) {
    return "END No Ahava account found.\nRegister at www.ahava.co.za";
  }
  const wallet = user.wallets[0];
  return `END Your Ahava Balance\n${fmtRand(wallet.balance)}\nKYC: ${user.kycTier}\nDial *384# for menu`;
}

async function handleMiniStatement(phoneNumber: string): Promise<string> {
  const user = await findByPhone(phoneNumber);
  if (!user || user.wallets.length === 0) {
    return "END No Ahava account found.";
  }
  const txns = await prisma.walletTransaction.findMany({
    where: { walletId: user.wallets[0].id },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { transactionType: true, amount: true, createdAt: true },
  });
  if (txns.length === 0) return "END No transactions yet.";
  const lines = txns.map((t) => {
    const sign = t.transactionType === "DEBIT" ? "-" : "+";
    const date = t.createdAt.toLocaleDateString("en-ZA", {
      day: "2-digit",
      month: "short",
    });
    return `${date} ${sign}${fmtRand(t.amount)}`;
  });
  return `END Last ${txns.length} transactions:\n${lines.join("\n")}`;
}

async function handleProfile(phoneNumber: string): Promise<string> {
  const user = await findByPhone(phoneNumber);
  if (!user) return "END No Ahava account found.\nRegister at www.ahava.co.za";
  const maskedPhone = normalisePhone(phoneNumber).replace(
    /(\d{3})\d{4}(\d{4})/,
    "$1****$2",
  );
  return `END My Profile\nPhone: ${maskedPhone}\nKYC Tier: ${user.kycTier}\nStatus: ${user.isDeleted ? "Closed" : "Active"}\nManage: www.ahava.co.za`;
}

/** Atomic payment — full double-entry with row locking */
async function executePayment(
  senderPhone: string,
  recipientPhone: string,
  amountCents: number,
): Promise<string> {
  const [sender, recipient] = await Promise.all([
    findByPhone(senderPhone),
    findByPhone(recipientPhone),
  ]);

  if (!sender || sender.wallets.length === 0)
    return "END Your Ahava account was not found.";
  if (!recipient || recipient.wallets.length === 0)
    return `END ${normalisePhone(recipientPhone)} has no Ahava wallet.`;

  const sw = sender.wallets[0];
  const rw = recipient.wallets[0];

  if (sw.status !== "ACTIVE")
    return "END Your wallet is suspended. Contact support.";
  if (rw.status !== "ACTIVE") return "END Recipient wallet is inactive.";

  const feeCents = Math.max(25, Math.ceil(amountCents * 0.005));
  const totalDebit = amountCents;

  if (sw.balance < BigInt(totalDebit)) {
    return (
      `END Insufficient balance.\nRequired: ${fmtRand(totalDebit)}\n` +
      `Available: ${fmtRand(sw.balance)}`
    );
  }

  try {
    const paymentServiceUrl =
      process.env.PAYMENT_SERVICE_URL || "http://localhost:6003";

    const idempotencyKey = uuidv4();

    const response = await fetch(`${paymentServiceUrl}/payments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": idempotencyKey,
      },
      body: JSON.stringify({
        senderWalletId: sw.id,
        receiverWalletId: rw.id,
        amountCents: totalDebit,
        description: `USSD send to ${normalisePhone(recipientPhone)}`,
        idempotencyKey,
        paymentMethod: "USSD",
        deviceId: `ussd:${normalisePhone(senderPhone)}`,
        ipAddress: "0.0.0.0",
      }),
    });

    const payload = (await response.json()) as any;
    if (!response.ok || !payload?.success) {
      return "END Payment failed.\nPlease try again or contact support.";
    }

    const refreshed = await prisma.wallet.findUnique({
      where: { id: sw.id },
      select: { balance: true },
    });
    const newBalance = refreshed?.balance ?? sw.balance;

    return (
      `END Payment Successful!\nSent ${fmtRand(amountCents - feeCents)} to ${normalisePhone(recipientPhone)}\n` +
      `Fee: ${fmtRand(feeCents)}\nTotal: ${fmtRand(totalDebit)}\nNew balance: ${fmtRand(newBalance)}`
    );
  } catch (err) {
    console.error("[USSD] payment error:", err);
    return "END Payment failed due to a system error.\nPlease try again or contact support.";
  }
}

// ─────────────────────────────────────────────────────────────────
// STATE MACHINE
// ─────────────────────────────────────────────────────────────────

async function handleUssd(phoneNumber: string, text: string): Promise<string> {
  const steps = text
    ? text
        .split("*")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  if (steps.length === 0) return MAIN_MENU;

  const [top, ...rest] = steps;

  if (top === "0") return "END Thank you for using Ahava Wallet.";
  if (top === "1") return handleBalance(phoneNumber);
  if (top === "3") return handleMiniStatement(phoneNumber);
  if (top === "4") return handleProfile(phoneNumber);
  if (top === "5") return HELP_MSG;

  // ── Send Money flow ────────────────────────────────────────────
  if (top === "2") {
    if (rest.length === 0) {
      return "CON Send Money\nEnter recipient phone number\n(e.g. 0731234567):";
    }

    const recipientPhone = rest[0];

    if (rest.length === 1) {
      const recipient = await findByPhone(recipientPhone);
      if (!recipient) {
        return `END Recipient ${normalisePhone(recipientPhone)} not found.\nCheck the number and try again.`;
      }
      return `CON Send to ${normalisePhone(recipientPhone)}\nEnter amount in Rands\n(e.g. 50 for R50.00):`;
    }

    const amountRands = parseFloat(rest[1]);
    if (isNaN(amountRands) || amountRands < 1) {
      return "END Invalid amount. Minimum is R1.00.\nPlease try again.";
    }
    const amountCents = Math.round(amountRands * 100);
    const feeCents = Math.max(25, Math.ceil(amountCents * 0.005));

    if (rest.length === 2) {
      return (
        `CON Confirm Payment\n` +
        `To: ${normalisePhone(recipientPhone)}\n` +
        `Total: ${fmtRand(amountCents)}\n` +
        `Fee: ${fmtRand(feeCents)}\n` +
        `Recipient gets: ${fmtRand(amountCents - feeCents)}\n\n` +
        `1. Confirm\n2. Cancel`
      );
    }

    if (rest.length === 3) {
      if (rest[2] === "2") return "END Payment cancelled.";
      if (rest[2] !== "1") return "END Invalid selection. Payment cancelled.";
      return executePayment(phoneNumber, recipientPhone, amountCents);
    }

    return "END Session expired. Dial *384# to start again.";
  }

  return `CON Invalid choice.\n${MAIN_MENU}`;
}

// ─────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────

app.get("/health", (_req: Request, res: Response) => {
  res.json(createSuccessResponse({ status: "ok", service: "ussd-service" }));
});

app.post("/ussd", async (req: Request, res: Response) => {
  const { sessionId, phoneNumber, text } = req.body as {
    sessionId: string;
    phoneNumber: string;
    text: string;
    serviceCode: string;
  };

  console.log(
    `[USSD] session=${sessionId} phone=${normalisePhone(phoneNumber)} text="${text}"`,
  );

  if (!sessionId || !phoneNumber) {
    res.set("Content-Type", "text/plain");
    return res.send("END Service temporarily unavailable.");
  }

  try {
    const response = await handleUssd(phoneNumber, text || "");
    res.set("Content-Type", "text/plain");
    res.send(response);
  } catch (err) {
    console.error(`[USSD] unhandled error [session=${sessionId}]:`, err);
    res.set("Content-Type", "text/plain");
    res.send("END A system error occurred. Please try again.");
  }
});

// ─────────────────────────────────────────────────────────────────
// SERVER STARTUP
// ─────────────────────────────────────────────────────────────────

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ USSD Service listening on port ${PORT}`);
    console.log(
      `📞 Africa's Talking callback: POST http://localhost:${PORT}/ussd`,
    );
  });
}

export default app;
