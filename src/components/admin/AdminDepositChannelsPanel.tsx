import React, { useCallback, useEffect, useState } from 'react';
import {
  Building2,
  QrCode,
  Link2,
  Coins,
  Plus,
  Edit3,
  Power,
  Upload,
  ShieldCheck,
  X,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { at, type AdminLang } from './adminI18n';

type ChannelCategory = 'bank_transfer' | 'qr_payment' | 'payment_url' | 'usdt_trc20';

const CATEGORY_LABELS: Record<AdminLang, Record<ChannelCategory, string>> = {
  en: {
    bank_transfer: 'Bank Transfer',
    qr_payment: 'QR Payment',
    payment_url: 'Payment URL',
    usdt_trc20: 'USDT (TRC20)',
  },
  'zh-CN': {
    bank_transfer: '银行转账',
    qr_payment: '二维码支付',
    payment_url: '支付链接',
    usdt_trc20: 'USDT (TRC20)',
  },
  km: {
    bank_transfer: 'ផ្ទេរប្រាក់តាមធនាគារ',
    qr_payment: 'បង់ប្រាក់តាម QR',
    payment_url: 'តំណភ្ជាប់ទូទាត់',
    usdt_trc20: 'USDT (TRC20)',
  },
};

function emptyForm(category: ChannelCategory) {
  return {
    id: null as number | null,
    category,
    name:
      category === 'bank_transfer'
        ? 'Bank Transfer'
        : category === 'qr_payment'
          ? 'QR Payment'
          : category === 'payment_url'
            ? 'Online Checkout'
            : 'USDT (TRC20)',
    currency: category === 'usdt_trc20' ? 'USDT' : 'USD',
    minAmount: category === 'usdt_trc20' ? 20 : 10,
    maxAmount: 50000,
    instructionsText:
      category === 'bank_transfer'
        ? 'Transfer the exact order amount to the bank account below.\nInclude your Order ID in the transfer memo.\nSubmit your bank reference for finance verification.'
        : category === 'qr_payment'
          ? 'Scan the QR code and pay the exact order amount.\nSubmit your payment reference / UTR for verification.'
          : category === 'payment_url'
            ? 'Open the approved HTTPS payment link and complete payment.\nSubmit your transaction reference for verification.'
            : 'Send ONLY USDT on the TRON (TRC20) network to the address below.\nSubmit your TxID hash for verification.',
    enabled: true,
    adminPassword: '',
    // Bank Transfer
    bankName: '',
    accountHolderName: '',
    accountNumber: '',
    country: '',
    branch: '',
    routingCode: '',
    // QR Payment
    merchantName: '',
    qrPayload: '',
    qrImagePath: '',
    // Payment URL
    paymentUrl: '',
    description: '',
    // USDT TRC20
    walletAddress: '',
  };
}

export function AdminDepositChannelsPanel({
  adminLang,
  onNotify,
}: {
  adminLang: AdminLang;
  onNotify: (msg: string, isError?: boolean) => void;
}) {
  const [channels, setChannels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ReturnType<typeof emptyForm> | null>(null);
  const [originalSensitiveValue, setOriginalSensitiveValue] = useState<string>('');
  const [uploadingQr, setUploadingQr] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadChannels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/admin/deposit-channels');
      setChannels(res.items || []);
    } catch (err: any) {
      onNotify(err?.message || 'Unable to load deposit channels', true);
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  const startCreate = (category: ChannelCategory) => {
    setOriginalSensitiveValue('');
    setEditing(emptyForm(category));
  };

  const startEdit = (ch: any) => {
    const d = ch.details || {};
    const cat = ch.category as ChannelCategory;
    setOriginalSensitiveValue(
      cat === 'bank_transfer'
        ? String(d.accountNumber || '')
        : cat === 'usdt_trc20'
          ? String(d.walletAddress || '')
          : ''
    );
    setEditing({
      id: ch.id,
      category: cat,
      name: ch.name || '',
      currency: ch.currency || 'USD',
      minAmount: Number(ch.minAmount || 10),
      maxAmount: Number(ch.maxAmount || 50000),
      instructionsText: Array.isArray(ch.instructions) ? ch.instructions.join('\n') : '',
      enabled: Boolean(ch.enabled),
      adminPassword: '',
      bankName: d.bankName || '',
      accountHolderName: d.accountHolderName || '',
      accountNumber: d.accountNumber || '',
      country: d.country || '',
      branch: d.branch || '',
      routingCode: d.routingCode || '',
      merchantName: d.merchantName || '',
      qrPayload: d.qrPayload || '',
      qrImagePath: d.qrImagePath || '',
      paymentUrl: d.paymentUrl || '',
      description: d.description || '',
      walletAddress: d.walletAddress || '',
    });
  };

  const handleQrFileUpload = async (file: File) => {
    if (!editing) return;
    setUploadingQr(true);
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read image file.'));
        reader.readAsDataURL(file);
      });
      const res = await apiFetch<{ qrImagePath: string }>('/api/admin/deposit-channels/qr-upload', {
        method: 'POST',
        body: JSON.stringify({
          mimeType: file.type,
          dataBase64,
        }),
      });
      setEditing({ ...editing, qrImagePath: res.qrImagePath });
      onNotify('QR image uploaded to persistent server storage.');
    } catch (err: any) {
      onNotify(err?.message || 'QR upload failed', true);
    } finally {
      setUploadingQr(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      const details =
        editing.category === 'bank_transfer'
          ? {
              bankName: editing.bankName,
              accountHolderName: editing.accountHolderName,
              accountNumber: editing.accountNumber,
              country: editing.country,
              branch: editing.branch,
              routingCode: editing.routingCode,
            }
          : editing.category === 'qr_payment'
            ? {
                merchantName: editing.merchantName,
                qrPayload: editing.qrPayload,
                qrImagePath: editing.qrImagePath,
              }
            : editing.category === 'payment_url'
              ? {
                  paymentUrl: editing.paymentUrl,
                  description: editing.description,
                }
              : {
                  network: 'TRON (TRC20)',
                  walletAddress: editing.walletAddress,
                  qrImagePath: editing.qrImagePath,
                };

      const payload = {
        category: editing.category,
        name: editing.name,
        currency: editing.currency,
        minAmount: Number(editing.minAmount),
        maxAmount: Number(editing.maxAmount),
        instructionsText: editing.instructionsText,
        enabled: editing.enabled,
        details,
        ...(editing.adminPassword ? { adminPassword: editing.adminPassword } : {}),
      };

      if (editing.id) {
        await apiFetch(`/api/admin/deposit-channels/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        onNotify('Deposit payment channel updated in PostgreSQL.');
      } else {
        await apiFetch('/api/admin/deposit-channels', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        onNotify('Deposit payment channel created in PostgreSQL.');
      }
      setEditing(null);
      await loadChannels();
    } catch (err: any) {
      onNotify(err?.message || 'Unable to save payment channel', true);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (ch: any) => {
    try {
      await apiFetch(`/api/admin/deposit-channels/${ch.id}/toggle`, {
        method: 'POST',
        body: JSON.stringify({ enabled: !ch.enabled }),
      });
      onNotify(`Channel "${ch.name}" ${!ch.enabled ? 'enabled' : 'disabled'}.`);
      await loadChannels();
    } catch (err: any) {
      onNotify(err?.message || 'Toggle failed', true);
    }
  };

  const needsReauth =
    editing &&
    ((editing.category === 'bank_transfer' &&
      (!editing.id || editing.accountNumber.trim() !== originalSensitiveValue)) ||
      (editing.category === 'usdt_trc20' &&
        (!editing.id || editing.walletAddress.trim() !== originalSensitiveValue)));

  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-display font-bold text-slate-900">
            {at(adminLang, 'payment_channels')}
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Active channels configured here are synchronized live to all players in Wallet → Deposit.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => startCreate('bank_transfer')}
            className="h-8 px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold inline-flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> {CATEGORY_LABELS[adminLang].bank_transfer}
          </button>
          <button
            type="button"
            onClick={() => startCreate('qr_payment')}
            className="h-8 px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold inline-flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> {CATEGORY_LABELS[adminLang].qr_payment}
          </button>
          <button
            type="button"
            onClick={() => startCreate('payment_url')}
            className="h-8 px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold inline-flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> {CATEGORY_LABELS[adminLang].payment_url}
          </button>
          <button
            type="button"
            onClick={() => startCreate('usdt_trc20')}
            className="h-8 px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold inline-flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> {CATEGORY_LABELS[adminLang].usdt_trc20}
          </button>
        </div>
      </div>

      {/* Configured Channels List */}
      {loading ? (
        <div className="py-6 text-center text-slate-400">Loading deposit channels...</div>
      ) : channels.length === 0 ? (
        <div className="p-6 rounded-xl bg-slate-50 border border-dashed border-slate-200 text-center text-slate-500">
          No deposit payment channels configured yet. Add a Bank Transfer, QR Payment, Payment URL, or USDT (TRC20) channel above.
        </div>
      ) : (
        <div className="space-y-2.5">
          {channels.map((ch) => (
            <div
              key={ch.id}
              className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0 text-[#D92D20]">
                  {ch.category === 'bank_transfer' && <Building2 className="w-4 h-4" />}
                  {ch.category === 'qr_payment' && <QrCode className="w-4 h-4" />}
                  {ch.category === 'payment_url' && <Link2 className="w-4 h-4" />}
                  {ch.category === 'usdt_trc20' && <Coins className="w-4 h-4" />}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-slate-900">{ch.name}</span>
                    <span className="px-2 py-0.5 rounded bg-white border border-slate-200 text-[10px] font-semibold text-slate-600">
                      {CATEGORY_LABELS[adminLang][ch.category as ChannelCategory] || ch.category}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-slate-200/70 text-[10px] font-mono-num text-slate-700">
                      {ch.currency} · v{ch.version}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        ch.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {ch.enabled ? at(adminLang, 'enabled') : 'Disabled'}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-600 mt-1 truncate">
                    {ch.category === 'bank_transfer' &&
                      `${ch.details?.bankName} · ${ch.details?.accountHolderName} · ${ch.details?.accountNumber}`}
                    {ch.category === 'qr_payment' &&
                      `${ch.details?.merchantName} ${ch.details?.qrImagePath ? '· QR Image Uploaded' : ''}`}
                    {ch.category === 'payment_url' && ch.details?.paymentUrl}
                    {ch.category === 'usdt_trc20' &&
                      `${ch.details?.network} · ${ch.details?.walletAddress}`}
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono-num">
                    Min {ch.minAmount} {ch.currency} — Max {ch.maxAmount} {ch.currency}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => handleToggle(ch)}
                  className={`h-8 px-2.5 rounded-lg font-semibold inline-flex items-center gap-1 ${
                    ch.enabled
                      ? 'bg-amber-50 hover:bg-amber-100 text-amber-800'
                      : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700'
                  }`}
                >
                  <Power className="w-3.5 h-3.5" />
                  {ch.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  type="button"
                  onClick={() => startEdit(ch)}
                  className="h-8 px-2.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold inline-flex items-center gap-1"
                >
                  <Edit3 className="w-3.5 h-3.5" /> Edit
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleSave}
            className="bg-white rounded-2xl max-w-xl w-full p-5 space-y-3.5 shadow-2xl my-8"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h4 className="text-sm font-display font-bold text-slate-900">
                {editing.id ? 'Edit' : 'Add'} {CATEGORY_LABELS[adminLang][editing.category]} Channel
              </h4>
              <button type="button" onClick={() => setEditing(null)}>
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Payment Method Name *</label>
                <input
                  type="text"
                  required
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="w-full h-9 px-3 rounded-lg bg-slate-50 border border-slate-200"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Currency *</label>
                <input
                  type="text"
                  required
                  disabled={editing.category === 'usdt_trc20'}
                  value={editing.currency}
                  onChange={(e) => setEditing({ ...editing, currency: e.target.value.toUpperCase() })}
                  className="w-full h-9 px-3 rounded-lg bg-slate-50 border border-slate-200 uppercase font-mono-num disabled:opacity-60"
                />
              </div>
            </div>

            {editing.category === 'bank_transfer' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Bank Name *</label>
                  <input
                    type="text"
                    required
                    value={editing.bankName}
                    onChange={(e) => setEditing({ ...editing, bankName: e.target.value })}
                    className="w-full h-9 px-3 rounded-lg bg-white border border-slate-200"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Account Holder Name *</label>
                  <input
                    type="text"
                    required
                    value={editing.accountHolderName}
                    onChange={(e) => setEditing({ ...editing, accountHolderName: e.target.value })}
                    className="w-full h-9 px-3 rounded-lg bg-white border border-slate-200"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Bank Account Number *</label>
                  <input
                    type="text"
                    required
                    value={editing.accountNumber}
                    onChange={(e) => setEditing({ ...editing, accountNumber: e.target.value })}
                    className="w-full h-9 px-3 rounded-lg bg-white border border-slate-200 font-mono-num"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Country *</label>
                  <input
                    type="text"
                    required
                    value={editing.country}
                    onChange={(e) => setEditing({ ...editing, country: e.target.value })}
                    className="w-full h-9 px-3 rounded-lg bg-white border border-slate-200"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Bank Branch (optional)</label>
                  <input
                    type="text"
                    value={editing.branch}
                    onChange={(e) => setEditing({ ...editing, branch: e.target.value })}
                    className="w-full h-9 px-3 rounded-lg bg-white border border-slate-200"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">SWIFT / Routing Code (optional)</label>
                  <input
                    type="text"
                    value={editing.routingCode}
                    onChange={(e) => setEditing({ ...editing, routingCode: e.target.value })}
                    className="w-full h-9 px-3 rounded-lg bg-white border border-slate-200 font-mono-num"
                  />
                </div>
              </div>
            )}

            {editing.category === 'qr_payment' && (
              <div className="space-y-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Recipient / Merchant Name *</label>
                  <input
                    type="text"
                    required
                    value={editing.merchantName}
                    onChange={(e) => setEditing({ ...editing, merchantName: e.target.value })}
                    className="w-full h-9 px-3 rounded-lg bg-white border border-slate-200"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Upload QR Image (PNG, JPG, WebP — max 2MB)
                  </label>
                  <div className="flex items-center gap-3">
                    <label className="h-9 px-3 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 cursor-pointer inline-flex items-center gap-1.5 font-semibold text-slate-700">
                      <Upload className="w-3.5 h-3.5" />
                      <span>{uploadingQr ? 'Uploading...' : 'Choose QR Image'}</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleQrFileUpload(f);
                        }}
                      />
                    </label>
                    {editing.qrImagePath && (
                      <img
                        src={editing.qrImagePath}
                        alt="Uploaded QR Preview"
                        className="w-12 h-12 rounded-lg border border-slate-200 object-contain bg-white"
                      />
                    )}
                  </div>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Payment Payload / QR URL (optional if QR image uploaded)
                  </label>
                  <input
                    type="text"
                    value={editing.qrPayload}
                    onChange={(e) => setEditing({ ...editing, qrPayload: e.target.value })}
                    placeholder="e.g. upi://pay?... or merchant payment string"
                    className="w-full h-9 px-3 rounded-lg bg-white border border-slate-200 font-mono-num"
                  />
                </div>
              </div>
            )}

            {editing.category === 'payment_url' && (
              <div className="space-y-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Approved HTTPS Payment URL *</label>
                  <input
                    type="url"
                    required
                    value={editing.paymentUrl}
                    onChange={(e) => setEditing({ ...editing, paymentUrl: e.target.value })}
                    placeholder="https://pay.example.com/checkout"
                    className="w-full h-9 px-3 rounded-lg bg-white border border-slate-200 font-mono-num"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Description *</label>
                  <input
                    type="text"
                    required
                    value={editing.description}
                    onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                    className="w-full h-9 px-3 rounded-lg bg-white border border-slate-200"
                  />
                </div>
              </div>
            )}

            {editing.category === 'usdt_trc20' && (
              <div className="space-y-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="flex items-center justify-between text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg">
                  <span>Blockchain Network: TRON (TRC20)</span>
                  <span>No private keys stored</span>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Receiving TRC20 Wallet Address (starts with T, 34 chars) *
                  </label>
                  <input
                    type="text"
                    required
                    value={editing.walletAddress}
                    onChange={(e) => setEditing({ ...editing, walletAddress: e.target.value.trim() })}
                    placeholder="T..."
                    className="w-full h-9 px-3 rounded-lg bg-white border border-slate-200 font-mono-num"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Wallet QR Image (optional — PNG, JPG, WebP)
                  </label>
                  <div className="flex items-center gap-3">
                    <label className="h-9 px-3 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 cursor-pointer inline-flex items-center gap-1.5 font-semibold text-slate-700">
                      <Upload className="w-3.5 h-3.5" />
                      <span>{uploadingQr ? 'Uploading...' : 'Upload Wallet QR'}</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleQrFileUpload(f);
                        }}
                      />
                    </label>
                    {editing.qrImagePath && (
                      <img
                        src={editing.qrImagePath}
                        alt="Wallet QR Preview"
                        className="w-12 h-12 rounded-lg border border-slate-200 object-contain bg-white"
                      />
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Minimum Deposit *</label>
                <input
                  type="number"
                  required
                  min={1}
                  step="any"
                  value={editing.minAmount}
                  onChange={(e) => setEditing({ ...editing, minAmount: Number(e.target.value) })}
                  className="w-full h-9 px-3 rounded-lg bg-slate-50 border border-slate-200 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Maximum Deposit *</label>
                <input
                  type="number"
                  required
                  min={1}
                  step="any"
                  value={editing.maxAmount}
                  onChange={(e) => setEditing({ ...editing, maxAmount: Number(e.target.value) })}
                  className="w-full h-9 px-3 rounded-lg bg-slate-50 border border-slate-200 font-mono-num"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Deposit Instructions (one step per line) *
              </label>
              <textarea
                rows={3}
                required
                value={editing.instructionsText}
                onChange={(e) => setEditing({ ...editing, instructionsText: e.target.value })}
                className="w-full p-2.5 rounded-lg bg-slate-50 border border-slate-200"
              />
            </div>

            {needsReauth && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 space-y-1.5">
                <div className="flex items-center gap-1.5 font-bold text-rose-800">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Administrator Reauthentication Required</span>
                </div>
                <p className="text-[11px] text-rose-700">
                  Enter your current administrator password to save receiving bank account or crypto wallet changes.
                </p>
                <input
                  type="password"
                  required
                  value={editing.adminPassword}
                  onChange={(e) => setEditing({ ...editing, adminPassword: e.target.value })}
                  placeholder="Enter your administrator password"
                  className="w-full h-9 px-3 rounded-lg bg-white border border-rose-200"
                />
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <label className="inline-flex items-center gap-2 font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={editing.enabled}
                  onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
                />
                <span>Channel Enabled for Players</span>
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="h-9 px-4 rounded-lg border border-slate-200 text-slate-700 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || uploadingQr}
                  className="h-9 px-5 rounded-lg bg-[#D92D20] hover:bg-[#B42318] text-white font-semibold disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Channel'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
