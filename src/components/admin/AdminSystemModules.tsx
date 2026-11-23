import React, { useEffect, useState, useCallback } from 'react';
import {
  Send,
  Plus,
  Trash2,
  Download,
  CheckCircle2,
  AlertTriangle,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { apiFetch, formatCurrency } from '../../lib/api';
import { at, type AdminLang } from './adminI18n';
import { AdminDepositChannelsPanel } from './AdminDepositChannelsPanel';

// =========================================================================
// MODULE 18: CUSTOMER SERVICE (SUPPORT TICKETS)
// =========================================================================
export function AdminSupportModule({
  adminLang,
  onNotify,
}: {
  adminLang: AdminLang;
  onNotify: (msg: string, isError?: boolean) => void;
}) {
  const [tickets, setTickets] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [replyText, setReplyText] = useState('');
  const [nextStatus, setNextStatus] = useState<'open' | 'in_progress' | 'resolved' | 'closed'>('in_progress');

  const loadTickets = useCallback(async () => {
    const res = await apiFetch(`/api/admin/support/tickets?status=${statusFilter}`);
    setTickets(res.items || []);
  }, [statusFilter]);

  useEffect(() => {
    loadTickets().catch((e) => onNotify(e?.message || 'Unable to load tickets', true));
  }, [loadTickets, onNotify]);

  const openTicket = async (id: number) => {
    try {
      const res = await apiFetch(`/api/admin/support/tickets/${id}`);
      setSelected(res.ticket);
      setMessages(res.messages || []);
      setNextStatus(res.ticket.status);
    } catch (err: any) {
      onNotify(err?.message || 'Unable to load conversation', true);
    }
  };

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !replyText.trim()) return;
    try {
      await apiFetch(`/api/admin/support/tickets/${selected.id}/reply`, {
        method: 'POST',
        body: JSON.stringify({ message: replyText.trim(), status: nextStatus }),
      });
      setReplyText('');
      onNotify('Reply sent to player.');
      await Promise.all([openTicket(selected.id), loadTickets()]);
    } catch (err: any) {
      onNotify(err?.message || 'Failed to send reply', true);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
      <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-3 border-b border-slate-100 flex items-center gap-1.5 text-xs">
          {['all', 'open', 'in_progress', 'resolved', 'closed'].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-1 rounded-lg font-semibold capitalize ${
                statusFilter === s ? 'bg-[#D92D20] text-white' : 'bg-slate-50 text-slate-600'
              }`}
            >
              {s.replace('_', ' ')}
            </button>
          ))}
        </div>
        <div className="divide-y divide-slate-100 max-h-[540px] overflow-y-auto">
          {tickets.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400">{at(adminLang, 'no_records')}</div>
          ) : (
            tickets.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => openTicket(t.id)}
                className={`w-full p-3.5 text-left hover:bg-slate-50 transition-colors ${
                  selected?.id === t.id ? 'bg-rose-50/60' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-mono-num font-bold text-slate-900">{t.ticketRef}</span>
                  <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10px] font-bold uppercase">
                    {t.status}
                  </span>
                </div>
                <div className="text-xs font-semibold text-slate-800 mt-1 truncate">{t.subject}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {t.userName || `#${t.userId}`} · {t.category}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/80 shadow-xs p-4 min-h-[420px] flex flex-col">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-xs text-slate-400">
            Select a support ticket to inspect conversation and reply.
          </div>
        ) : (
          <>
            <div className="pb-3 border-b border-slate-100 flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-slate-900">{selected.subject}</div>
                <div className="text-xs text-slate-500">
                  {selected.ticketRef} · {selected.category}
                </div>
              </div>
              <select
                value={nextStatus}
                onChange={(e) => setNextStatus(e.target.value as any)}
                className="h-8 px-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs"
              >
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </select>
            </div>

            <div className="flex-1 py-4 space-y-2.5 max-h-[340px] overflow-y-auto">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`p-3 rounded-xl text-xs max-w-[85%] ${
                    m.senderRole === 'admin'
                      ? 'ml-auto bg-rose-50 border border-rose-100 text-slate-900'
                      : 'bg-slate-100 text-slate-800'
                  }`}
                >
                  <div className="text-[10px] font-bold uppercase text-slate-500 mb-1">
                    {m.senderRole} · {new Date(m.createdAt).toLocaleString()}
                  </div>
                  <div className="whitespace-pre-wrap">{m.message}</div>
                </div>
              ))}
            </div>

            <form onSubmit={handleReply} className="pt-3 border-t border-slate-100 flex gap-2">
              <input
                type="text"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Write a real reply to the player..."
                className="flex-1 h-10 px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs"
              />
              <button
                type="submit"
                className="h-10 px-4 rounded-xl bg-[#D92D20] text-white text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" /> Send
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

// =========================================================================
// MODULE 19: ANNOUNCEMENTS (SYNCED LIVE TO GAME PAGE)
// =========================================================================
export function AdminAnnouncementsModule({
  adminLang,
  onNotify,
}: {
  adminLang: AdminLang;
  onNotify: (msg: string, isError?: boolean) => void;
}) {
  const [items, setItems] = useState<any[]>([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const load = useCallback(async () => {
    const res = await apiFetch('/api/admin/announcements');
    setItems(res.items || []);
  }, []);

  useEffect(() => {
    load().catch((e) => onNotify(e?.message || 'Unable to load announcements', true));
  }, [load, onNotify]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/announcements', {
        method: 'POST',
        body: JSON.stringify({ title, content, enabled: true }),
      });
      setTitle('');
      setContent('');
      onNotify('Announcement published live to Game Page.');
      await load();
    } catch (err: any) {
      onNotify(err?.message || 'Failed to publish announcement', true);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    await apiFetch(`/api/admin/announcements/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
    await load();
  };

  const handleDelete = async (id: string) => {
    await apiFetch(`/api/admin/announcements/${id}`, { method: 'DELETE' });
    await load();
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleCreate} className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs space-y-3 text-xs">
        <div className="font-bold text-slate-900">Publish Live Announcement to WinGo Game Page</div>
        <input
          type="text"
          required
          placeholder="Announcement Title *"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full h-9 px-3 rounded-lg bg-slate-50 border border-slate-200"
        />
        <textarea
          required
          rows={2}
          placeholder="Announcement message displayed in player notice ticker *"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="w-full p-3 rounded-lg bg-slate-50 border border-slate-200"
        />
        <button
          type="submit"
          className="h-9 px-4 rounded-lg bg-[#D92D20] text-white font-semibold inline-flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" /> Publish Announcement
        </button>
      </form>

      <div className="space-y-2.5">
        {items.length === 0 ? (
          <div className="bg-white rounded-2xl p-10 text-center text-xs text-slate-400 border border-slate-200/80">
            {at(adminLang, 'no_records')}
          </div>
        ) : (
          items.map((a) => (
            <div
              key={a.id}
              className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex flex-wrap items-center justify-between gap-3"
            >
              <div className="space-y-1 max-w-2xl">
                <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <span>{a.title}</span>
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                      a.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {a.enabled ? at(adminLang, 'enabled') : at(adminLang, 'disabled')}
                  </span>
                </div>
                <div className="text-xs text-slate-600">{a.content}</div>
                <div className="text-[11px] text-slate-400">
                  By {a.createdBy} · {new Date(a.createdAt).toLocaleString()}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => handleToggle(a.id, !a.enabled)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 font-semibold"
                >
                  {a.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(a.id)}
                  className="p-2 rounded-lg text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// =========================================================================
// MODULE 20: REPORTS (REAL SQL ANALYTICS)
// =========================================================================
export function AdminReportsModule({
  adminLang,
  onNotify,
}: {
  adminLang: AdminLang;
  onNotify: (msg: string, isError?: boolean) => void;
}) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [report, setReport] = useState<any>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    const res = await apiFetch(`/api/admin/reports?${qs.toString()}`);
    setReport(res);
  }, [from, to]);

  useEffect(() => {
    load().catch((e) => onNotify(e?.message || 'Unable to load reports', true));
  }, [load, onNotify]);

  const exportCsv = () => {
    if (!report) return;
    const s = report.summary || {};
    const rows = [
      ['Metric', 'Value'],
      ['New Players', s.newPlayers],
      ['Settled Rounds', s.settledRounds],
      ['Total Bets', s.totalBets],
      ['Total Stake', s.totalStake],
      ['Total Payout', s.totalPayout],
      ['Total Fees', s.totalFees],
      ['Gross Gaming Revenue', s.grossGamingRevenue],
      ['Completed Deposits', s.completedDeposits],
      ['Completed Withdrawals', s.completedWithdrawals],
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wingo-report-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const s = report?.summary || {};

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-9 px-3 rounded-lg bg-slate-50 border border-slate-200"
          />
          <span className="text-slate-400">to</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-9 px-3 rounded-lg bg-slate-50 border border-slate-200"
          />
          <button
            type="button"
            onClick={load}
            className="h-9 px-4 rounded-lg bg-[#D92D20] text-white font-semibold"
          >
            Run Report
          </button>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          className="h-9 px-3.5 rounded-lg border border-slate-200 hover:bg-slate-50 font-semibold inline-flex items-center gap-1.5"
        >
          <Download className="w-3.5 h-3.5" /> {at(adminLang, 'export_csv')}
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'New Players', val: s.newPlayers ?? 0 },
          { label: 'Settled Rounds', val: s.settledRounds ?? 0 },
          { label: 'Total Stake', val: formatCurrency(s.totalStake || 0, 'USD', adminLang) },
          { label: at(adminLang, 'kpi_ggr'), val: formatCurrency(s.grossGamingRevenue || 0, 'USD', adminLang) },
          { label: 'Total Bets', val: s.totalBets ?? 0 },
          { label: 'Total Payout', val: formatCurrency(s.totalPayout || 0, 'USD', adminLang) },
          { label: 'Completed Deposits', val: formatCurrency(s.completedDeposits || 0, 'USD', adminLang) },
          { label: 'Completed Withdrawals', val: formatCurrency(s.completedWithdrawals || 0, 'USD', adminLang) },
        ].map((card) => (
          <div key={card.label} className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs">
            <div className="text-xs text-slate-500 font-semibold">{card.label}</div>
            <div className="text-xl font-display font-extrabold text-slate-900 font-mono-num mt-1">
              {card.val}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 text-sm font-bold text-slate-900">
          Performance by WinGo Mode
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 border-b border-slate-100">
                <th className="py-3 px-4 font-semibold">Mode</th>
                <th className="py-3 px-3 font-semibold text-right">Bets</th>
                <th className="py-3 px-3 font-semibold text-right">Total Stake</th>
                <th className="py-3 px-4 font-semibold text-right">Total Payout</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(report?.byMode || []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-400">
                    {at(adminLang, 'no_records')}
                  </td>
                </tr>
              ) : (
                report.byMode.map((m: any) => (
                  <tr key={m.mode}>
                    <td className="py-2.5 px-4 font-bold uppercase">{m.mode}</td>
                    <td className="py-2.5 px-3 text-right font-mono-num">{m.betCount}</td>
                    <td className="py-2.5 px-3 text-right font-mono-num">
                      {formatCurrency(m.totalStake, 'USD', adminLang)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-num">
                      {formatCurrency(m.totalPayout, 'USD', adminLang)}
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
// MODULE 21: PLATFORM SETTINGS (HONEST PROVIDERS & PAYMENT CHANNELS)
// =========================================================================
export function AdminPlatformSettingsModule({
  adminLang,
  onNotify,
}: {
  adminLang: AdminLang;
  onNotify: (msg: string, isError?: boolean) => void;
}) {
  const [settings, setSettings] = useState<any>(null);
  const [channels, setChannels] = useState<any[]>([]);
  const [rail, setRail] = useState<any>({
    configured: false,
    enabled: false,
    minAmount: 10,
    maxAmount: 50000,
    providerLabel: 'Bank Transfer Payout Rail',
  });
  const [maintenance, setMaintenance] = useState({ enabled: false, message: '' });
  const [registrationPolicy, setRegistrationPolicy] = useState<{
    mode: 'manual_admin_approval' | 'verified_sms_registration';
  }>({ mode: 'manual_admin_approval' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch('/api/admin/system/settings');
    setSettings(res);
    setChannels(res.paymentChannels || []);
    if (res.withdrawalRail) setRail(res.withdrawalRail);
    if (res.maintenance) setMaintenance(res.maintenance);
    if (res.registrationPolicy) setRegistrationPolicy(res.registrationPolicy);
  }, []);

  useEffect(() => {
    load().catch((e) => onNotify(e?.message || 'Unable to load platform settings', true));
  }, [load, onNotify]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiFetch('/api/admin/system/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          maintenance,
          registrationPolicy,
          paymentChannels: channels,
          withdrawalRail: {
            ...rail,
            minAmount: Number(rail.minAmount),
            maxAmount: Number(rail.maxAmount),
          },
        }),
      });
      onNotify('Platform settings saved to PostgreSQL.');
      await load();
    } catch (err: any) {
      onNotify(err?.message || 'Save failed', true);
    } finally {
      setSaving(false);
    }
  };

  const providers = settings?.providers || {};

  return (
    <div className="space-y-5 text-xs">
      {/* Honest Verification Provider Status */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-3">
        <h3 className="text-sm font-display font-bold text-slate-900">
          {at(adminLang, 'provider_status')}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/70 flex items-center justify-between">
            <div>
              <div className="font-bold text-slate-900">{at(adminLang, 'email_provider')}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {providers.emailConfigured ? 'SMTP configured via environment' : 'Set SMTP_HOST & SMTP_USER in .env'}
              </div>
            </div>
            <span
              className={`px-2.5 py-1 rounded-full font-bold inline-flex items-center gap-1 ${
                providers.emailConfigured
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-amber-100 text-amber-800'
              }`}
            >
              {providers.emailConfigured ? (
                <CheckCircle2 className="w-3.5 h-3.5" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5" />
              )}
              {providers.emailConfigured ? at(adminLang, 'configured') : at(adminLang, 'not_configured')}
            </span>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/70 flex items-center justify-between">
            <div>
              <div className="font-bold text-slate-900">{at(adminLang, 'sms_provider')}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {providers.smsConfigured ? 'SMS gateway configured via environment' : 'Set SMS_PROVIDER_URL & SMS_PROVIDER_API_KEY in .env'}
              </div>
            </div>
            <span
              className={`px-2.5 py-1 rounded-full font-bold inline-flex items-center gap-1 ${
                providers.smsConfigured
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-amber-100 text-amber-800'
              }`}
            >
              {providers.smsConfigured ? (
                <CheckCircle2 className="w-3.5 h-3.5" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5" />
              )}
              {providers.smsConfigured ? at(adminLang, 'configured') : at(adminLang, 'not_configured')}
            </span>
          </div>
        </div>
        <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="font-bold text-slate-900">Registration Approval Policy</div>
            <div className="text-[11px] text-slate-500">
              Verified SMS Registration requires a configured SMS provider.
            </div>
          </div>
          <select
            value={registrationPolicy.mode}
            onChange={(e) =>
              setRegistrationPolicy({
                mode: e.target.value as 'manual_admin_approval' | 'verified_sms_registration',
              })
            }
            className="h-9 px-3 rounded-lg bg-slate-50 border border-slate-200 font-semibold text-slate-800"
          >
            <option value="manual_admin_approval">Manual Admin Approval</option>
            <option value="verified_sms_registration" disabled={!providers.smsConfigured}>
              Verified SMS Registration {!providers.smsConfigured ? '(SMS Not Configured)' : ''}
            </option>
          </select>
        </div>
      </div>

      {/* Payment Channels Configuration */}
      <AdminDepositChannelsPanel adminLang={adminLang} onNotify={onNotify} />

      {/* Withdrawal Payout Rail & Maintenance Mode */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-3">
          <h3 className="text-sm font-display font-bold text-slate-900">
            {at(adminLang, 'withdrawal_rail')}
          </h3>
          <input
            type="text"
            value={rail.providerLabel}
            onChange={(e) => setRail({ ...rail, providerLabel: e.target.value })}
            placeholder="Payout Provider Label"
            className="w-full h-9 px-3 rounded-lg bg-slate-50 border border-slate-200"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              value={rail.minAmount}
              onChange={(e) => setRail({ ...rail, minAmount: Number(e.target.value) })}
              placeholder="Min Amount"
              className="h-9 px-3 rounded-lg bg-slate-50 border border-slate-200 font-mono-num"
            />
            <input
              type="number"
              value={rail.maxAmount}
              onChange={(e) => setRail({ ...rail, maxAmount: Number(e.target.value) })}
              placeholder="Max Amount"
              className="h-9 px-3 rounded-lg bg-slate-50 border border-slate-200 font-mono-num"
            />
          </div>
          <div className="flex items-center gap-4">
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={Boolean(rail.configured)}
                onChange={(e) => setRail({ ...rail, configured: e.target.checked })}
              />
              <span>{at(adminLang, 'configured')}</span>
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={Boolean(rail.enabled)}
                onChange={(e) => setRail({ ...rail, enabled: e.target.checked })}
              />
              <span>{at(adminLang, 'enabled')}</span>
            </label>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-3">
          <h3 className="text-sm font-display font-bold text-slate-900">
            {at(adminLang, 'maintenance_mode')}
          </h3>
          <label className="inline-flex items-center gap-2 font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={maintenance.enabled}
              onChange={(e) => setMaintenance({ ...maintenance, enabled: e.target.checked })}
            />
            <span>Enable Scheduled Maintenance Banner</span>
          </label>
          <input
            type="text"
            value={maintenance.message}
            onChange={(e) => setMaintenance({ ...maintenance, message: e.target.value })}
            placeholder="Optional maintenance notice message..."
            className="w-full h-9 px-3 rounded-lg bg-slate-50 border border-slate-200"
          />
        </div>
      </div>

      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-3">
        <h3 className="text-sm font-display font-bold text-slate-900">
          Standalone VS Code Source Packages (ZIP)
        </h3>
        <p className="text-xs text-slate-500">
          Download the synchronized standalone packages to run locally in VS Code (zero hardcoded passwords or secrets).
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href="/downloads/wingo-game-page.zip"
            download="wingo-game-page.zip"
            className="h-10 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold inline-flex items-center gap-2"
          >
            <Download className="w-4 h-4" /> 1. Download wingo-game-page.zip (Player Game Page)
          </a>
          <a
            href="/downloads/wingo-admin-panel.zip"
            download="wingo-admin-panel.zip"
            className="h-10 px-4 rounded-xl bg-[#D92D20] hover:bg-[#B42318] text-white text-xs font-bold inline-flex items-center gap-2"
          >
            <Download className="w-4 h-4" /> 2. Download wingo-admin-panel.zip (Admin Panel + API)
          </a>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="h-10 px-6 rounded-xl bg-[#D92D20] hover:bg-[#B42318] text-white font-bold disabled:opacity-50"
        >
          {saving ? '...' : at(adminLang, 'save')}
        </button>
      </div>
    </div>
  );
}

// =========================================================================
// MODULE 22: SECURITY SETTINGS & ACTIVE SESSIONS
// =========================================================================
export function AdminSecurityModule({
  adminLang,
  currentUserRole,
  onNotify,
}: {
  adminLang: AdminLang;
  currentUserRole: string;
  onNotify: (msg: string, isError?: boolean) => void;
}) {
  const [policy, setPolicy] = useState<any>(null);
  const [sessionsList, setSessionsList] = useState<any[]>([]);

  const load = useCallback(async () => {
    const [p, s] = await Promise.all([
      apiFetch('/api/admin/security/settings'),
      apiFetch('/api/admin/security/sessions'),
    ]);
    setPolicy(p.policy);
    setSessionsList(s.items || []);
  }, []);

  useEffect(() => {
    load().catch((e) => onNotify(e?.message || 'Unable to load security settings', true));
  }, [load, onNotify]);

  const savePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/security/settings', {
        method: 'PATCH',
        body: JSON.stringify(policy),
      });
      onNotify('Security policy saved.');
    } catch (err: any) {
      onNotify(err?.message || 'Failed to update security policy', true);
    }
  };

  const revokeSession = async (id: number) => {
    try {
      await apiFetch(`/api/admin/security/sessions/${id}`, { method: 'DELETE' });
      onNotify('Session terminated.');
      await load();
    } catch (err: any) {
      onNotify(err?.message || 'Unable to terminate session', true);
    }
  };

  return (
    <div className="space-y-5 text-xs">
      {policy && (
        <form onSubmit={savePolicy} className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-4">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <ShieldAlert className="w-4 h-4 text-[#D92D20]" />
            <span>Authentication & Session Policy</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <label className="space-y-1">
              <span className="text-[11px] text-slate-500">Session Timeout (hours)</span>
              <input
                type="number"
                value={policy.sessionTimeoutHours}
                onChange={(e) => setPolicy({ ...policy, sessionTimeoutHours: Number(e.target.value) })}
                className="w-full h-9 px-3 rounded-lg bg-slate-50 border border-slate-200 font-mono-num"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-slate-500">Admin Min Password</span>
              <input
                type="number"
                min={10}
                value={policy.adminMinPasswordLength}
                onChange={(e) => setPolicy({ ...policy, adminMinPasswordLength: Number(e.target.value) })}
                className="w-full h-9 px-3 rounded-lg bg-slate-50 border border-slate-200 font-mono-num"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-slate-500">Player Min Password</span>
              <input
                type="number"
                min={8}
                value={policy.playerMinPasswordLength}
                onChange={(e) => setPolicy({ ...policy, playerMinPasswordLength: Number(e.target.value) })}
                className="w-full h-9 px-3 rounded-lg bg-slate-50 border border-slate-200 font-mono-num"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-slate-500">Max Login Attempts / 15m</span>
              <input
                type="number"
                value={policy.maxLoginAttemptsPer15Min}
                onChange={(e) => setPolicy({ ...policy, maxLoginAttemptsPer15Min: Number(e.target.value) })}
                className="w-full h-9 px-3 rounded-lg bg-slate-50 border border-slate-200 font-mono-num"
              />
            </label>
          </div>
          {currentUserRole === 'super_admin' && (
            <button type="submit" className="h-9 px-5 rounded-lg bg-[#D92D20] text-white font-semibold">
              {at(adminLang, 'save')}
            </button>
          )}
        </form>
      )}

      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 text-sm font-bold text-slate-900">
          {at(adminLang, 'active_sessions')} ({sessionsList.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 border-b border-slate-100">
                <th className="py-3 px-4 font-semibold">User</th>
                <th className="py-3 px-3 font-semibold">{at(adminLang, 'role')}</th>
                <th className="py-3 px-3 font-semibold">IP</th>
                <th className="py-3 px-3 font-semibold">Expires</th>
                <th className="py-3 px-4 font-semibold text-right">{at(adminLang, 'actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sessionsList.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/70">
                  <td className="py-2.5 px-4 font-bold text-slate-900">{s.username || s.displayName}</td>
                  <td className="py-2.5 px-3 uppercase font-semibold text-slate-600">{s.role}</td>
                  <td className="py-2.5 px-3 font-mono text-slate-500">{s.ipAddress || '—'}</td>
                  <td className="py-2.5 px-3 font-mono-num text-slate-500">
                    {new Date(s.expiresAt).toLocaleString()}
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    {currentUserRole === 'super_admin' && (
                      <button
                        type="button"
                        onClick={() => revokeSession(s.id)}
                        className="px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 font-semibold"
                      >
                        {at(adminLang, 'revoke')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// MODULE 23: AUDIT LOGS
// =========================================================================
export function AdminAuditLogsModule({
  adminLang,
  onNotify,
}: {
  adminLang: AdminLang;
  onNotify: (msg: string, isError?: boolean) => void;
}) {
  const [items, setItems] = useState<any[]>([]);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    const qs = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
    const res = await apiFetch(`/api/admin/system/audit-logs${qs}`);
    setItems(res.items || []);
  }, [search]);

  useEffect(() => {
    load().catch((e) => onNotify(e?.message || 'Unable to load audit logs', true));
  }, [load, onNotify]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex gap-2 text-xs">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by action, actor, or entity..."
            className="w-full h-9 pl-8 pr-3 rounded-lg bg-slate-50 border border-slate-200"
          />
        </div>
        <button
          type="button"
          onClick={load}
          className="h-9 px-4 rounded-lg bg-[#D92D20] text-white font-semibold"
        >
          {at(adminLang, 'search')}
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 border-b border-slate-100">
                <th className="py-3 px-4 font-semibold">Time</th>
                <th className="py-3 px-3 font-semibold">Actor</th>
                <th className="py-3 px-3 font-semibold">Action</th>
                <th className="py-3 px-3 font-semibold">Entity</th>
                <th className="py-3 px-4 font-semibold">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-slate-400">
                    {at(adminLang, 'no_records')}
                  </td>
                </tr>
              ) : (
                items.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-4 font-mono-num text-slate-500 whitespace-nowrap">
                      {new Date(l.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-slate-800">
                      {l.actorEmail || (l.actorUserId ? `#${l.actorUserId}` : 'system')}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[#D92D20] font-semibold">{l.action}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-600">
                      {l.entityType}:{l.entityId}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500 max-w-[280px] truncate">
                      {l.detailsJson ? JSON.stringify(l.detailsJson) : '—'}
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
