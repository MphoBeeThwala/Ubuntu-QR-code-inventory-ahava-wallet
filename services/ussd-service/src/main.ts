/**
 * USSD Service — Ahava eWallet
 * Port: 6008
 *
 * Handles Africa's Talking USSD callbacks.
 * Uses a stateless menu router: the full input history (text field)
 * is replayed each request to determine the current menu step.
 *
 * Menu tree:
 *   (root) → 1=Balance | 2=Send Money | 3=Buy Airtime | 4=Mini Statement | 5=Exit
 *   Balance    → show ZAR balance → back to menu
 *   Send Money → recipient wallet number → amount → confirm → result
 *   Buy Airtime→ phone (0=own) → amount → confirm → result
 *   Mini Stmt  → last 5 transactions → back to menu
 */

import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { createSuccessResponse } from "@ahava/shared-errors";
import { v4 as uuidv4 } from "uuid";
import africastalking from "africastalking";

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 6008;

// Africa's Talking Configuration
const atCredentials = {
  apiKey: process.env.AFRICAS_TALKING_API_KEY || "sandbox",
  username: process.env.AFRICAS_TALKING_USERNAME || "sandbox",
};
const AT = africastalking(atCredentials);

// Africa's Talking sends form-encoded POST bodies
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ─────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────

interface UssdRequest {
  sessionId: string;
  serviceCode: string;
  phoneNumber: string;
  text: string;
}

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

/** Format cents as "R X.XX" */
function formatRand(cents: bigint | number): string {
  const n = typeof cents === "bigint" ? Number(cents) : cents;
  return `R${(n / 100).toFixed(2)}`;
}

/** Normalise a SA phone to +27 format */
function normaliseSAPhone(raw: string): string {
  const stripped = raw.replace(/\s+/g, "");
  if (stripped.startsWith("+27")) return stripped;
  if (stripped.startsWith("0")) return "+27" + stripped.slice(1);
  return stripped;
}

/** CON = continue (keep session open); END = terminate session */
const CON = (msg: string) => `CON ${msg}`;
const END = (msg: string) => `END ${msg}`;

// ─────────────────────────────────────────────────────────────────
// MENU BUILDER
// ─────────────────────────────────────────────────────────────────

const MAIN_MENU = `Welcome to Ahava eWallet
1. Check Balance
2. Send Money
3. Buy Airtime
4. Mini Statement
5. Exit`;

async function routeUssd(req: UssdRequest): Promise<string> {
  const { phoneNumber, text } = req;
  // Split the pipe-delimited input history into steps
  const steps = text === "" ? [] : text.split("*");
  const depth = steps.length;

  // ── Root (initial call) ─────────────────────────────────────────
  if (depth === 0) {
    return CON(MAIN_MENU);
  }

  const choice = steps[0];

  // ── 1. Check Balance ────────────────────────────────────────────
  if (choice === "1") {
    const balance = await getBalance(phoneNumber);
    if (balance === null)
      return END("Account not found. Please register via the Ahava app.");
    return END(
      `Your Ahava balance:\nAvailable: ${formatRand(balance.available)}\nPending:   ${formatRand(balance.pending)}\n\nDial *384# to return to menu.`,
    );
  }

  // ── 2. Send Money ───────────────────────────────────────────────
  if (choice === "2") {
    if (depth === 1) {
      return CON(
        "Send Money\nEnter recipient wallet number\n(format: AHV-XXXX-XXXX-XXXX)\n0. Back",
      );
    }
    if (steps[1] === "0") return CON(MAIN_MENU);

    const recipientWalletNumber = steps[1].toUpperCase();

    if (depth === 2) {
      // Validate recipient wallet exists
      const recipient = await prisma.wallet.findUnique({
        where: { walletNumber: recipientWalletNumber },
        include: { user: { select: { fullName: true } } },
      });
      if (!recipient || recipient.isDeleted) {
        return CON(
          `Wallet ${recipientWalletNumber} not found.\n\n1. Try again\n2. Main Menu`,
        );
      }
      const name = recipient.user?.fullName ?? recipientWalletNumber;
      return CON(
        `Send to: ${name}\n(${recipientWalletNumber})\n\nEnter amount in Rands (e.g. 50):\n0. Back`,
      );
    }

    if (steps[2] === "0") return CON(MAIN_MENU);

    const amountRand = parseFloat(steps[2]);
    if (isNaN(amountRand) || amountRand <= 0) {
      return CON("Invalid amount.\n\n1. Try again\n2. Main Menu");
    }

    if (depth === 3) {
      return CON(
        `Confirm transfer:\nTo: ${recipientWalletNumber}\nAmount: R${amountRand.toFixed(2)}\n\n1. Confirm\n2. Cancel`,
      );
    }

    if (depth === 4) {
      if (steps[3] === "1") {
        const result = await processSend(
          phoneNumber,
          recipientWalletNumber,
          amountRand,
        );
        return END(result);
      }
      return END("Transfer cancelled.");
    }
  }

  // ── 3. Buy Airtime ──────────────────────────────────────────────
  if (choice === "3") {
    if (depth === 1) {
      return CON("Buy Airtime\nEnter phone number\n(0 for your own number):");
    }

    const airtimePhone =
      steps[1] === "0" ? phoneNumber : normaliseSAPhone(steps[1]);

    if (depth === 2) {
      return CON(
        `Buy airtime for:\n${airtimePhone}\n\nEnter amount in Rands (e.g. 10):\n0. Back`,
      );
    }

    if (steps[2] === "0") return CON(MAIN_MENU);

    const airtimeAmount = parseFloat(steps[2]);
    if (isNaN(airtimeAmount) || airtimeAmount <= 0) {
      return CON("Invalid amount.\n\n1. Try again\n2. Main Menu");
    }

    if (depth === 3) {
      return CON(
        `Confirm airtime:\nPhone: ${airtimePhone}\nAmount: R${airtimeAmount.toFixed(2)}\n\n1. Confirm\n2. Cancel`,
      );
    }

    if (depth === 4) {
      if (steps[3] === "1") {
        const result = await processAirtime(
          phoneNumber,
          airtimePhone,
          airtimeAmount,
        );
        return END(result);
      }
      return END("Airtime purchase cancelled.");
    }
  }

  // ── 4. Mini Statement ───────────────────────────────────────────
  if (choice === "4") {
    const statement = await getMiniStatement(phoneNumber);
    if (statement === null) return END("Account not found.");
    return END(statement);
  }

  // ── 5. Exit ─────────────────────────────────────────────────────
  if (choice === "5") {
    return END("Thank you for using Ahava eWallet.\nDial *384# to return.");
  }

  // ── Fallback ────────────────────────────────────────────────────
  return CON(`Invalid option.\n\n${MAIN_MENU}`);
}

// ─────────────────────────────────────────────────────────────────
// DATA HELPERS
// ─────────────────────────────────────────────────────────────────

async function getWalletByPhone(phoneNumber: string) {
  const normalised = normaliseSAPhone(phoneNumber);
  const user = await prisma.user.findUnique({
    where: { phoneNumber: normalised, isDeleted: false },
    include: {
      wallets: {
        where: { walletType: "PERSONAL", isDeleted: false },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });
  return user?.wallets[0] ?? null;
}

async function getBalance(phoneNumber: string) {
  const wallet = await getWalletByPhone(phoneNumber);
  if (!wallet) return null;
  return {
    available:
      BigInt(wallet.balance) -
      BigInt(wallet.pendingBalance) -
      BigInt(wallet.reservedBalance),
    pending: wallet.pendingBalance,
    total: wallet.balance,
  };
}

async function getMiniStatement(phoneNumber: string): Promise<string | null> {
  const wallet = await getWalletByPhone(phoneNumber);
  if (!wallet) return null;

  const txns = await prisma.walletTransaction.findMany({
    where: { walletId: wallet.id, status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  if (txns.length === 0) return "No transactions yet.";

  const lines = txns.map((t) => {
    const sign = t.transactionType === "CREDIT" ? "+" : "-";
    const amt = formatRand(Number(t.amount));
    const date = new Date(t.createdAt).toLocaleDateString("en-ZA", {
      day: "2-digit",
      month: "short",
    });
    return `${date} ${sign}${amt}`;
  });

  return `Mini Statement:\n${lines.join("\n")}\n\nBalance: ${formatRand(Number(wallet.balance))}`;
}

async function processSend(
  senderPhone: string,
  recipientWalletNumber: string,
  amountRand: number,
): Promise<string> {
  try {
    const senderWallet = await getWalletByPhone(senderPhone);
    if (!senderWallet) return "Sender account not found.";

    const recipientWallet = await prisma.wallet.findUnique({
      where: { walletNumber: recipientWalletNumber },
    });
    if (!recipientWallet) return "Recipient wallet not found.";

    const amountCents = Math.round(amountRand * 100);

    if (Number(senderWallet.balance) < amountCents) {
      return `Insufficient funds.\nBalance: ${formatRand(Number(senderWallet.balance))}`;
    }

    if (amountCents > Number(senderWallet.perTransactionLimit)) {
      return `Amount exceeds per-transaction limit of ${formatRand(Number(senderWallet.perTransactionLimit))}.`;
    }

    // Atomic debit + credit
    await prisma.$transaction([
      prisma.wallet.update({
        where: { id: senderWallet.id },
        data: { balance: { decrement: amountCents } },
      }),
      prisma.wallet.update({
        where: { id: recipientWallet.id },
        data: { balance: { increment: amountCents } },
      }),
      prisma.walletTransaction.create({
        data: {
          walletId: senderWallet.id,
          transactionType: "DEBIT",
          paymentMethod: "UBUNTUPAY_WALLET",
          amount: amountCents,
          feeAmount: 0,
          netAmount: amountCents,
          balanceBefore: senderWallet.balance,
          balanceAfter: BigInt(Number(senderWallet.balance) - amountCents),
          status: "COMPLETED",
          description: `USSD transfer to ${recipientWalletNumber}`,
          counterpartyWalletId: recipientWallet.id,
          idempotencyKey: uuidv4(),
        },
      }),
      prisma.walletTransaction.create({
        data: {
          walletId: recipientWallet.id,
          transactionType: "CREDIT",
          paymentMethod: "UBUNTUPAY_WALLET",
          amount: amountCents,
          feeAmount: 0,
          netAmount: amountCents,
          balanceBefore: recipientWallet.balance,
          balanceAfter: BigInt(Number(recipientWallet.balance) + amountCents),
          status: "COMPLETED",
          description: `USSD transfer from ${senderWallet.walletNumber}`,
          counterpartyWalletId: senderWallet.id,
          idempotencyKey: uuidv4(),
        },
      }),
    ]);

    return `Transfer successful!\nSent R${amountRand.toFixed(2)} to ${recipientWalletNumber}.\n\nNew balance: ${formatRand(Number(senderWallet.balance) - amountCents)}`;
  } catch (err) {
    console.error("[ussd-service] send error:", err);
    return "Transfer failed. Please try again or contact support.";
  }
}

async function processAirtime(
  payerPhone: string,
  recipientPhone: string,
  amountRand: number,
): Promise<string> {
  try {
    const payerWallet = await getWalletByPhone(payerPhone);
    if (!payerWallet) return "Account not found.";

    const amountCents = Math.round(amountRand * 100);

    if (Number(payerWallet.balance) < amountCents) {
      return `Insufficient funds.\nBalance: ${formatRand(Number(payerWallet.balance))}`;
    }

    await prisma.$transaction([
      prisma.wallet.update({
        where: { id: payerWallet.id },
        data: { balance: { decrement: amountCents } },
      }),
      prisma.walletTransaction.create({
        data: {
          walletId: payerWallet.id,
          transactionType: "DEBIT",
          paymentMethod: "UBUNTUPAY_WALLET",
          amount: amountCents,
          feeAmount: 0,
          netAmount: amountCents,
          balanceBefore: payerWallet.balance,
          balanceAfter: BigInt(Number(payerWallet.balance) - amountCents),
          status: "COMPLETED",
          description: `Airtime purchase for ${recipientPhone}`,
          idempotencyKey: uuidv4(),
        },
      }),
    ]);

    if ((process.env.NODE_ENV || "").toLowerCase() === "test") {
      return `Airtime sent!\nR${amountRand.toFixed(2)} airtime sent to ${recipientPhone}.\n\nNew balance: ${formatRand(Number(payerWallet.balance) - amountCents)}`;
    }

    // Call Africa's Talking Airtime API
    const airtime = (AT as any).AIRTIME;
    await airtime.send({
      recipients: [
        {
          phoneNumber: recipientPhone,
          amount: amountRand,
          currencyCode: "ZAR",
        },
      ],
    });

    return `Airtime sent!\nR${amountRand.toFixed(2)} airtime sent to ${recipientPhone}.\n\nNew balance: ${formatRand(Number(payerWallet.balance) - amountCents)}`;
  } catch (err) {
    console.error("[ussd-service] airtime error:", err);
    return "Airtime purchase failed. Please try again.";
  }
}

// ─────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json(createSuccessResponse({ status: "ok", service: "ussd-service" }));
});

/**
 * POST /ussd
 * Africa's Talking USSD callback endpoint.
 * Responds with plain text: "CON <msg>" or "END <msg>"
 */
app.post("/ussd", async (req: Request, res: Response) => {
  const { sessionId, serviceCode, phoneNumber, text } = req.body as UssdRequest;

  if (!sessionId || !phoneNumber) {
    return res.status(400).send("END Invalid request.");
  }

  try {
    const response = await routeUssd({
      sessionId,
      serviceCode,
      phoneNumber,
      text: text ?? "",
    });
    // Africa's Talking expects plain text, NOT JSON
    res.set("Content-Type", "text/plain");
    res.send(response);
  } catch (err) {
    console.error("[ussd-service] unhandled error:", err);
    res.set("Content-Type", "text/plain");
    res.send("END Service unavailable. Please try again later.");
  }
});

// ─────────────────────────────────────────────────────────────────
// SERVER STARTUP
// ─────────────────────────────────────────────────────────────────

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ USSD Service listening on port ${PORT}`);
    console.log(`📱 Webhook: POST http://localhost:${PORT}/ussd`);
    console.log(`🏥 Health:  http://localhost:${PORT}/health`);
  });
}

export default app;
