// services/payment-service/src/payshap/payshap.client.ts
// SARB PayShap integration — ISO 20022 pacs.008 payment initiation
// Full mTLS, message signing, and idempotency per SARB PayShap spec v1.0

import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import * as https from 'https';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { Logger } from 'winston';
import { SecretsManager } from '../secrets.manager';

// ISO 20022 Payment Status Codes (per SARB PayShap spec)
export enum PayshapStatus {
  ACCP = 'ACCP',  // AcceptedCustomerProfile
  ACSC = 'ACSC',  // AcceptedSettlementCompleted
  ACSP = 'ACSP',  // AcceptedSettlementInProcess
  RJCT = 'RJCT',  // Rejected
  PDNG = 'PDNG',  // Pending
}

export interface PayshapPaymentRequest {
  msgId: string;            // Unique message ID (UUID) — idempotency
  endToEndId: string;       // End-to-end reference
  amountCents: number;
  currency: string;         // ZAR
  debtorName: string;
  debtorAccountId: string;  // Ahava wallet number
  creditorName: string;
  creditorAccountId: string; // Destination wallet number or bank proxy
  creditorBankBic?: string;  // For inter-bank PayShap
  remittanceInfo?: string;   // Max 140 chars
  requestedExecutionDate?: string; // ISO 8601 date
}

export interface PayshapPaymentResponse {
  msgId: string;
  originalMsgId: string;
  status: PayshapStatus;
  statusReason?: string;
  transactionId?: string;   // SARB assigned transaction ID
  settlementDate?: string;
  rejectionCode?: string;
  rejectionDesc?: string;
  rawResponse: string;      // Full XML response for audit trail
}

export class PayshapClient {
  private client: AxiosInstance | null = null;
  private readonly baseUrl: string;

  constructor(
    private readonly logger: Logger,
    private readonly secrets: SecretsManager,
    private readonly environment: 'sandbox' | 'production',
  ) {
    this.baseUrl = environment === 'production'
      ? 'https://payshap.sarb.gov.za/api/v1'
      : 'https://payshap-sandbox.sarb.gov.za/api/v1';
  }

  private async getClient(): Promise<AxiosInstance> {
    if (this.client) return this.client;

    // Load mTLS certificates from AWS Secrets Manager
    const [certPem, keyPem, caPem, apiKey] = await Promise.all([
      this.secrets.get('/ahava/payshap/client-cert-pem'),
      this.secrets.get('/ahava/payshap/client-key-pem'),
      this.secrets.get('/ahava/payshap/sarb-ca-pem'),
      this.secrets.get('/ahava/payshap/api-key'),
    ]);

    const httpsAgent = new https.Agent({
      cert: certPem,
      key: keyPem,
      ca: caPem,            // SARB root CA — only trust SARB certificates
      rejectUnauthorized: true,
      minVersion: 'TLSv1.3', // SARB requires TLS 1.3
    });

    this.client = axios.create({
      baseURL: this.baseUrl,
      httpsAgent,
      timeout: 30_000,  // 30 second timeout per SARB SLA
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        'X-Institution-Id': 'AHAVA-ZA',
        'User-Agent': 'AhavaEWallet/1.0 (+https://ahava.co.za)',
      },
    });

    // Request interceptor — add message signature (JWS)
    this.client.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
      config.headers = config.headers ?? ({} as any);

      if (config.data) {
        const signature = await this.signMessage(JSON.stringify(config.data));
        (config.headers as Record<string, string>)["X-JWS-Signature"] = signature;
      }

      (config.headers as Record<string, string>)["X-Request-Id"] = crypto.randomUUID();
      (config.headers as Record<string, string>)["X-Timestamp"] = new Date().toISOString();

      return config;
    });

    return this.client;
  }

  /**
   * Initiate a PayShap credit transfer (pacs.008)
   * Called for wallet-to-bank and bank-to-wallet transfers.
   */
  async initiatePayment(request: PayshapPaymentRequest): Promise<PayshapPaymentResponse> {
    const client = await this.getClient();

    // Build ISO 20022 pacs.008 compliant payload
    const payload = this.buildPacs008(request);

    this.logger.info('Initiating PayShap payment', {
      msgId: request.msgId,
      endToEndId: request.endToEndId,
      amountCents: request.amountCents,
    });

    try {
      const response = await client.post('/payments/credit-transfer', payload);

      const result: PayshapPaymentResponse = {
        msgId: request.msgId,
        originalMsgId: response.data.originalMsgId,
        status: response.data.status as PayshapStatus,
        statusReason: response.data.statusReason,
        transactionId: response.data.transactionId,
        settlementDate: response.data.settlementDate,
        rawResponse: JSON.stringify(response.data),
      };

      this.logger.info('PayShap payment response received', {
        msgId: request.msgId,
        status: result.status,
        transactionId: result.transactionId,
      });

      return result;
    } catch (error: any) {
      this.logger.error('PayShap payment failed', {
        msgId: request.msgId,
        status: error.response?.status,
        error: error.response?.data,
      });

      // Map PayShap rejection codes to internal error context
      const rejectionCode = error.response?.data?.rejectionCode;
      const rejectionDesc = error.response?.data?.rejectionDescription;

      return {
        msgId: request.msgId,
        originalMsgId: request.msgId,
        status: PayshapStatus.RJCT,
        rejectionCode,
        rejectionDesc,
        rawResponse: JSON.stringify(error.response?.data ?? {}),
      };
    }
  }

  /**
   * Query payment status — for polling pending transactions
   */
  async queryStatus(msgId: string): Promise<PayshapPaymentResponse> {
    const client = await this.getClient();

    const response = await client.get(`/payments/${msgId}/status`);
    return {
      msgId,
      originalMsgId: msgId,
      status: response.data.status as PayshapStatus,
      statusReason: response.data.statusReason,
      transactionId: response.data.transactionId,
      settlementDate: response.data.settlementDate,
      rawResponse: JSON.stringify(response.data),
    };
  }

  /**
   * Build ISO 20022 pacs.008.001.08 message structure
   * Per SARB PayShap Implementation Guide v1.0
   */
  private buildPacs008(request: PayshapPaymentRequest) {
    const amountDecimal = (request.amountCents / 100).toFixed(2);

    return {
      Document: {
        FIToFICstmrCdtTrf: {
          GrpHdr: {
            MsgId: request.msgId,
            CreDtTm: new Date().toISOString(),
            NbOfTxs: '1',
            SttlmInf: { SttlmMtd: 'CLRG' },
            PmtTpInf: { SvcLvl: { Cd: 'SEPA' }, LclInstrm: { Prtry: 'PAYSHAP' } },
          },
          CdtTrfTxInf: {
            PmtId: {
              InstrId: request.msgId,
              EndToEndId: request.endToEndId,
            },
            IntrBkSttlmAmt: {
              Ccy: request.currency,
              Value: amountDecimal,
            },
            IntrBkSttlmDt: request.requestedExecutionDate ?? new Date().toISOString().split('T')[0],
            Dbtr: { Nm: request.debtorName },
            DbtrAcct: { Id: { Othr: { Id: request.debtorAccountId, SchmeNm: { Prtry: 'AHAVA_WALLET' } } } },
            DbtrAgt: { FinInstnId: { BIC: 'AHAVAZAJ' } }, // Ahava BIC placeholder
            Cdtr: { Nm: request.creditorName },
            CdtrAcct: { Id: { Othr: { Id: request.creditorAccountId, SchmeNm: { Prtry: request.creditorBankBic ? 'IBAN' : 'AHAVA_WALLET' } } } },
            CdtrAgt: request.creditorBankBic
              ? { FinInstnId: { BIC: request.creditorBankBic } }
              : { FinInstnId: { BIC: 'AHAVAZAJ' } },
            RmtInf: request.remittanceInfo
              ? { Ustrd: request.remittanceInfo.substring(0, 140) }
              : undefined,
          },
        },
      },
    };
  }

  /**
   * JWS message signing per SARB PayShap Security Requirements
   * Uses RS256 with the Ahava signing certificate
   */
  private async signMessage(payload: string): Promise<string> {
    const signingKey = await this.secrets.get('/ahava/payshap/signing-key-pem');
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(payload);
    return sign.sign(signingKey, 'base64url');
  }
}
