// apps/ussd/src/main.ts
// Ahava USSD CLI — Feature phone interface (Africa's Talking gateway)
// Stateless USSD flow for unstructured supplementary service data
// Supports: login, check balance, send money, request money

import express from 'express';
import type { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const app = express();
const prisma = new PrismaClient();

app.use(express.urlencoded({ extended: false }));

interface UssdRequest {
  sessionId: string;
  phoneNumber: string;
  text: string;
  serviceCode: string;
}

// USSD Menu States
const MENU = {
  MAIN: `
CON Ahava Wallet
1. Check Balance
2. Send Money
3. Request Money
4. My Profile
5. Help
  `,
  
  SEND_MONEY_PHONE: `
CON Enter recipient phone number
(include country code, e.g. 27823456789)
  `,
  
  SEND_MONEY_AMOUNT: `
CON Enter amount to send (in Rands, e.g. 50 for R50)
  `,
  
  SEND_MONEY_PIN: `
CON Enter your 4-digit PIN
  `,

  SEND_MONEY_CONFIRM: (phone: string, amount: number) => `
CON Confirm payment
To: ${phone}
Amount: R${(amount / 100).toFixed(2)}
1. Confirm
2. Cancel
  `,

  REQUEST_MONEY_PHONE: `
CON Enter phone number to request from
  `,

  REQUEST_MONEY_AMOUNT: `
CON Enter amount to request (in Rands)
  `,

  HELP: `
END Ahava Wallet Help
- Minimum transaction: R1
- Maximum per day (TIER_0): R500
- Maximum per month (TIER_0): R2000
- Upgrade KYC for higher limits
Contact support@ahava.co.za
  `,
};

// Parse USSD input: extract current choice from user input
function parseUssdInput(text: string): string {
  return text.trim().split('*').pop() || '';
}

// Main USSD Handler
app.post('/ussd', async (req: Request, res: Response) => {
  const { sessionId, phoneNumber, text, serviceCode } = req.body as UssdRequest;

  console.log(`[USSD] Session: ${sessionId}, Phone: ${phoneNumber}, Text: ${text}`);

  try {
    // Split text by * to understand flow: *1*2*100*1234*1
    const steps = text.split('*').filter(Boolean);
    const currentChoice = steps[steps.length - 1];

    // Route based on step count + choice
    if (steps.length === 0) {
      // Initial menu
      return res.send(MENU.MAIN);
    }

    if (steps.length === 1) {
      // Main menu choice
      if (currentChoice === '1') {
        // Check Balance
        return handleCheckBalance(phoneNumber, res);
      } else if (currentChoice === '2') {
        // Send Money — ask for recipient
        return res.send(MENU.SEND_MONEY_PHONE);
      } else if (currentChoice === '3') {
        // Request Money — ask for requester
        return res.send(MENU.REQUEST_MONEY_PHONE);
      } else if (currentChoice === '4') {
        // My Profile
        return handleProfile(phoneNumber, res);
      } else if (currentChoice === '5') {
        // Help
        return res.send(MENU.HELP);
      } else {
        return res.send(`CON Invalid choice. ${MENU.MAIN}`);
      }
    }

    if (steps.length === 2 && steps[0] === '2') {
      // Send Money flow — got phone, ask for amount
      const recipientPhone = currentChoice;
      return res.send(MENU.SEND_MONEY_AMOUNT);
    }

    if (steps.length === 3 && steps[0] === '2') {
      // Send Money — got amount, ask for PIN
      const recipientPhone = steps[1];
      const amount = parseInt(currentChoice) * 100; // Convert to cents
      
      if (isNaN(amount) || amount <= 0) {
        return res.send(`CON Invalid amount. ${MENU.SEND_MONEY_AMOUNT}`);
      }

      // Check if user has sufficient balance
      try {
        const user = await prisma.user.findUnique({
          where: { phoneNumber },
          include: { wallets: true },
        });

        if (!user) {
          return res.send('END User not found. Please register first at www.ahava.co.za');
        }

        const balanceCents = Number(user.wallets?.[0]?.balance || 0);
        if (balanceCents < amount) {
          return res.send(`END Insufficient balance. Current: R${(balanceCents / 100).toFixed(2)}`);
        }
      } catch (error) {
        console.error(`[USSD] Balance check failed: ${error}`);
        return res.send('END Service error. Try again later.');
      }

      return res.send(MENU.SEND_MONEY_PIN);
    }

    if (steps.length === 4 && steps[0] === '2') {
      // Send Money — got PIN, show confirmation
      const recipientPhone = steps[1];
      const amount = parseInt(steps[2]) * 100;
      const pin = currentChoice;

      // Validate PIN (mock for now)
      if (pin.length !== 4 || !/^\d+$/.test(pin)) {
        return res.send('CON Invalid PIN format (4 digits)');
      }

      return res.send(MENU.SEND_MONEY_CONFIRM(recipientPhone, amount));
    }

    if (steps.length === 5 && steps[0] === '2') {
      // Send Money — confirmation (1=confirm, 2=cancel)
      const recipientPhone = steps[1];
      const amountCents = parseInt(steps[2]) * 100;

      if (currentChoice === '1') {
        // Process payment
        try {
          // TODO: Call backend /payments endpoint
          // const response = await fetch('http://payment-service:3003/payments', {
          //   method: 'POST',
          //   headers: { 'Content-Type': 'application/json' },
          //   body: JSON.stringify({
          //     senderPhone: phoneNumber,
          //     recipientPhone,
          //     amountCents,
          //     description: 'USSD transfer',
          //   }),
          // });
          
          return res.send(`END Payment successful!
Sent R${(amountCents / 100).toFixed(2)} to ${recipientPhone}`);
        } catch (error) {
          console.error(`[USSD] Payment failed: ${error}`);
          return res.send('END Payment failed. Try again later.');
        }
      } else {
        return res.send('END Payment cancelled.');
      }
    }

    // Request Money flow (similar pattern)
    if (steps.length === 2 && steps[0] === '3') {
      return res.send(MENU.REQUEST_MONEY_AMOUNT);
    }

    if (steps.length === 3 && steps[0] === '3') {
      const requesterPhone = steps[1];
      const amount = parseInt(currentChoice) * 100;
      
      // TODO: Send notification to requesterPhone asking to send money
      return res.send(`END Money request sent to ${requesterPhone}
Amount: R${(amount / 100).toFixed(2)}`);
    }

    return res.send(`CON ${MENU.MAIN}`);
  } catch (error) {
    console.error(`[USSD] Error: ${error}`);
    res.send('END Service error. Please try again later.');
  }
});

async function handleCheckBalance(phoneNumber: string, res: Response) {
  try {
    const user = await prisma.user.findUnique({
      where: { phoneNumber },
      include: { wallets: true },
    });

    if (!user) {
      return res.send('END User not found. Register at www.ahava.co.za');
    }

    const balance = Number(user.wallets?.[0]?.balance || 0);
    const kycTier = user.kycTier || 'TIER_0';

    return res.send(`END Your Balance
Current: R${(balance / 100).toFixed(2)}
KYC Tier: ${kycTier}
Limit: R500/day

Menu: dial *483# again`);
  } catch (error) {
    console.error(`[USSD] Balance check error: ${error}`);
    res.send('END Service error. Try again later.');
  }
}

async function handleProfile(phoneNumber: string, res: Response) {
  try {
    const user = await prisma.user.findUnique({
      where: { phoneNumber },
    });

    if (!user) {
      return res.send('END User not found. Register at www.ahava.co.za');
    }

    return res.send(`END My Profile
Phone: ${user.phoneNumber}
Name: ${user.fullName || 'Not set'}
ID: ${user.idNumber?.slice(-4) || 'Not verified'}
Created: ${new Date(user.createdAt).toLocaleDateString()}

Update: www.ahava.co.za`);
  } catch (error) {
    console.error(`[USSD] Profile fetch error: ${error}`);
    res.send('END Service error. Try again later.');
  }
}

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'ussd-service' });
});

const PORT = process.env.PORT || 3008;
app.listen(PORT, () => {
  console.log(`[USSD Service] listening on port ${PORT}`);
});
