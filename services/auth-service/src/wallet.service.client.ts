import {
  PrismaClient,
  WalletType as PrismaWalletType,
  KycTier as PrismaKycTier,
} from "@prisma/client";
import { generateWalletNumber } from "./utils/format.utils";

// Wallet service client for auth service to provision initial wallets.
// In a fully decoupled microservice architecture this would be an HTTP/gRPC call.
// Here we use Prisma directly since they share the database.

export class WalletService {
  constructor(private readonly prisma: PrismaClient) {}

  async createWallet(
    userId: string,
    walletType: PrismaWalletType,
    kycTier: PrismaKycTier,
  ) {
    return this.prisma.wallet.create({
      data: {
        userId,
        walletNumber: generateWalletNumber(),
        walletType,
        status: "ACTIVE",
        kycTier,
        balance: 0,
        currency: "ZAR",
      },
    });
  }
}
