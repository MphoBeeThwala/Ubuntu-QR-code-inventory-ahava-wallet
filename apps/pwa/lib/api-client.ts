// apps/pwa/lib/api-client.ts
// Shared API client for all frontend apps
// Handles: JWT auth, error handling, idempotency, retries

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { v4 as uuidv4 } from 'uuid';

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    statusCode: number;
  };
}

class AhavaApiClient {
  private client: AxiosInstance;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  constructor(baseURL: string = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000') {
    this.client = axios.create({
      baseURL,
      timeout: 10000,
    });

    // Request interceptor: add auth headers + idempotency key
    this.client.interceptors.request.use((config) => {
      if (this.accessToken) {
        config.headers.Authorization = `Bearer ${this.accessToken}`;
      }
      config.headers['X-Idempotency-Key'] = uuidv4();
      config.headers['X-Device-ID'] = this.getDeviceId();
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
      }
    );
  }

  // Auth Methods
  async login(phone: string, pin: string): Promise<ApiResponse<{ accessToken: string; refreshToken: string }>> {
    const response = await this.client.post('/auth/login', { phone, pin });
    const { data } = response.data;
    this.accessToken = data.accessToken;
    this.refreshToken = data.refreshToken;
    return response.data;
  }

  async register(phone: string, pin: string): Promise<ApiResponse<{ userId: string; accessToken: string }>> {
    const response = await this.client.post('/auth/register', { phone, pin });
    const { data } = response.data;
    this.accessToken = data.accessToken;
    return response.data;
  }

  async refresh(): Promise<ApiResponse> {
    const response = await this.client.post('/auth/refresh', {
      refreshToken: this.refreshToken,
    });
    const { data } = response.data;
    this.accessToken = data.accessToken;
    return response.data;
  }

  logout() {
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  }

  // Wallet Methods
  async getBalance(walletId: string): Promise<ApiResponse<{ balanceCents: number; pendingCents: number }>> {
    const response = await this.client.get(`/wallet/${walletId}/balance`);
    return response.data;
  }

  async getTransactionHistory(walletId: string, limit = 20, offset = 0): Promise<ApiResponse> {
    const response = await this.client.get(`/wallet/${walletId}/transactions`, {
      params: { limit, offset },
    });
    return response.data;
  }

  // Payment Methods
  async sendPayment(
    recipientPhone: string,
    amountCents: number,
    description?: string
  ): Promise<ApiResponse<{ transactionId: string }>> {
    const response = await this.client.post('/payments', {
      recipientPhone,
      amountCents,
      description,
    });
    return response.data;
  }

  // KYC Methods
  async getKycStatus(userId: string): Promise<ApiResponse> {
    const response = await this.client.get(`/kyc/user/${userId}`);
    return response.data;
  }

  async uploadKycDocument(file: File, documentType: string): Promise<ApiResponse> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('documentType', documentType);
    const response = await this.client.post('/kyc/document/upload', formData);
    return response.data;
  }

  // Helper Methods
  private getDeviceId(): string {
    let deviceId = localStorage.getItem('deviceId');
    if (!deviceId) {
      deviceId = uuidv4();
      localStorage.setItem('deviceId', deviceId);
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
