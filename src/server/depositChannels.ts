import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { asc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { depositChannels } from '../db/schema.ts';

export type DepositChannelCategory = 'bank_transfer' | 'qr_payment' | 'payment_url' | 'usdt_trc20';

export interface BankTransferDetails {
  bankName: string;
  accountHolderName: string;
  accountNumber: string;
  country: string;
  branch?: string;
  routingCode?: string;
}

export interface QrPaymentDetails {
  merchantName: string;
  qrPayload?: string;
  qrImagePath?: string;
}

export interface PaymentUrlDetails {
  paymentUrl: string;
  description: string;
}

export interface UsdtTrc20Details {
  network: 'TRON (TRC20)';
  walletAddress: string;
  qrImagePath?: string;
}

export type DepositChannelDetails =
  | BankTransferDetails
  | QrPaymentDetails
  | PaymentUrlDetails
  | UsdtTrc20Details;

export interface DepositChannelDTO {
  id: number;
  code: string;
  category: DepositChannelCategory;
  name: string;
  subtitle: string;
  currency: string;
  minAmount: number;
  maxAmount: number;
  bonusRate: number;
  presets: number[];
  instructions: string[];
  details: DepositChannelDetails;
  enabled: boolean;
  configured: boolean;
  version: number;
  updatedAt: string;
}

export const QR_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'qr');
const MAX_QR_BYTES = 2 * 1024 * 1024; // 2MB

export function validateHttpsPaymentUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 500) return null;
  if (/[\s\u0000-\u001f]/.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return null;
    if (!parsed.hostname || !parsed.hostname.includes('.')) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function validateTronTrc20Address(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(trimmed)) return null;
  return trimmed;
}

export function saveQrImageFromBase64(params: {
  mimeType: string;
  dataBase64: string;
}): { qrImagePath: string; filename: string; bytes: number } {
  const mime = params.mimeType.toLowerCase().trim();
  const base64Clean = params.dataBase64.replace(/^data:[^;]+;base64,/, '').trim();
  const buf = Buffer.from(base64Clean, 'base64');

  if (buf.length === 0 || buf.length > MAX_QR_BYTES) {
    throw new Error('QR image must be between 1 byte and 2 MB.');
  }

  let ext: 'png' | 'jpg' | 'webp' | null = null;
  // Verify file magic bytes so executable or disguised files are rejected
  if (
    mime === 'image/png' &&
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    ext = 'png';
  } else if (
    (mime === 'image/jpeg' || mime === 'image/jpg') &&
    buf.length >= 3 &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[2] === 0xff
  ) {
    ext = 'jpg';
  } else if (
    mime === 'image/webp' &&
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    ext = 'webp';
  }

  if (!ext) {
    throw new Error('Only valid PNG, JPG, or WebP image files are allowed.');
  }

  fs.mkdirSync(QR_UPLOAD_DIR, { recursive: true });
  const filename = `qr_${crypto.randomUUID()}.${ext}`;
  const fullPath = path.join(QR_UPLOAD_DIR, filename);
  fs.writeFileSync(fullPath, buf);

  return {
    qrImagePath: `/api/wallet/qr-images/${filename}`,
    filename,
    bytes: buf.length,
  };
}

export function resolveSafeQrFilePath(rawFilename: string): { filePath: string; contentType: string } | null {
  const name = path.basename(String(rawFilename || ''));
  const match = name.match(/^qr_[a-f0-9-]+\.(png|jpg|webp)$/i);
  if (!match) return null;
  const fullPath = path.resolve(QR_UPLOAD_DIR, name);
  if (!fullPath.startsWith(QR_UPLOAD_DIR)) return null;
  if (!fs.existsSync(fullPath)) return null;
  const ext = match[1].toLowerCase();
  const contentType = ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : 'image/webp';
  return { filePath: fullPath, contentType };
}

export function mapDbChannelToDto(row: typeof depositChannels.$inferSelect): DepositChannelDTO {
  const details = (row.detailsJson || {}) as DepositChannelDetails;
  return {
    id: row.id,
    code: row.code,
    category: row.category as DepositChannelCategory,
    name: row.name,
    subtitle: row.subtitle,
    currency: row.currency,
    minAmount: parseFloat(row.minAmount),
    maxAmount: parseFloat(row.maxAmount),
    bonusRate: parseFloat(row.bonusRate),
    presets: Array.isArray(row.presetsJson) ? (row.presetsJson as number[]).map(Number) : [100, 200, 500, 1000, 5000],
    instructions: Array.isArray(row.instructionsJson) ? (row.instructionsJson as string[]).map(String) : [],
    details,
    enabled: row.enabled,
    configured: true,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listDepositChannels(options?: { onlyEnabled?: boolean }): Promise<DepositChannelDTO[]> {
  const rows = options?.onlyEnabled
    ? await db.select().from(depositChannels).where(eq(depositChannels.enabled, true)).orderBy(asc(depositChannels.id))
    : await db.select().from(depositChannels).orderBy(asc(depositChannels.id));
  return rows.map(mapDbChannelToDto);
}

export function validateAndNormalizeChannelPayload(input: any): {
  category: DepositChannelCategory;
  name: string;
  subtitle: string;
  currency: string;
  minAmount: number;
  maxAmount: number;
  bonusRate: number;
  presets: number[];
  instructions: string[];
  details: DepositChannelDetails;
  enabled: boolean;
} {
  const category = String(input.category || '') as DepositChannelCategory;
  if (!['bank_transfer', 'qr_payment', 'payment_url', 'usdt_trc20'].includes(category)) {
    throw new Error('Invalid payment channel category.');
  }

  const name = String(input.name || '').trim().slice(0, 80);
  if (name.length < 2) throw new Error('Payment method name is required.');

  const currency =
    category === 'usdt_trc20'
      ? 'USDT'
      : String(input.currency || 'USD')
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '')
          .slice(0, 10) || 'USD';

  const minAmount = Number(input.minAmount);
  const maxAmount = Number(input.maxAmount);
  if (!Number.isFinite(minAmount) || minAmount <= 0) {
    throw new Error('Minimum deposit must be greater than 0.');
  }
  if (!Number.isFinite(maxAmount) || maxAmount < minAmount) {
    throw new Error('Maximum deposit must be greater than or equal to minimum deposit.');
  }

  const bonusRate = Math.max(0, Math.min(50, Number(input.bonusRate || 0)));
  const presets = Array.isArray(input.presets)
    ? input.presets.map(Number).filter((n: number) => Number.isFinite(n) && n > 0).slice(0, 8)
    : [100, 200, 500, 1000, 5000];

  const instructions = Array.isArray(input.instructions)
    ? input.instructions.map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 10)
    : String(input.instructionsText || '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 10);

  if (instructions.length === 0) {
    throw new Error('Deposit instructions are required.');
  }

  const rawDetails = input.details || {};
  let details: DepositChannelDetails;
  let subtitle = String(input.subtitle || '').trim().slice(0, 80);

  if (category === 'bank_transfer') {
    const bankName = String(rawDetails.bankName || '').trim().slice(0, 80);
    const accountHolderName = String(rawDetails.accountHolderName || '').trim().slice(0, 100);
    const accountNumber = String(rawDetails.accountNumber || '').trim().slice(0, 60);
    const country = String(rawDetails.country || '').trim().slice(0, 60);
    const branch = String(rawDetails.branch || '').trim().slice(0, 80);
    const routingCode = String(rawDetails.routingCode || '').trim().slice(0, 40);

    if (!bankName || !accountHolderName || !accountNumber || !country) {
      throw new Error('Bank name, account holder name, account number, and country are required.');
    }
    details = {
      bankName,
      accountHolderName,
      accountNumber,
      country,
      ...(branch ? { branch } : {}),
      ...(routingCode ? { routingCode } : {}),
    };
    if (!subtitle) subtitle = `${bankName} (${currency})`;
  } else if (category === 'qr_payment') {
    const merchantName = String(rawDetails.merchantName || '').trim().slice(0, 100);
    const qrPayload = String(rawDetails.qrPayload || '').trim().slice(0, 500);
    const qrImagePath = String(rawDetails.qrImagePath || '').trim().slice(0, 200);
    if (!merchantName) {
      throw new Error('Recipient or merchant name is required for QR payment.');
    }
    if (!qrPayload && !qrImagePath) {
      throw new Error('Upload a QR image or provide a valid payment payload/URL.');
    }
    if (qrPayload && qrPayload.toLowerCase().startsWith('javascript:')) {
      throw new Error('Unsafe QR payload rejected.');
    }
    if (qrImagePath && !resolveSafeQrFilePath(qrImagePath.replace('/api/wallet/qr-images/', ''))) {
      throw new Error('Uploaded QR image file was not found.');
    }
    details = {
      merchantName,
      ...(qrPayload ? { qrPayload } : {}),
      ...(qrImagePath ? { qrImagePath } : {}),
    };
    if (!subtitle) subtitle = `${merchantName} (${currency})`;
  } else if (category === 'payment_url') {
    const validUrl = validateHttpsPaymentUrl(String(rawDetails.paymentUrl || ''));
    const description = String(rawDetails.description || '').trim().slice(0, 200);
    if (!validUrl) {
      throw new Error('A valid HTTPS payment URL is required (http/javascript URLs are blocked).');
    }
    if (!description) {
      throw new Error('Payment URL description is required.');
    }
    details = {
      paymentUrl: validUrl,
      description,
    };
    if (!subtitle) subtitle = `HTTPS Checkout (${currency})`;
  } else {
    // usdt_trc20
    const validAddr = validateTronTrc20Address(String(rawDetails.walletAddress || ''));
    const qrImagePath = String(rawDetails.qrImagePath || '').trim().slice(0, 200);
    if (!validAddr) {
      throw new Error('Invalid TRON (TRC20) wallet address. Must start with T and be 34 Base58 characters.');
    }
    if (qrImagePath && !resolveSafeQrFilePath(qrImagePath.replace('/api/wallet/qr-images/', ''))) {
      throw new Error('Uploaded QR image file was not found.');
    }
    details = {
      network: 'TRON (TRC20)',
      walletAddress: validAddr,
      ...(qrImagePath ? { qrImagePath } : {}),
    };
    if (!subtitle) subtitle = 'TRON (TRC20)';
  }

  return {
    category,
    name,
    subtitle,
    currency,
    minAmount,
    maxAmount,
    bonusRate,
    presets: presets.length ? presets : [100, 200, 500, 1000, 5000],
    instructions,
    details,
    enabled: Boolean(input.enabled),
  };
}

export function buildDepositSnapshot(channel: DepositChannelDTO) {
  return {
    channelId: channel.id,
    channelCode: channel.code,
    channelVersion: channel.version,
    category: channel.category,
    name: channel.name,
    currency: channel.currency,
    minAmount: channel.minAmount,
    maxAmount: channel.maxAmount,
    details: channel.details,
    instructions: channel.instructions,
    capturedAt: new Date().toISOString(),
  };
}
