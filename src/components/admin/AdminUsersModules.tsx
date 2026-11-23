import React, { useEffect, useState, useCallback } from 'react';
import {
  Users,
  Gamepad2,
  ArrowDownLeft,
  ArrowUpRight,
  Search,
  RotateCcw,
  Download,
  Plus,
  Eye,
  Lock,
  Unlock,
  CheckCircle2,
  KeyRound,
  Shield,
  X,
  Settings,
  BarChart3,
  Wallet,
} from 'lucide-react';
import { apiFetch, formatCurrency } from '../../lib/api';
import { at, type AdminLang } from './adminI18n';

// =========================================================================
// MODULE 1: DASHBOARD
// =========================================================================
export function AdminDashboardModule({
  adminLang,
  onNavigate,
}: {
  adminLang: AdminLang;
  onNavigate: (tab: string) => void;
}) {
  const [data, setData] = useState<any>(null);
  const [txType, setTxType] = useState('all');
  const [txSearch, setTxSearch] = useState('');

  const load = useCallback(async () => {
    const res = await apiFetch('/api/admin/dashboard');
    setData(res);
  }, []);

  useEffect(() => {
    load().catch(() => {});
    const iv = setInterval(() => load().catch(() => {}), 5000);
    return () => clearInterval(iv);
  }, [load]);

  const kpis = data?.kpis || {};
  const filteredTx = (data?.recentTransactions || []).filter((tx: any) => {
    if (txType !== 'all' && tx.type !== txType) return false;
    if (txSearch.trim()) {
      const q = txSearch.toLowerCase();
      return (
        String(tx.txRef || '').toLowerCase().includes(q) ||
        String(tx.userName || '').toLowerCase().includes(q) ||
        String(tx.sourceId || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const live1m = (data?.liveGames || []).find((g: any) => g.mode === '1m') || data?.liveGames?.[0];

  return (
    <div className="space-y-5">
      {/* 4 KPI Cards matching Screenshot #2 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-50 text-[#E63E22] flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <div className="text-xs font-semibold text-slate-500">{at(adminLang, 'kpi_total_users')}</div>
          </div>
          <div className="mt-3 text-2xl font-display font-extrabold text-slate-900 font-mono-num">
            {kpis.totalPlayers ?? 0}
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Gamepad2 className="w-5 h-5" />
            </div>
            <div className="text-xs font-semibold text-slate-500">{at(adminLang, 'kpi_active_players')}</div>
          </div>
          <div className="mt-3 text-2xl font-display font-extrabold text-slate-900 font-mono-num">
            {kpis.activePlayers ?? 0}
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <ArrowDownLeft className="w-5 h-5" />
            </div>
            <div className="text-xs font-semibold text-slate-500">{at(adminLang, 'kpi_pending_deposits')}</div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-2xl font-display font-extrabold text-slate-900 font-mono-num">
              {kpis.pendingDepositsCount ?? 0}
            </span>
            <span className="text-xs font-mono-num text-slate-500">
              {formatCurrency(kpis.pendingDepositsAmount || 0, 'USD', adminLang)}
            </span>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center">
              <ArrowUpRight className="w-5 h-5" />
            </div>
            <div className="text-xs font-semibold text-slate-500">{at(adminLang, 'kpi_pending_withdrawals')}</div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-2xl font-display font-extrabold text-slate-900 font-mono-num">
              {kpis.pendingWithdrawalsCount ?? 0}
            </span>
            <span className="text-xs font-mono-num text-slate-500">
              {formatCurrency(kpis.pendingWithdrawalsAmount || 0, 'USD', adminLang)}
            </span>
          </div>
        </div>
      </div>

      {/* Main Split: Recent Transactions (left 8 cols) + Live Status & Quick Actions (right 4 cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        <div className="xl:col-span-8 bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-display font-bold text-slate-900">
              {at(adminLang, 'recent_transactions')}
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('transactions')}
              className="text-xs font-semibold text-[#E63E22] hover:underline"
            >
              {at(adminLang, 'view_all')} →
            </button>
          </div>

          <div className="p-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
            <select
              value={txType}
              onChange={(e) => setTxType(e.target.value)}
              className="h-9 px-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700"
            >
              <option value="all">{at(adminLang, 'all')}</option>
              <option value="deposit">Deposit</option>
              <option value="withdrawal">Withdrawal</option>
              <option value="wager">Wager</option>
              <option value="payout">Payout</option>
              <option value="admin_adjustment">Admin Adjustment</option>
            </select>
            <div className="relative flex-1 min-w-[180px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={txSearch}
                onChange={(e) => setTxSearch(e.target.value)}
                placeholder={at(adminLang, 'search')}
                className="w-full h-9 pl-8 pr-3 rounded-lg bg-slate-50 border border-slate-200 text-xs"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-500 border-b border-slate-100">
                  <th className="py-2.5 px-4 font-semibold">Ref</th>
                  <th className="py-2.5 px-3 font-semibold">{at(adminLang, 'username')}</th>
                  <th className="py-2.5 px-3 font-semibold">Type</th>
                  <th className="py-2.5 px-3 font-semibold text-right">{at(adminLang, 'amount')}</th>
                  <th className="py-2.5 px-3 font-semibold">{at(adminLang, 'status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTx.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-slate-400">
                      {at(adminLang, 'no_records')}
                    </td>
                  </tr>
                ) : (
                  filteredTx.map((tx: any) => {
                    const amt = parseFloat(tx.amount);
                    return (
                      <tr key={tx.txRef} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-4 font-mono-num font-semibold text-slate-800">{tx.txRef}</td>
                        <td className="py-2.5 px-3 text-slate-700">{tx.userName || tx.username || `#${tx.userId}`}</td>
                        <td className="py-2.5 px-3 capitalize text-slate-600">{String(tx.type).replace('_', ' ')}</td>
                        <td
                          className={`py-2.5 px-3 text-right font-mono-num font-bold ${
                            amt >= 0 ? 'text-emerald-600' : 'text-red-500'
                          }`}
                        >
                          {amt >= 0 ? '+' : ''}
                          {formatCurrency(amt, 'USD', adminLang)}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-semibold text-[11px]">
                            {at(adminLang, 'completed')}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="xl:col-span-4 space-y-5">
          {/* WinGo Live Game Status */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-display font-bold text-slate-900">
                {at(adminLang, 'live_game_status')}
              </h3>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                  live1m?.modePaused
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-emerald-100 text-emerald-700'
                }`}
              >
                {live1m?.modePaused ? at(adminLang, 'paused') : at(adminLang, 'running')}
              </span>
            </div>

            {live1m && (
              <div className="space-y-3">
                <div className="text-xs font-semibold text-slate-700">{live1m.label}</div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="text-[11px] text-slate-500">{at(adminLang, 'current_round')}</div>
                    <div className="text-xs font-mono-num font-bold text-slate-900 mt-0.5 truncate">
                      {live1m.currentRound?.periodId}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-100 text-center">
                    <div className="text-[11px] text-rose-600">{at(adminLang, 'countdown')}</div>
                    <div className="text-lg font-mono-num font-extrabold text-[#D92D20]">
                      {String(live1m.currentRound?.remainingSeconds ?? 0).padStart(2, '0')}s
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-4 gap-1.5 pt-1">
              {(data?.liveGames || []).map((g: any) => (
                <div
                  key={g.mode}
                  className="p-2 rounded-lg bg-slate-50 border border-slate-100 text-center"
                >
                  <div className="text-[11px] font-bold text-slate-700 uppercase">{g.mode}</div>
                  <div className="text-[11px] font-mono-num text-[#E63E22] font-bold">
                    {g.currentRound?.remainingSeconds ?? 0}s
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5 space-y-3">
            <h3 className="text-sm font-display font-bold text-slate-900">
              {at(adminLang, 'quick_actions')}
            </h3>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => onNavigate('players')}
                className="p-3 rounded-xl bg-rose-50/70 hover:bg-rose-50 border border-rose-100 text-left flex items-center gap-2.5 transition-colors"
              >
                <Users className="w-4 h-4 text-[#E63E22] shrink-0" />
                <span className="text-xs font-bold text-slate-800">{at(adminLang, 'm_players')}</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('results')}
                className="p-3 rounded-xl bg-blue-50/70 hover:bg-blue-50 border border-blue-100 text-left flex items-center gap-2.5 transition-colors"
              >
                <BarChart3 className="w-4 h-4 text-blue-600 shrink-0" />
                <span className="text-xs font-bold text-slate-800">{at(adminLang, 'm_results')}</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('wallets')}
                className="p-3 rounded-xl bg-amber-50/70 hover:bg-amber-50 border border-amber-100 text-left flex items-center gap-2.5 transition-colors"
              >
                <Wallet className="w-4 h-4 text-amber-600 shrink-0" />
                <span className="text-xs font-bold text-slate-800">{at(adminLang, 'm_wallets')}</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('settings')}
                className="p-3 rounded-xl bg-violet-50/70 hover:bg-violet-50 border border-violet-100 text-left flex items-center gap-2.5 transition-colors"
              >
                <Settings className="w-4 h-4 text-violet-600 shrink-0" />
                <span className="text-xs font-bold text-slate-800">{at(adminLang, 'm_settings')}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// MODULE 2: PLAYER MANAGEMENT (Screenshot #3 layout + real DB operations)
// =========================================================================
export function AdminPlayersModule({
  adminLang,
  onNotify,
}: {
  adminLang: AdminLang;
  onNotify: (msg: string, isError?: boolean) => void;
}) {
  const [players, setPlayers] = useState<any[]>([]);
  const [pendingPlayers, setPendingPlayers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    userId: '',
    username: '',
    phone: '',
    email: '',
    status: 'all',
    from: '',
    to: '',
  });
  const [showAdd, setShowAdd] = useState(false);
  const [newPlayer, setNewPlayer] = useState({
    username: '',
    displayName: '',
    email: '',
    phone: '',
    password: '',
    vipLevel: 0,
    isVerified: true,
  });
  const [detailModal, setDetailModal] = useState<any>(null);
  const [resetModal, setResetModal] = useState<{ id: number; name: string } | null>(null);
  const [resetPass, setResetPass] = useState('');

  const loadPlayers = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filters.userId) qs.set('userId', filters.userId);
      if (filters.username) qs.set('username', filters.username);
      if (filters.phone) qs.set('phone', filters.phone);
      if (filters.email) qs.set('email', filters.email);
      if (filters.status !== 'all') qs.set('status', filters.status);
      if (filters.from) qs.set('from', filters.from);
      if (filters.to) qs.set('to', filters.to);
      const [res, pendingRes] = await Promise.all([
        apiFetch(`/api/admin/players?${qs.toString()}`),
        apiFetch('/api/admin/players?status=pending'),
      ]);
      setPlayers(res.items || []);
      setPendingPlayers(pendingRes.items || []);
    } catch (err: any) {
      onNotify(err?.message || 'Failed to load players', true);
    } finally {
      setLoading(false);
    }
  }, [filters, onNotify]);

  useEffect(() => {
    loadPlayers();
  }, [loadPlayers]);

  const handleApprovePlayer = async (id: number) => {
    try {
      await apiFetch(`/api/admin/players/${id}/approve`, { method: 'POST' });
      onNotify('Player registration approved. Phone verification remains separate.');
      await loadPlayers();
    } catch (err: any) {
      onNotify(err?.message || 'Approval failed', true);
    }
  };

  const handleRejectPlayer = async (id: number) => {
    try {
      await apiFetch(`/api/admin/players/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Rejected by administrator' }),
      });
      onNotify('Player registration rejected.');
      await loadPlayers();
    } catch (err: any) {
      onNotify(err?.message || 'Rejection failed', true);
    }
  };

  const handleUpdate = async (id: number, patch: Record<string, unknown>) => {
    try {
      await apiFetch(`/api/admin/players/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      onNotify('Player updated successfully.');
      await loadPlayers();
    } catch (err: any) {
      onNotify(err?.message || 'Update failed', true);
    }
  };

  const handleCreatePlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/players', {
        method: 'POST',
        body: JSON.stringify(newPlayer),
      });
      onNotify('Player account created in PostgreSQL.');
      setShowAdd(false);
      setNewPlayer({
        username: '',
        displayName: '',
        email: '',
        phone: '',
        password: '',
        vipLevel: 0,
        isVerified: true,
      });
      await loadPlayers();
    } catch (err: any) {
      onNotify(err?.message || 'Failed to create player', true);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetModal) return;
    try {
      await apiFetch(`/api/admin/players/${resetModal.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ newPassword: resetPass }),
      });
      onNotify('Player password reset and active sessions revoked.');
      setResetModal(null);
      setResetPass('');
    } catch (err: any) {
      onNotify(err?.message || 'Password reset failed', true);
    }
  };

  const handleViewDetails = async (id: number) => {
    try {
      const res = await apiFetch(`/api/admin/players/${id}`);
      setDetailModal(res);
    } catch (err: any) {
      onNotify(err?.message || 'Unable to load details', true);
    }
  };

  const exportCsv = () => {
    const header = ['ID', 'Username', 'DisplayName', 'Phone', 'Email', 'Balance', 'Status', 'InviteCode', 'CreatedAt'];
    const rows = players.map((p) => [
      p.id,
      p.username || '',
      p.displayName,
      p.phone || '',
      p.email || '',
      p.wallet?.availableBalance || '0.00',
      p.status,
      p.inviteCode,
      p.createdAt,
    ]);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wingo-players-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const activeCount = players.filter((p) => p.status === 'active').length;
  const suspendedCount = players.filter((p) => p.status === 'suspended').length;
  const vipCount = players.filter((p) => (p.vipLevel || 0) > 0).length;

  return (
    <div className="space-y-5">
      {/* 4 Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs">
          <div className="text-xs text-slate-500 font-semibold">{at(adminLang, 'kpi_total_users')}</div>
          <div className="text-2xl font-display font-extrabold text-slate-900 font-mono-num mt-1">
            {players.length}
          </div>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs">
          <div className="text-xs text-slate-500 font-semibold">{at(adminLang, 'kpi_active_players')}</div>
          <div className="text-2xl font-display font-extrabold text-emerald-600 font-mono-num mt-1">
            {activeCount}
          </div>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs">
          <div className="text-xs text-slate-500 font-semibold">{at(adminLang, 'kpi_suspended_users')}</div>
          <div className="text-2xl font-display font-extrabold text-red-600 font-mono-num mt-1">
            {suspendedCount}
          </div>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs">
          <div className="text-xs text-slate-500 font-semibold">{at(adminLang, 'kpi_vip_members')}</div>
          <div className="text-2xl font-display font-extrabold text-violet-600 font-mono-num mt-1">
            {vipCount}
          </div>
        </div>
      </div>

      {/* Multi-field Filter Bar matching Screenshot #3 */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <input
            type="text"
            value={filters.userId}
            onChange={(e) => setFilters({ ...filters, userId: e.target.value })}
            placeholder={at(adminLang, 'user_id')}
            className="h-9 px-3 rounded-lg bg-slate-50 border border-slate-200"
          />
          <input
            type="text"
            value={filters.username}
            onChange={(e) => setFilters({ ...filters, username: e.target.value })}
            placeholder={at(adminLang, 'username')}
            className="h-9 px-3 rounded-lg bg-slate-50 border border-slate-200"
          />
          <input
            type="text"
            value={filters.phone}
            onChange={(e) => setFilters({ ...filters, phone: e.target.value })}
            placeholder={at(adminLang, 'phone')}
            className="h-9 px-3 rounded-lg bg-slate-50 border border-slate-200"
          />
          <input
            type="text"
            value={filters.email}
            onChange={(e) => setFilters({ ...filters, email: e.target.value })}
            placeholder={at(adminLang, 'email')}
            className="h-9 px-3 rounded-lg bg-slate-50 border border-slate-200"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className="h-9 px-3 rounded-lg bg-slate-50 border border-slate-200"
            >
              <option value="all">{at(adminLang, 'status')}: {at(adminLang, 'all')}</option>
              <option value="active">{at(adminLang, 'active')}</option>
              <option value="pending">Pending Approval</option>
              <option value="pending_approval">pending_approval</option>
              <option value="pending_verification">pending_verification</option>
              <option value="rejected">rejected</option>
              <option value="suspended">{at(adminLang, 'suspended')}</option>
            </select>
            <input
              type="date"
              value={filters.from}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
              className="h-9 px-2.5 rounded-lg bg-slate-50 border border-slate-200"
            />
            <input
              type="date"
              value={filters.to}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
              className="h-9 px-2.5 rounded-lg bg-slate-50 border border-slate-200"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={loadPlayers}
              className="h-9 px-4 rounded-lg bg-[#D92D20] hover:bg-[#B42318] text-white font-semibold inline-flex items-center gap-1.5"
            >
              <Search className="w-3.5 h-3.5" /> {at(adminLang, 'search')}
            </button>
            <button
              type="button"
              onClick={() =>
                setFilters({ userId: '', username: '', phone: '', email: '', status: 'all', from: '', to: '' })
              }
              className="h-9 px-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold inline-flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" /> {at(adminLang, 'reset')}
            </button>
            <button
              type="button"
              onClick={exportCsv}
              className="h-9 px-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" /> {at(adminLang, 'export_csv')}
            </button>
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="h-9 px-4 rounded-lg bg-gradient-to-r from-[#D92D20] to-[#F97316] text-white font-semibold inline-flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> {at(adminLang, 'add_player')}
            </button>
          </div>
        </div>
      </div>

      {/* Pending Approval Section */}
      {pendingPlayers.length > 0 && (
        <div className="bg-white rounded-2xl border border-amber-200 shadow-xs overflow-hidden">
          <div className="px-5 py-3.5 bg-amber-50/70 border-b border-amber-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-amber-600" />
              <h3 className="text-xs font-display font-bold text-slate-900">
                Pending Approval ({pendingPlayers.length})
              </h3>
            </div>
            <span className="text-[11px] text-amber-800 font-medium">
              Manual Administrator Review (phone verification remains separate)
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-500 border-b border-slate-100">
                  <th className="py-2.5 px-4 font-semibold">{at(adminLang, 'user_id')}</th>
                  <th className="py-2.5 px-3 font-semibold">{at(adminLang, 'username')}</th>
                  <th className="py-2.5 px-3 font-semibold">{at(adminLang, 'phone')}</th>
                  <th className="py-2.5 px-3 font-semibold">Registered</th>
                  <th className="py-2.5 px-3 font-semibold">{at(adminLang, 'status')}</th>
                  <th className="py-2.5 px-4 font-semibold text-right">{at(adminLang, 'actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pendingPlayers.map((p) => (
                  <tr key={p.id} className="hover:bg-amber-50/30">
                    <td className="py-2.5 px-4 font-mono-num font-bold text-slate-800">
                      U{String(p.id).padStart(6, '0')}
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-slate-900">
                      {p.username || p.displayName}
                    </td>
                    <td className="py-2.5 px-3 font-mono-num text-slate-600">
                      <span>{p.phone || p.email || '—'}</span>
                      {!p.isVerified && (
                        <span className="ml-2 px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px]">
                          Unverified
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-slate-500">
                      {p.createdAt ? new Date(p.createdAt).toLocaleString() : '—'}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="px-2 py-0.5 rounded-md font-semibold text-[11px] bg-amber-50 text-amber-700">
                        {p.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleApprovePlayer(p.id)}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-[11px]"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRejectPlayer(p.id)}
                          className="px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 font-semibold text-[11px]"
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Player List Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 border-b border-slate-100">
                <th className="py-3 px-4 font-semibold">{at(adminLang, 'user_id')}</th>
                <th className="py-3 px-3 font-semibold">{at(adminLang, 'username')}</th>
                <th className="py-3 px-3 font-semibold">{at(adminLang, 'phone')}</th>
                <th className="py-3 px-3 font-semibold">{at(adminLang, 'email')}</th>
                <th className="py-3 px-3 font-semibold text-right">{at(adminLang, 'balance')}</th>
                <th className="py-3 px-3 font-semibold">{at(adminLang, 'status')}</th>
                <th className="py-3 px-3 font-semibold">{at(adminLang, 'referral_code')}</th>
                <th className="py-3 px-3 font-semibold">{at(adminLang, 'vip_level')}</th>
                <th className="py-3 px-4 font-semibold text-right">{at(adminLang, 'actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-400">
                    ...
                  </td>
                </tr>
              ) : players.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-500 font-medium">
                    {at(adminLang, 'no_players_yet')}
                  </td>
                </tr>
              ) : (
                players.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono-num font-bold text-slate-800">U{String(p.id).padStart(6, '0')}</td>
                    <td className="py-3 px-3 font-semibold text-slate-900">
                      {p.username || p.displayName}
                    </td>
                    <td className="py-3 px-3 font-mono-num text-slate-600">{p.phone || '—'}</td>
                    <td className="py-3 px-3 text-slate-600">{p.email || '—'}</td>
                    <td className="py-3 px-3 text-right font-mono-num font-bold text-slate-900">
                      {formatCurrency(p.wallet?.availableBalance || 0, p.wallet?.currency || 'USD', adminLang)}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`px-2 py-0.5 rounded-md font-semibold text-[11px] ${
                          p.status === 'active'
                            ? 'bg-emerald-50 text-emerald-700'
                            : p.status === 'suspended' || p.status === 'rejected'
                              ? 'bg-red-50 text-red-600'
                              : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono-num text-slate-700">{p.inviteCode}</td>
                    <td className="py-3 px-3 font-mono-num font-semibold text-amber-600">
                      VIP {p.vipLevel || 0}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleViewDetails(p.id)}
                          title={at(adminLang, 'details')}
                          className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        {!p.isVerified && (
                          <button
                            type="button"
                            onClick={() => handleUpdate(p.id, { isVerified: true, status: 'active' })}
                            title={at(adminLang, 'verify_account')}
                            className="p-1.5 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-700"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdate(p.id, {
                              status: p.status === 'suspended' ? 'active' : 'suspended',
                            })
                          }
                          title={p.status === 'suspended' ? at(adminLang, 'activate') : at(adminLang, 'suspend')}
                          className={`p-1.5 rounded-lg ${
                            p.status === 'suspended'
                              ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700'
                              : 'bg-amber-50 hover:bg-amber-100 text-amber-700'
                          }`}
                        >
                          {p.status === 'suspended' ? (
                            <Unlock className="w-3.5 h-3.5" />
                          ) : (
                            <Lock className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setResetModal({ id: p.id, name: p.displayName })}
                          title={at(adminLang, 'reset_password')}
                          className="p-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Player Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <form onSubmit={handleCreatePlayer} className="bg-white rounded-2xl max-w-md w-full p-5 space-y-3 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">{at(adminLang, 'add_player')}</h3>
              <button type="button" onClick={() => setShowAdd(false)}><X className="w-4 h-4" /></button>
            </div>
            <input
              type="text"
              placeholder="Display Name *"
              required
              value={newPlayer.displayName}
              onChange={(e) => setNewPlayer({ ...newPlayer, displayName: e.target.value })}
              className="w-full h-10 px-3 rounded-lg bg-slate-50 border border-slate-200 text-xs"
            />
            <input
              type="text"
              placeholder="Username (optional)"
              value={newPlayer.username}
              onChange={(e) => setNewPlayer({ ...newPlayer, username: e.target.value })}
              className="w-full h-10 px-3 rounded-lg bg-slate-50 border border-slate-200 text-xs"
            />
            <input
              type="email"
              placeholder="Email (email or phone required)"
              value={newPlayer.email}
              onChange={(e) => setNewPlayer({ ...newPlayer, email: e.target.value })}
              className="w-full h-10 px-3 rounded-lg bg-slate-50 border border-slate-200 text-xs"
            />
            <input
              type="tel"
              placeholder="Phone digits (optional if email provided)"
              value={newPlayer.phone}
              onChange={(e) => setNewPlayer({ ...newPlayer, phone: e.target.value })}
              className="w-full h-10 px-3 rounded-lg bg-slate-50 border border-slate-200 text-xs"
            />
            <input
              type="password"
              placeholder="Initial Password (min 8 chars, letters + numbers) *"
              required
              minLength={8}
              value={newPlayer.password}
              onChange={(e) => setNewPlayer({ ...newPlayer, password: e.target.value })}
              className="w-full h-10 px-3 rounded-lg bg-slate-50 border border-slate-200 text-xs"
            />
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={newPlayer.isVerified}
                onChange={(e) => setNewPlayer({ ...newPlayer, isVerified: e.target.checked })}
              />
              <span>Mark as verified & active immediately</span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowAdd(false)} className="h-9 px-4 rounded-lg border border-slate-200 text-xs font-semibold">
                {at(adminLang, 'cancel')}
              </button>
              <button type="submit" className="h-9 px-4 rounded-lg bg-[#D92D20] text-white text-xs font-semibold">
                {at(adminLang, 'create')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <form onSubmit={handleResetPassword} className="bg-white rounded-2xl max-w-sm w-full p-5 space-y-3 shadow-2xl">
            <h3 className="text-sm font-bold text-slate-900">
              {at(adminLang, 'reset_password')} — {resetModal.name}
            </h3>
            <input
              type="password"
              required
              minLength={8}
              placeholder="New password (letters + numbers)"
              value={resetPass}
              onChange={(e) => setResetPass(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-slate-50 border border-slate-200 text-xs"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setResetModal(null)} className="h-9 px-3 rounded-lg border border-slate-200 text-xs">
                {at(adminLang, 'cancel')}
              </button>
              <button type="submit" className="h-9 px-4 rounded-lg bg-[#D92D20] text-white text-xs font-semibold">
                {at(adminLang, 'save')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Player Details Modal */}
      {detailModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-5 space-y-4 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">
                {detailModal.player.displayName} (ID #{detailModal.player.id})
              </h3>
              <button type="button" onClick={() => setDetailModal(null)}><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
              <div className="p-2.5 rounded-xl bg-slate-50">
                <div className="text-slate-400">Balance</div>
                <div className="font-mono-num font-bold text-slate-900">
                  {formatCurrency(detailModal.wallet?.availableBalance || 0, detailModal.wallet?.currency || 'USD', adminLang)}
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50">
                <div className="text-slate-400">Wagered</div>
                <div className="font-mono-num font-bold text-slate-900">
                  {formatCurrency(detailModal.wallet?.totalWagered || 0, detailModal.wallet?.currency || 'USD', adminLang)}
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50">
                <div className="text-slate-400">Status / Verified</div>
                <div className="font-bold text-slate-900">
                  {detailModal.player.status} / {detailModal.player.isVerified ? 'Yes' : 'No'}
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="text-xs font-bold text-slate-700">Recent Transactions ({detailModal.recentTransactions?.length || 0})</div>
              {(detailModal.recentTransactions || []).slice(0, 6).map((t: any) => (
                <div key={t.txRef} className="text-xs flex justify-between py-1.5 border-b border-slate-100">
                  <span className="font-mono-num text-slate-600">{t.txRef} · {t.type}</span>
                  <span className="font-mono-num font-bold">{t.amount}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// MODULE 3: ADMINISTRATOR MANAGEMENT
// =========================================================================
export function AdminStaffModule({
  adminLang,
  currentUserRole,
  onNotify,
}: {
  adminLang: AdminLang;
  currentUserRole: string;
  onNotify: (msg: string, isError?: boolean) => void;
}) {
  const [admins, setAdmins] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    username: '',
    displayName: '',
    email: '',
    password: '',
    role: 'admin' as 'admin' | 'finance' | 'support',
  });

  const load = useCallback(async () => {
    const res = await apiFetch('/api/admin/admins');
    setAdmins(res.items || []);
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/admins', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      onNotify('Administrator created successfully.');
      setShowCreate(false);
      setForm({ username: '', displayName: '', email: '', password: '', role: 'admin' });
      await load();
    } catch (err: any) {
      onNotify(err?.message || 'Failed to create administrator', true);
    }
  };

  const handleToggleStatus = async (admin: any) => {
    try {
      await apiFetch(`/api/admin/admins/${admin.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: admin.status === 'suspended' ? 'active' : 'suspended' }),
      });
      onNotify('Administrator status updated.');
      await load();
    } catch (err: any) {
      onNotify(err?.message || 'Unable to update administrator', true);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">
          Public administrator registration is strictly disabled. Only Super Administrators can create or modify staff accounts.
        </div>
        {currentUserRole === 'super_admin' && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="h-9 px-4 rounded-lg bg-[#D92D20] text-white text-xs font-semibold inline-flex items-center gap-1 shrink-0"
          >
            <Plus className="w-3.5 h-3.5" /> {at(adminLang, 'add_admin')}
          </button>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 border-b border-slate-100">
                <th className="py-3 px-4 font-semibold">{at(adminLang, 'username')}</th>
                <th className="py-3 px-3 font-semibold">Name</th>
                <th className="py-3 px-3 font-semibold">{at(adminLang, 'email')}</th>
                <th className="py-3 px-3 font-semibold">{at(adminLang, 'role')}</th>
                <th className="py-3 px-3 font-semibold">{at(adminLang, 'status')}</th>
                <th className="py-3 px-4 font-semibold text-right">{at(adminLang, 'actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {admins.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4 font-bold text-slate-900 flex items-center gap-2">
                    <Shield className="w-3.5 h-3.5 text-[#D92D20]" />
                    <span>{a.username || `admin#${a.id}`}</span>
                  </td>
                  <td className="py-3 px-3 text-slate-700">{a.displayName}</td>
                  <td className="py-3 px-3 text-slate-500">{a.email || '—'}</td>
                  <td className="py-3 px-3">
                    <span className="px-2 py-0.5 rounded-md bg-slate-900 text-white text-[11px] font-semibold uppercase">
                      {a.role}
                    </span>
                  </td>
                  <td className="py-3 px-3">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                        a.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                      }`}
                    >
                      {a.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    {currentUserRole === 'super_admin' && a.username?.toLowerCase() !== 'afa' && (
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(a)}
                        className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 text-xs font-semibold"
                      >
                        {a.status === 'suspended' ? at(adminLang, 'activate') : at(adminLang, 'suspend')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <form onSubmit={handleCreate} className="bg-white rounded-2xl max-w-md w-full p-5 space-y-3 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">{at(adminLang, 'add_admin')}</h3>
              <button type="button" onClick={() => setShowCreate(false)}><X className="w-4 h-4" /></button>
            </div>
            <input
              type="text"
              placeholder="Username *"
              required
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              className="w-full h-10 px-3 rounded-lg bg-slate-50 border border-slate-200 text-xs"
            />
            <input
              type="text"
              placeholder="Display Name *"
              required
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              className="w-full h-10 px-3 rounded-lg bg-slate-50 border border-slate-200 text-xs"
            />
            <input
              type="email"
              placeholder="Email (optional)"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full h-10 px-3 rounded-lg bg-slate-50 border border-slate-200 text-xs"
            />
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as any })}
              className="w-full h-10 px-3 rounded-lg bg-slate-50 border border-slate-200 text-xs"
            >
              <option value="admin">Admin</option>
              <option value="finance">Finance</option>
              <option value="support">Support</option>
            </select>
            <input
              type="password"
              placeholder="Password (min 10 chars, letters + numbers) *"
              required
              minLength={10}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="w-full h-10 px-3 rounded-lg bg-slate-50 border border-slate-200 text-xs"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowCreate(false)} className="h-9 px-4 rounded-lg border border-slate-200 text-xs">
                {at(adminLang, 'cancel')}
              </button>
              <button type="submit" className="h-9 px-4 rounded-lg bg-[#D92D20] text-white text-xs font-semibold">
                {at(adminLang, 'create')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
