// apps/pwa/lib/api-client.ts
// Shared API client for all frontend apps
// Handles: JWT auth, error handling, idempotency, retries

import axios, { AxiosInstance } from "axios";
import { v4 as uuidv4 } from "uuid";

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    statusCode: number;
  };
}

export type AuthResult = {
  userId: string;
  accessToken: string;
  refreshToken?: string;
  walletId?: string;
  walletNumber?: string;
  user?: { kycTier?: string };
};

type AuthTokens = {
  userId?: string;
  accessToken: string;
  refreshToken: string;
  walletId?: string;
  walletNumber?: string;
  user?: { kycTier?: string };
};

class AhavaApiClient {
  private client: AxiosInstance;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  constructor(baseURL: string = "/api") {
    this.client = axios.create({
      baseURL,
      timeout: 10000,
    });

    // Request interceptor: add auth headers + idempotency key
    this.client.interceptors.request.use((config) => {
      if (this.accessToken) {
        config.headers.Authorization = `Bearer ${this.accessToken}`;
      }
      config.headers["X-Idempotency-Key"] = uuidv4();
      config.headers["X-Device-ID"] = this.getDeviceId();
      return config;
    });

    // Response interceptor: handle 401, refresh token
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401 && this.refreshToken) {
          // Attempt token refresh
          try {
            const response = await this.refresh();
            if (response.success) {
              return this.client.request(error.config);
            }
          } catch (e) {
            // Refresh failed, logout
            this.logout();
          }
        }
        return Promise.reject(error);
      },
    );
  }

  // Auth Methods
  async login(phone: string, pin: string): Promise<ApiResponse<AuthTokens>> {
    const response = await this.client.post("/auth/login", {
      phoneNumber: phone,
      pin,
      deviceId: this.getDeviceId(),
    });
    const { data } = response.data;
    this.accessToken = data.accessToken;
    this.refreshToken = data.refreshToken;
    return response.data;
  }

  async register(
    phone: string,
    pin: string,
  ): Promise<ApiResponse<AuthResult>> {
    const response = await this.client.post("/auth/register", {
      phoneNumber: phone,
      pin,
      deviceId: this.getDeviceId(),
    });
    const { data } = response.data;
    this.accessToken = data.accessToken;
    this.refreshToken = data.refreshToken;
    return response.data;
  }

  async refresh(): Promise<ApiResponse> {
    const userId = localStorage.getItem("userId");
    const deviceId = this.getDeviceId();
    const response = await this.client.post("/auth/refresh", {
      userId,
      refreshToken: this.refreshToken,
      deviceId,
    });
    const { data } = response.data;
    this.accessToken = data.accessToken;
    return response.data;
  }

  logout() {
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
  }

  // Wallet Methods
  async getBalance(
    walletId: string,
  ): Promise<ApiResponse<{ balanceCents: number; pendingCents: number }>> {
    const response = await this.client.get(`/wallets/${walletId}/balance`);
    const raw = response.data;
    // Normalize wallet-service shape { balance: { available, pending } }
    if (raw.success && raw.data?.balance) {
      return {
        ...raw,
        data: {
          balanceCents: Number(raw.data.balance.available ?? 0),
          pendingCents: Number(raw.data.balance.pending ?? 0),
        },
      };
    }
    return raw;
  }

  async getTransactionHistory(
    walletId: string,
    limit = 20,
    offset = 0,
  ): Promise<ApiResponse> {
    const response = await this.client.get(
      `/wallets/${walletId}/transactions`,
      { params: { limit, offset } },
    );
    const raw = response.data;
    if (raw.success && Array.isArray(raw.data?.transactions)) {
      return {
        ...raw,
        data: {
          transactions: raw.data.transactions.map(
            (t: {
              id: string;
              transactionType: "DEBIT" | "CREDIT";
              amount: string;
              description?: string;
              createdAt: string;
              status: string;
              paymentMethod?: string;
              balanceAfter?: string;
            }) => ({
              id: t.id,
              type: t.transactionType,
              amountCents: Number(t.amount ?? 0),
              description: t.description ?? "",
              createdAt: t.createdAt,
              status: t.status,
              channel: t.paymentMethod ?? "",
              balanceAfter: Number(t.balanceAfter ?? 0),
            }),
          ),
        },
      };
    }
    return raw;
  }

  // Payment Methods
  async sendPayment(
    senderWalletId: string,
    recipientPhone: string,
    amountCents: number,
    description?: string,
  ): Promise<ApiResponse<{ transactionId: string }>> {
    const recipient = recipientPhone.trim();
    const payload: Record<string, unknown> = {
      senderWalletId,
      amountCents,
      description,
      idempotencyKey: uuidv4(),
      paymentMethod: "UBUNTUPAY_WALLET",
      deviceId: this.getDeviceId(),
    };
    if (recipient.toUpperCase().startsWith("AHV-")) {
      payload.receiverWalletNumber = recipient.toUpperCase();
    } else {
      payload.recipientPhone = recipient;
    }
    const response = await this.client.post("/payments", {
      ...payload,
    });
    const raw = response.data;
    if (raw.success) {
      return {
        ...raw,
        data: {
          transactionId:
            raw.data?.transactionId ?? raw.data?.transaction?.debit?.id ?? "",
        },
      };
    }
    return raw;
  }

  // QR Code Methods
  async lookupQr(qrHash: string): Promise<
    ApiResponse<{
      qrId: string;
      qrType: string;
      recipientName: string | null;
      walletNumber: string;
      walletType: string;
      amountCents: number | null;
      currency: string;
      description: string | null;
      expiresAt: string | null;
    }>
  > {
    const response = await this.client.get(`/qr/${qrHash}`);
    return response.data;
  }

  async payViaQr(
    qrHash: string,
    senderWalletId: string,
    amountCents: number,
    idempotencyKey: string,
  ): Promise<ApiResponse<{ transactionId: string; amountCents: number }>> {
    const response = await this.client.post(`/qr/${qrHash}/pay`, {
      senderWalletId,
      amountCents,
      idempotencyKey,
    });
    return response.data;
  }

  async generateQr(
    walletId: string,
    qrType: "STATIC" | "DYNAMIC" = "STATIC",
    amountCents?: number,
    description?: string,
  ): Promise<
    ApiResponse<{
      qrId: string;
      qrHash: string;
      deepLink: string;
      qrType: string;
      amountCents: number | null;
      expiresAt: string | null;
    }>
  > {
    const response = await this.client.post(`/wallets/${walletId}/qr`, {
      qrType,
      ...(amountCents !== undefined ? { amountCents } : {}),
      ...(description ? { description } : {}),
    });
    return response.data;
  }

  // KYC Methods
  async getKycStatus(userId: string): Promise<ApiResponse> {
    const response = await this.client.get(`/kyc/user/${userId}`);
    return response.data;
  }

  async getUserDetails(): Promise<ApiResponse<{ kycTier: string }>> {
    const response = await this.client.get("/auth/me");
    const raw = response.data;
    if (raw.success && raw.data?.user) {
      return {
        ...raw,
        data: { kycTier: raw.data.user.kycTier },
      };
    }
    return raw;
  }

  async uploadKycDocument(
    file: File,
    documentType: string,
  ): Promise<ApiResponse> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("documentType", documentType);
    const response = await this.client.post("/kyc/document/upload", formData);
    return response.data;
  }

  // Helper Methods
  private getDeviceId(): string {
    let deviceId = localStorage.getItem("deviceId");
    if (!deviceId) {
      deviceId = uuidv4();
      localStorage.setItem("deviceId", deviceId);
    }
    return deviceId;
  }

  setTokens(accessToken: string, refreshToken: string) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }
}

export const apiClient = new AhavaApiClient();
