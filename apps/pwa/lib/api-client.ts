export type AhavaErrorPayload = {
  code: string;
  message: string;
  statusCode?: number;
};

export class ApiError extends Error {
  code: string;
  statusCode: number;

  constructor(payload: AhavaErrorPayload, fallbackStatus = 500) {
    super(payload.message || "Request failed");
    this.name = "ApiError";
    this.code = payload.code || "INTERNAL_SERVER_ERROR";
    this.statusCode = payload.statusCode ?? fallbackStatus;
  }
}

type ApiEnvelope<T> = {
  success: boolean;
  data?: T;
  error?: AhavaErrorPayload;
};

export type Session = {
  userId: string;
  accessToken: string;
  refreshToken: string;
  deviceId: string;
  walletId?: string;
};

export type WalletBalance = {
  available: number;
  pending: number;
  reserved: number;
  total: number;
  currency: string;
};

export type WalletLookup = {
  id: string;
  walletNumber: string;
  holderName: string;
};

export type Transaction = {
  id: string;
  transactionType: string;
  status: string;
  amount: number;
  feeAmount?: number;
  netAmount?: number;
  description?: string;
  createdAt: string;
  counterpartyWalletId?: string;
};

const SESSION_KEY = "ahava.session";
const PAYMENT_DRAFT_KEY = "ahava.paymentDraft";
const PAYMENT_RESULT_KEY = "ahava.paymentResult";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "web-device";
  const existing = localStorage.getItem("ahava.deviceId");
  if (existing) return existing;

  const generated = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `web-${Date.now()}`;

  localStorage.setItem("ahava.deviceId", generated);
  return generated;
}

export function saveSession(session: Session) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  return parseJson<Session>(localStorage.getItem(SESSION_KEY));
}

export function clearSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SESSION_KEY);
}

export function savePaymentDraft(draft: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(PAYMENT_DRAFT_KEY, JSON.stringify(draft));
}

export function getPaymentDraft<T>(): T | null {
  if (typeof window === "undefined") return null;
  return parseJson<T>(sessionStorage.getItem(PAYMENT_DRAFT_KEY));
}

export function clearPaymentDraft() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(PAYMENT_DRAFT_KEY);
}

export function savePaymentResult(result: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(PAYMENT_RESULT_KEY, JSON.stringify(result));
}

export function getPaymentResult<T>(): T | null {
  if (typeof window === "undefined") return null;
  return parseJson<T>(sessionStorage.getItem(PAYMENT_RESULT_KEY));
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  requireAuth = true
): Promise<T> {
  const session = getSession();
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json");

  if (requireAuth && session?.accessToken) {
    headers.set("Authorization", `Bearer ${session.accessToken}`);
  }

  if (session?.deviceId) {
    headers.set("X-Device-ID", session.deviceId);
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  const payload = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok || !payload?.success) {
    if (payload?.error) {
      throw new ApiError(payload.error, res.status);
    }
    throw new ApiError(
      {
        code: "INTERNAL_DEPENDENCY_FAILURE",
        message: "Unable to complete request",
        statusCode: res.status,
      },
      res.status
    );
  }

  return payload.data as T;
}

export async function register(phoneNumber: string, pin: string) {
  const deviceId = getOrCreateDeviceId();
  return request<{
    userId: string;
    walletId: string;
    accessToken: string;
    refreshToken: string;
    user: { phoneNumber: string; kycTier: string };
  }>(
    "/auth/register",
    {
      method: "POST",
      body: JSON.stringify({ phoneNumber, pin, deviceId, deviceName: "Ahava PWA" }),
    },
    false
  );
}

export async function login(phoneNumber: string, pin: string) {
  const deviceId = getOrCreateDeviceId();
  return request<{
    userId: string;
    accessToken: string;
    refreshToken: string;
    user: { phoneNumber: string; kycTier: string };
  }>(
    "/auth/login",
    {
      method: "POST",
      body: JSON.stringify({ phoneNumber, pin, deviceId, deviceName: "Ahava PWA" }),
    },
    false
  );
}

export async function logout() {
  const session = getSession();
  if (!session) return;

  try {
    await request(
      "/auth/logout",
      {
        method: "POST",
        body: JSON.stringify({ userId: session.userId, refreshToken: session.refreshToken }),
      },
      true
    );
  } finally {
    clearSession();
  }
}

export async function getUserWalletBalance(userId: string) {
  return request<{ walletId: string; balance: WalletBalance }>(`/wallets/user/${userId}/balance`);
}

export async function lookupWallet(walletNumber: string) {
  return request<{ wallet: WalletLookup }>(`/wallets/lookup?walletNumber=${encodeURIComponent(walletNumber)}`);
}

export async function sendPayment(input: {
  senderWalletId: string;
  receiverWalletId: string;
  amountCents: number;
  description?: string;
}) {
  return request<{ transaction: { debit: Transaction; credit: Transaction; fee: number } }>(
    "/payments",
    {
      method: "POST",
      body: JSON.stringify({
        ...input,
        paymentMethod: "UBUNTUPAY_WALLET",
        idempotencyKey:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random()}`,
      }),
    }
  );
}

export async function listTransactions(walletId: string, direction = "all") {
  return request<{ transactions: Transaction[] }>(
    `/wallets/${walletId}/transactions?direction=${direction}&sortBy=createdAt&sort=desc`
  );
}

export async function getTransaction(walletId: string, transactionId: string) {
  return request<{ transaction: Transaction }>(`/wallets/${walletId}/transactions/${transactionId}`);
}

export async function listNotifications(userId: string) {
  return request<{ notifications: Array<{ id: string; title: string; body: string; status: string; createdAt: string }> }>(
    `/notifications?userId=${encodeURIComponent(userId)}&limit=50`
  );
}

export async function getKycStatus(userId: string) {
  return request<{
    kyc: {
      id: string;
      kycTier: string;
      kycStatus: string;
      idType: string | null;
      createdAt: string;
      updatedAt: string;
    };
  }>(`/kyc/status?userId=${encodeURIComponent(userId)}`);
}

export function toRand(amount: number) {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(amount / 100);
}

