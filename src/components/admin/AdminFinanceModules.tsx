import React, { useEffect, useState, useCallback } from 'react';
import {
  Search,
  Scale,
  PlusCircle,
  CheckCircle2,
  XCircle,
  RotateCcw,
  X,
} from 'lucide-react';
import { apiFetch, formatCurrency } from '../../lib/api';
import { at, type AdminLang } from './adminI18n';

// =========================================================================
// MODULE 9: WALLET MANAGEMENT & AUDITABLE ADJUSTMENTS
// =========================================================================
export function AdminWalletsModule({
  adminLang,
  currentUserRole,
  onNotify,
}: {
  adminLang: AdminLang;
  currentUserRole: string;
  onNotify: (msg: string, isError?: boolean) => void;
}) {
  const [items, setItems] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [reconcile, setReconcile] = useState<any>(null);
  const [adjustTarget, setAdjustTarget] = useState<any>(null);
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const qs = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
    const res = await apiFetch(`/api/admin/wallets${qs}`);
    setItems(res.items || []);
  }, [search]);

  useEffect(() => {
    load().catch((e) => onNotify(e?.message || 'Unable to load wallets', true));
  }, [load, onNotify]);

  const handleReconcile = async () => {
    try {
      const res = await apiFetch('/api/admin/finance/reconcile');
      setReconcile(res);
      onNotify(
        res.discrepancyCount === 0
          ? `Ledger reconciled cleanly across ${res.checkedWallets} wallets.`
          : `Found ${res.discrepancyCount} discrepancy(ies)!`,
        res.discrepancyCount > 0
      );
    } catch (err: any) {
      onNotify(err?.message || 'Reconciliation failed', true);
    }
  };

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustTarget) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/admin/wallets/${adjustTarget.userId}/adjust`, {
        method: 'POST',
        body: JSON.stringify({
          direction,
          amount: Number(amount),
          reason: reason.trim(),
          idempotencyKey: `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        }),
      });
      onNotify('Audited wallet adjustment applied to PostgreSQL ledger.');
      setAdjustTarget(null);
      setAmount('');
      setReason('');
      await load();
    } catch (err: any) {
      onNotify(err?.message || 'Wallet adjustment failed', true);
    } finally {
      setSubmitting(false);
    }
  };

  const canAdjust = ['super_admin', 'finance'].includes(currentUserRole);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search player name, email, or phone..."
            className="w-full h-9 pl-8 pr-3 rounded-lg bg-slate-50 border border-slate-200"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            className="h-9 px-3.5 rounded-lg bg-[#D92D20] text-white font-semibold"
          >
            {at(adminLang, 'search')}
          </button>
          {canAdjust && (
            <button
              type="button"
              onClick={handleReconcile}
              className="h-9 px-3.5 rounded-lg bg-slate-900 text-white font-semibold inline-flex items-center gap-1.5"
            >
              <Scale className="w-3.5 h-3.5" /> {at(adminLang, 'reconcile_ledger')}
            </button>
          )}
        </div>
      </div>

      {reconcile && (
        <div
          className={`rounded-2xl p-4 border text-xs flex items-center justify-between ${
            reconcile.discrepancyCount === 0
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <div>
            <strong>Ledger Reconciliation:</strong> Checked {reconcile.checkedWallets} wallet(s) —{' '}
            {reconcile.discrepancyCount} discrepancy(ies) detected.
          </div>
          <button type="button" onClick={() => setReconcile(null)} className="p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 border-b border-slate-100">
                <th className="py-3 px-4 font-semibold">Player</th>
                <th className="py-3 px-3 font-semibold text-right">{at(adminLang, 'balance')}</th>
                <th className="py-3 px-3 font-semibold text-right">Deposited</th>
                <th className="py-3 px-3 font-semibold text-right">Withdrawn</th>
                <th className="py-3 px-3 font-semibold text-right">Wagered</th>
                <th className="py-3 px-3 font-semibold text-right">Won</th>
                <th className="py-3 px-4 font-semibold text-right">{at(adminLang, 'actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-400">
                    {at(adminLang, 'no_players_yet')}
                  </td>
                </tr>
              ) : (
                items.map((w) => (
                  <tr key={w.userId} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900">{w.username || w.displayName}</div>
                      <div className="text-[11px] text-slate-400">{w.email || w.phone || `#${w.userId}`}</div>
                    </td>
                    <td className="py-3 px-3 text-right font-mono-num font-extrabold text-slate-900">
                      {formatCurrency(w.availableBalance || 0, w.currency || 'USD', adminLang)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono-num text-emerald-700">
                      {formatCurrency(w.totalDeposited || 0, w.currency || 'USD', adminLang)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono-num text-amber-700">
                      {formatCurrency(w.totalWithdrawn || 0, w.currency || 'USD', adminLang)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono-num text-slate-600">
                      {formatCurrency(w.totalWagered || 0, w.currency || 'USD', adminLang)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono-num text-blue-700">
                      {formatCurrency(w.totalWon || 0, w.currency || 'USD', adminLang)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {canAdjust && (
                        <button
                          type="button"
                          onClick={() => setAdjustTarget(w)}
                          className="px-2.5 py-1.5 rounded-lg bg-[#D92D20] hover:bg-[#B42318] text-white font-semibold inline-flex items-center gap-1"
                        >
                          <PlusCircle className="w-3.5 h-3.5" /> {at(adminLang, 'adjust_balance')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {adjustTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <form onSubmit={handleAdjust} className="bg-white rounded-2xl max-w-md w-full p-5 space-y-3 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">
                {at(adminLang, 'adjust_balance')} — {adjustTarget.username || adjustTarget.displayName}
              </h3>
              <button type="button" onClick={() => setAdjustTarget(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                onClick={() => setDirection('credit')}
                className={`h-10 rounded-xl font-bold border ${
                  direction === 'credit'
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-slate-50 text-slate-700 border-slate-200'
                }`}
              >
                {at(adminLang, 'credit')}
              </button>
              <button
                type="button"
                onClick={() => setDirection('debit')}
                className={`h-10 rounded-xl font-bold border ${
                  direction === 'debit'
                    ? 'bg-red-600 text-white border-red-600'
                    : 'bg-slate-50 text-slate-700 border-slate-200'
                }`}
              >
                {at(adminLang, 'debit')}
              </button>
            </div>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              placeholder={at(adminLang, 'amount')}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono-num"
            />
            <textarea
              required
              minLength={4}
              rows={2}
              placeholder={`${at(adminLang, 'reason')} (recorded in immutable audit log)`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs"
            />
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setAdjustTarget(null)}
                className="h-9 px-3 rounded-lg border border-slate-200 text-xs"
              >
                {at(adminLang, 'cancel')}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="h-9 px-4 rounded-lg bg-[#D92D20] text-white text-xs font-semibold disabled:opacity-50"
              >
                {at(adminLang, 'save')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// MODULE 10: DEPOSIT MANAGEMENT
// =========================================================================
export function AdminDepositsModule({
  adminLang,
  currentUserRole,
  onNotify,
}: {
  adminLang: AdminLang;
  currentUserRole: string;
  onNotify: (msg: string, isError?: boolean) => void;
}) {
  const [items, setItems] = useState<any[]>([]);
  const [status, setStatus] = useState('all');

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/admin/finance/deposits?status=${status}`);
    setItems(res.items || []);
  }, [status]);

  useEffect(() => {
    load().catch((e) => onNotify(e?.message || 'Unable to load deposits', true));
  }, [load, onNotify]);

  const handleReview = async (id: number, action: 'approve' | 'reject' | 'refund') => {
    try {
      await apiFetch(`/api/admin/finance/deposits/${id}/review`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      onNotify(`Deposit ${action} completed.`);
      await load();
    } catch (err: any) {
      onNotify(err?.message || 'Deposit review failed', true);
    }
  };

  const canAct = ['super_admin', 'finance'].includes(currentUserRole);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5 text-xs">
        {['all', 'pending', 'awaiting_verification', 'completed', 'rejected', 'refunded'].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`px-3.5 py-1.5 rounded-lg font-semibold capitalize ${
              status === s ? 'bg-[#D92D20] text-white' : 'bg-white border border-slate-200 text-slate-600'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 border-b border-slate-100">
                <th className="py-3 px-4 font-semibold">Order Ref</th>
                <th className="py-3 px-3 font-semibold">Player</th>
                <th className="py-3 px-3 font-semibold">Channel / UTR</th>
                <th className="py-3 px-3 font-semibold text-right">{at(adminLang, 'amount')}</th>
                <th className="py-3 px-3 font-semibold">{at(adminLang, 'status')}</th>
                <th className="py-3 px-4 font-semibold text-right">{at(adminLang, 'actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400">
                    {at(adminLang, 'no_records')}
                  </td>
                </tr>
              ) : (
                items.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono-num font-bold text-slate-900">{d.orderRef}</td>
                    <td className="py-3 px-3">
                      <div className="font-semibold text-slate-800">{d.userName || `#${d.userId}`}</div>
                      <div className="text-[11px] text-slate-400">{d.userEmail || d.userPhone}</div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-semibold">
                        {d.channelLabel} <span className="text-[10px] text-slate-400">v{d.channelVersion || 1} · {d.currency || 'USD'}</span>
                      </div>
                      <div className="font-mono text-[11px] text-slate-500">UTR: {d.utrReference || 'Not submitted'}</div>
                    </td>
                    <td className="py-3 px-3 text-right font-mono-num font-bold text-slate-900">
                      {formatCurrency(d.amount, d.currency || 'USD', adminLang)}
                      {parseFloat(d.bonusAmount) > 0 && (
                        <div className="text-[11px] text-emerald-600">+{d.bonusAmount} bonus</div>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`px-2 py-0.5 rounded-md font-semibold uppercase text-[11px] ${
                          d.status === 'completed'
                            ? 'bg-emerald-50 text-emerald-700'
                            : d.status === 'pending' || d.status === 'awaiting_verification'
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-red-50 text-red-600'
                        }`}
                      >
                        {d.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right space-x-1">
                      {canAct && (d.status === 'pending' || d.status === 'awaiting_verification') && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleReview(d.id, 'approve')}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold inline-flex items-center gap-1"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" /> {at(adminLang, 'approve_credit')}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReview(d.id, 'reject')}
                            className="px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 font-semibold inline-flex items-center gap-1"
                          >
                            <XCircle className="w-3.5 h-3.5" /> {at(adminLang, 'reject')}
                          </button>
                        </>
                      )}
                      {canAct && d.status === 'completed' && (
                        <button
                          type="button"
                          onClick={() => handleReview(d.id, 'refund')}
                          className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold inline-flex items-center gap-1"
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> {at(adminLang, 'refund')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// MODULE 11: WITHDRAWAL MANAGEMENT
// =========================================================================
export function AdminWithdrawalsModule({
  adminLang,
  currentUserRole,
  onNotify,
}: {
  adminLang: AdminLang;
  currentUserRole: string;
  onNotify: (msg: string, isError?: boolean) => void;
}) {
  const [items, setItems] = useState<any[]>([]);
  const [status, setStatus] = useState('all');
  const [payoutModal, setPayoutModal] = useState<any>(null);
  const [payoutRef, setPayoutRef] = useState('');

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/admin/finance/withdrawals?status=${status}`);
    setItems(res.items || []);
  }, [status]);

  useEffect(() => {
    load().catch((e) => onNotify(e?.message || 'Unable to load withdrawals', true));
  }, [load, onNotify]);

  const handleReview = async (id: number, action: 'approve' | 'complete' | 'reject', payoutReference?: string) => {
    try {
      await apiFetch(`/api/admin/finance/withdrawals/${id}/review`, {
        method: 'POST',
        body: JSON.stringify({ action, payoutReference }),
      });
      onNotify(`Withdrawal ${action} completed.`);
      setPayoutModal(null);
      setPayoutRef('');
      await load();
    } catch (err: any) {
      onNotify(err?.message || 'Withdrawal review failed', true);
    }
  };

  const canAct = ['super_admin', 'finance'].includes(currentUserRole);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5 text-xs">
        {['all', 'pending', 'approved', 'completed', 'rejected'].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`px-3.5 py-1.5 rounded-lg font-semibold capitalize ${
              status === s ? 'bg-[#D92D20] text-white' : 'bg-white border border-slate-200 text-slate-600'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 border-b border-slate-100">
                <th className="py-3 px-4 font-semibold">Order Ref</th>
                <th className="py-3 px-3 font-semibold">Player</th>
                <th className="py-3 px-3 font-semibold">Bank Account</th>
                <th className="py-3 px-3 font-semibold text-right">{at(adminLang, 'amount')}</th>
                <th className="py-3 px-3 font-semibold">{at(adminLang, 'status')}</th>
                <th className="py-3 px-4 font-semibold text-right">{at(adminLang, 'actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400">
                    {at(adminLang, 'no_records')}
                  </td>
                </tr>
              ) : (
                items.map((w) => (
                  <tr key={w.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono-num font-bold text-slate-900">
                      {w.orderRef}
                      {w.payoutReference && (
                        <div className="text-[11px] font-normal text-emerald-700">Ref: {w.payoutReference}</div>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-semibold text-slate-800">{w.userName || `#${w.userId}`}</div>
                      <div className="text-[11px] text-slate-400">{w.userEmail || w.userPhone}</div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-semibold">{w.bankName || '—'} · {w.recipientName}</div>
                      <div className="font-mono text-[11px] text-slate-500">
                        {w.accountNumberMasked} ({w.routingCodeLabel}: {w.routingCodeValue})
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right font-mono-num font-bold text-slate-900">
                      {formatCurrency(w.amount, 'USD', adminLang)}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`px-2 py-0.5 rounded-md font-semibold uppercase text-[11px] ${
                          w.status === 'completed'
                            ? 'bg-emerald-50 text-emerald-700'
                            : w.status === 'approved'
                              ? 'bg-blue-50 text-blue-700'
                              : w.status === 'pending'
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-red-50 text-red-600'
                        }`}
                      >
                        {w.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right space-x-1">
                      {canAct && w.status === 'pending' && (
                        <button
                          type="button"
                          onClick={() => handleReview(w.id, 'approve')}
                          className="px-2.5 py-1 rounded-lg bg-blue-600 text-white font-semibold"
                        >
                          {at(adminLang, 'approved')}
                        </button>
                      )}
                      {canAct && ['pending', 'approved'].includes(w.status) && (
                        <>
                          <button
                            type="button"
                            onClick={() => setPayoutModal(w)}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-semibold"
                          >
                            {at(adminLang, 'confirm_paid')}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReview(w.id, 'reject')}
                            className="px-2.5 py-1 rounded-lg bg-red-50 text-red-600 font-semibold"
                          >
                            {at(adminLang, 'reject')}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {payoutModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 space-y-3 shadow-2xl">
            <h3 className="text-sm font-bold text-slate-900">
              {at(adminLang, 'confirm_paid')} — {payoutModal.orderRef}
            </h3>
            <input
              type="text"
              placeholder="Bank / Transfer Payout Reference (e.g. UTR/SWIFT)"
              value={payoutRef}
              onChange={(e) => setPayoutRef(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-slate-50 border border-slate-200 text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPayoutModal(null)}
                className="h-9 px-3 rounded-lg border border-slate-200 text-xs"
              >
                {at(adminLang, 'cancel')}
              </button>
              <button
                type="button"
                onClick={() => handleReview(payoutModal.id, 'complete', payoutRef.trim() || undefined)}
                className="h-9 px-4 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
              >
                {at(adminLang, 'confirm_paid')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// MODULE 12: FINANCIAL TRANSACTIONS (IMMUTABLE LEDGER)
// =========================================================================
export function AdminLedgerModule({
  adminLang,
  onNotify,
}: {
  adminLang: AdminLang;
  onNotify: (msg: string, isError?: boolean) => void;
}) {
  const [items, setItems] = useState<any[]>([]);
  const [type, setType] = useState('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ type });
    if (search.trim()) qs.set('search', search.trim());
    const res = await apiFetch(`/api/admin/finance/ledger?${qs.toString()}`);
    setItems(res.items || []);
  }, [type, search]);

  useEffect(() => {
    load().catch((e) => onNotify(e?.message || 'Unable to load ledger', true));
  }, [load, onNotify]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex flex-wrap items-center gap-2.5 text-xs">
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="h-9 px-3 rounded-lg bg-slate-50 border border-slate-200"
        >
          <option value="all">{at(adminLang, 'all')}</option>
          <option value="deposit">Deposit</option>
          <option value="withdrawal">Withdrawal</option>
          <option value="withdrawal_refund">Withdrawal Refund</option>
          <option value="wager">Wager</option>
          <option value="payout">Payout</option>
          <option value="gift_code">Gift Code</option>
          <option value="commission">Commission</option>
          <option value="admin_adjustment">Admin Adjustment</option>
        </select>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tx Ref, Source ID, or Player..."
            className="w-full h-9 pl-8 pr-3 rounded-lg bg-slate-50 border border-slate-200"
          />
        </div>
        <button
          type="button"
          onClick={load}
          className="h-9 px-3.5 rounded-lg bg-[#D92D20] text-white font-semibold"
        >
          {at(adminLang, 'search')}
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 border-b border-slate-100">
                <th className="py-3 px-4 font-semibold">Tx Ref</th>
                <th className="py-3 px-3 font-semibold">Player</th>
                <th className="py-3 px-3 font-semibold">Type</th>
                <th className="py-3 px-3 font-semibold text-right">{at(adminLang, 'amount')}</th>
                <th className="py-3 px-3 font-semibold text-right">Balance After</th>
                <th className="py-3 px-3 font-semibold">Note</th>
                <th className="py-3 px-4 font-semibold">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-400">
                    {at(adminLang, 'no_records')}
                  </td>
                </tr>
              ) : (
                items.map((tx) => {
                  const amt = parseFloat(tx.amount);
                  return (
                    <tr key={tx.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-4 font-mono-num font-bold text-slate-900">{tx.txRef}</td>
                      <td className="py-2.5 px-3 text-slate-700">{tx.userName || `#${tx.userId}`}</td>
                      <td className="py-2.5 px-3 capitalize text-slate-600">{String(tx.type).replace('_', ' ')}</td>
                      <td
                        className={`py-2.5 px-3 text-right font-mono-num font-bold ${
                          amt >= 0 ? 'text-emerald-600' : 'text-red-600'
                        }`}
                      >
                        {amt >= 0 ? '+' : ''}
                        {formatCurrency(amt, 'USD', adminLang)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono-num text-slate-700">
                        {formatCurrency(tx.balanceAfter, 'USD', adminLang)}
                      </td>
                      <td className="py-2.5 px-3 text-slate-500 max-w-[260px] truncate">{tx.note}</td>
                      <td className="py-2.5 px-4 font-mono-num text-slate-400">
                        {new Date(tx.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
