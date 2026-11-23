import React, { useEffect, useState, useCallback } from 'react';
import {
  ShieldCheck,
  PauseCircle,
  PlayCircle,
  CheckCircle2,
  Plus,
  Search,
  RefreshCw,
  Clock,
  Lock,
} from 'lucide-react';
import { apiFetch, formatCurrency } from '../../lib/api';
import { at, type AdminLang } from './adminI18n';

function NumberBadge({ num }: { num: number | null | undefined }) {
  if (num === null || num === undefined) {
    return <span className="text-slate-400">—</span>;
  }
  const colorCls =
    num === 0
      ? 'bg-gradient-to-br from-red-500 to-violet-600'
      : num === 5
        ? 'bg-gradient-to-br from-emerald-500 to-violet-600'
        : num % 2 === 1
          ? 'bg-emerald-600'
          : 'bg-red-500';
  return (
    <span
      className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-white font-mono-num font-bold text-xs shadow-xs ${colorCls}`}
    >
      {num}
    </span>
  );
}

// =========================================================================
// MODULE 4: GAME MANAGEMENT (RULESETS & MODE CONTROLS)
// =========================================================================
export function AdminGamesModule({
  adminLang,
  currentUserRole,
  onNotify,
}: {
  adminLang: AdminLang;
  currentUserRole: string;
  onNotify: (msg: string, isError?: boolean) => void;
}) {
  const [overview, setOverview] = useState<any>(null);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({
    version: '',
    notes: '',
    feePercent: 2,
    minWager: 1,
    maxWager: 10000,
    colorStandard: 2,
    colorSplitViolet: 1.5,
    violet: 4.5,
    numberExact: 9,
    bigSmall: 2,
    tier1Percent: 1.2,
    tier2Percent: 0.4,
  });

  const load = useCallback(async () => {
    const res = await apiFetch('/api/admin/games/overview');
    setOverview(res);
  }, []);

  useEffect(() => {
    load().catch((e) => onNotify(e?.message || 'Unable to load games overview', true));
  }, [load, onNotify]);

  const toggleMode = async (mode: string, paused: boolean) => {
    try {
      await apiFetch('/api/admin/games/mode-status', {
        method: 'PATCH',
        body: JSON.stringify({ mode, paused }),
      });
      onNotify(paused ? `Mode ${mode} paused.` : `Mode ${mode} resumed.`);
      await load();
    } catch (err: any) {
      onNotify(err?.message || 'Unable to toggle mode status', true);
    }
  };

  const handleCreateRuleset = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/rulesets', {
        method: 'POST',
        body: JSON.stringify({
          version: form.version,
          notes: form.notes,
          feePercent: Number(form.feePercent),
          minWager: Number(form.minWager),
          maxWager: Number(form.maxWager),
          payoutMultipliers: {
            colorStandard: Number(form.colorStandard),
            colorSplitViolet: Number(form.colorSplitViolet),
            violet: Number(form.violet),
            numberExact: Number(form.numberExact),
            bigSmall: Number(form.bigSmall),
          },
          commissionRates: {
            tier1Percent: Number(form.tier1Percent),
            tier2Percent: Number(form.tier2Percent),
          },
        }),
      });
      onNotify('New ruleset version created and activated.');
      setShowNew(false);
      setForm((prev) => ({ ...prev, version: '', notes: '' }));
      await load();
    } catch (err: any) {
      onNotify(err?.message || 'Unable to create ruleset', true);
    }
  };

  const handleApproveRuleset = async (id: number) => {
    try {
      await apiFetch(`/api/admin/rulesets/${id}/approve`, { method: 'POST' });
      onNotify('Ruleset approved for production.');
      await load();
    } catch (err: any) {
      onNotify(err?.message || 'Approval failed', true);
    }
  };

  return (
    <div className="space-y-5">
      {/* Live Modes Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {(overview?.liveModes || []).map((m: any) => (
          <div
            key={m.mode}
            className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex flex-col justify-between gap-3"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm font-display font-bold text-slate-900">{m.label}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {m.durationSeconds}s · Lock {m.cutoffSeconds}s
                </div>
              </div>
              <span
                className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                  m.modePaused ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'
                }`}
              >
                {m.modePaused ? at(adminLang, 'paused') : at(adminLang, 'running')}
              </span>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-50 text-xs flex items-center justify-between">
              <span className="font-mono-num text-slate-600 truncate">{m.currentRound?.periodId}</span>
              <span className="font-mono-num font-bold text-[#D92D20]">
                {m.currentRound?.remainingSeconds ?? 0}s
              </span>
            </div>

            {['super_admin', 'admin'].includes(currentUserRole) && (
              <button
                type="button"
                onClick={() => toggleMode(m.mode, !m.modePaused)}
                className={`h-9 w-full rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 ${
                  m.modePaused
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200'
                }`}
              >
                {m.modePaused ? (
                  <>
                    <PlayCircle className="w-4 h-4" /> {at(adminLang, 'resume_betting')}
                  </>
                ) : (
                  <>
                    <PauseCircle className="w-4 h-4" /> {at(adminLang, 'pause_betting')}
                  </>
                )}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Rulesets Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-display font-bold text-slate-900">Versioned Game Rulesets</h3>
          {['super_admin', 'admin'].includes(currentUserRole) && (
            <button
              type="button"
              onClick={() => setShowNew(!showNew)}
              className="h-9 px-3.5 rounded-lg bg-[#D92D20] text-white text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> {at(adminLang, 'create_ruleset')}
            </button>
          )}
        </div>

        {showNew && (
          <form onSubmit={handleCreateRuleset} className="p-4 bg-slate-50 border-b border-slate-200 space-y-3 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="text"
                required
                placeholder="Version (e.g. v1.1-prod)"
                value={form.version}
                onChange={(e) => setForm({ ...form, version: e.target.value })}
                className="h-9 px-3 rounded-lg bg-white border border-slate-200"
              />
              <input
                type="text"
                placeholder="Notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="h-9 px-3 rounded-lg bg-white border border-slate-200 sm:col-span-2"
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              <label className="space-y-1">
                <span className="text-[11px] text-slate-500">Fee %</span>
                <input
                  type="number"
                  step="0.1"
                  value={form.feePercent}
                  onChange={(e) => setForm({ ...form, feePercent: Number(e.target.value) })}
                  className="w-full h-9 px-2.5 rounded-lg bg-white border border-slate-200"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-slate-500">Min Wager</span>
                <input
                  type="number"
                  value={form.minWager}
                  onChange={(e) => setForm({ ...form, minWager: Number(e.target.value) })}
                  className="w-full h-9 px-2.5 rounded-lg bg-white border border-slate-200"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-slate-500">Max Wager</span>
                <input
                  type="number"
                  value={form.maxWager}
                  onChange={(e) => setForm({ ...form, maxWager: Number(e.target.value) })}
                  className="w-full h-9 px-2.5 rounded-lg bg-white border border-slate-200"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-slate-500">Color Payout</span>
                <input
                  type="number"
                  step="0.1"
                  value={form.colorStandard}
                  onChange={(e) => setForm({ ...form, colorStandard: Number(e.target.value) })}
                  className="w-full h-9 px-2.5 rounded-lg bg-white border border-slate-200"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-slate-500">Exact # Payout</span>
                <input
                  type="number"
                  step="0.1"
                  value={form.numberExact}
                  onChange={(e) => setForm({ ...form, numberExact: Number(e.target.value) })}
                  className="w-full h-9 px-2.5 rounded-lg bg-white border border-slate-200"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNew(false)}
                className="h-9 px-3 rounded-lg border border-slate-200 bg-white"
              >
                {at(adminLang, 'cancel')}
              </button>
              <button type="submit" className="h-9 px-4 rounded-lg bg-[#D92D20] text-white font-semibold">
                {at(adminLang, 'save')}
              </button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 border-b border-slate-100">
                <th className="py-3 px-4 font-semibold">Version</th>
                <th className="py-3 px-3 font-semibold">Fee</th>
                <th className="py-3 px-3 font-semibold">Wager Range</th>
                <th className="py-3 px-3 font-semibold">Payouts (Color / Exact / Violet)</th>
                <th className="py-3 px-3 font-semibold">{at(adminLang, 'status')}</th>
                <th className="py-3 px-4 font-semibold text-right">{at(adminLang, 'actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(overview?.rulesets || []).map((r: any) => {
                const cfg = r.configJson || {};
                const mult = cfg.payoutMultipliers || {};
                return (
                  <tr key={r.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono-num font-bold text-slate-900">
                      {r.version}
                      {r.notes && <div className="text-[11px] font-normal text-slate-400">{r.notes}</div>}
                    </td>
                    <td className="py-3 px-3 font-mono-num">{cfg.feePercent ?? 2}%</td>
                    <td className="py-3 px-3 font-mono-num">
                      {cfg.minWager} – {cfg.maxWager}
                    </td>
                    <td className="py-3 px-3 font-mono-num">
                      {mult.colorStandard}x / {mult.numberExact}x / {mult.violet}x
                    </td>
                    <td className="py-3 px-3 space-x-1">
                      {r.isActive && (
                        <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-semibold">
                          {at(adminLang, 'active')}
                        </span>
                      )}
                      {r.ownerApprovedForProd && (
                        <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-semibold">
                          Prod Approved
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {currentUserRole === 'super_admin' && !r.ownerApprovedForProd && (
                        <button
                          type="button"
                          onClick={() => handleApproveRuleset(r.id)}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold inline-flex items-center gap-1"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> {at(adminLang, 'approve_prod')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// MODULE 5: ROUND MANAGEMENT
// =========================================================================
export function AdminRoundsModule({
  adminLang,
  onNotify,
}: {
  adminLang: AdminLang;
  onNotify: (msg: string, isError?: boolean) => void;
}) {
  const [items, setItems] = useState<any[]>([]);
  const [mode, setMode] = useState('all');
  const [status, setStatus] = useState('all');

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/admin/rounds?mode=${mode}&status=${status}`);
    setItems(res.items || []);
  }, [mode, status]);

  useEffect(() => {
    load().catch((e) => onNotify(e?.message || 'Unable to load rounds', true));
  }, [load, onNotify]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className="h-9 px-3 rounded-lg bg-slate-50 border border-slate-200"
          >
            <option value="all">Mode: {at(adminLang, 'all')}</option>
            <option value="30s">WinGo 30s</option>
            <option value="1m">WinGo 1 Min</option>
            <option value="3m">WinGo 3 Min</option>
            <option value="5m">WinGo 5 Min</option>
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-9 px-3 rounded-lg bg-slate-50 border border-slate-200"
          >
            <option value="all">{at(adminLang, 'status')}: {at(adminLang, 'all')}</option>
            <option value="open">{at(adminLang, 'open')}</option>
            <option value="closed">{at(adminLang, 'closed')}</option>
            <option value="settled">{at(adminLang, 'settled')}</option>
          </select>
        </div>
        <button
          type="button"
          onClick={load}
          className="h-9 px-3.5 rounded-lg border border-slate-200 hover:bg-slate-50 inline-flex items-center gap-1.5 font-semibold"
        >
          <RefreshCw className="w-3.5 h-3.5" /> {at(adminLang, 'refresh')}
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 border-b border-slate-100">
                <th className="py-3 px-4 font-semibold">Period ID</th>
                <th className="py-3 px-3 font-semibold">Mode</th>
                <th className="py-3 px-3 font-semibold">{at(adminLang, 'status')}</th>
                <th className="py-3 px-3 font-semibold">Official Result</th>
                <th className="py-3 px-3 font-semibold">SHA-256 Commitment</th>
                <th className="py-3 px-4 font-semibold">Ends At</th>
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
                items.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-4 font-mono-num font-bold text-slate-900">{r.periodId}</td>
                    <td className="py-2.5 px-3 uppercase font-semibold text-slate-600">{r.mode}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded-md font-semibold text-[11px] ${
                          r.status === 'settled'
                            ? 'bg-emerald-50 text-emerald-700'
                            : r.status === 'open'
                              ? 'bg-blue-50 text-blue-700'
                              : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <NumberBadge num={r.winningNumber} />
                        {r.winningSize && (
                          <span className="capitalize text-slate-600 font-semibold">
                            {Array.isArray(r.winningColors) ? r.winningColors.join(' + ') : ''} · {r.winningSize}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500 max-w-[180px] truncate">
                      {r.serverSeedHash}
                    </td>
                    <td className="py-2.5 px-4 font-mono-num text-slate-500">
                      {new Date(r.endsAt).toLocaleString()}
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
// MODULE 6: OFFICIAL RESULT MONITORING (STRICTLY FAIR — ZERO RIGGING)
// =========================================================================
export function AdminResultsModule({
  adminLang,
  onNotify,
}: {
  adminLang: AdminLang;
  onNotify: (msg: string, isError?: boolean) => void;
}) {
  const [mode, setMode] = useState<'30s' | '1m' | '3m' | '5m'>('1m');
  const [data, setData] = useState<any>(null);

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/admin/results?mode=${mode}`);
    setData(res);
  }, [mode]);

  useEffect(() => {
    load().catch((e) => onNotify(e?.message || 'Unable to load result monitor', true));
    const iv = setInterval(() => load().catch(() => {}), 3000);
    return () => clearInterval(iv);
  }, [load, onNotify]);

  const cur = data?.currentRound;

  return (
    <div className="space-y-5">
      {/* Integrity Banner (Explicitly confirms no rigging) */}
      <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 flex items-start gap-3 text-xs text-emerald-900">
        <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-bold">Server-Controlled Provably Fair Draw Engine</div>
          <div>{at(adminLang, 'fairness_notice')}</div>
        </div>
      </div>

      {/* Mode Selector + Live Round Cards */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-xl bg-slate-100 p-1 gap-1">
            {(['30s', '1m', '3m', '5m'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  mode === m ? 'bg-[#D92D20] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                WinGo {m}
              </button>
            ))}
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
            <Lock className="w-3.5 h-3.5 text-emerald-600" /> Auto CSPRNG Draw Only
          </span>
        </div>

        {cur && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/70">
              <div className="text-xs text-slate-500 font-semibold">{at(adminLang, 'current_round')}</div>
              <div className="text-lg font-mono-num font-extrabold text-slate-900 mt-1">{cur.periodId}</div>
            </div>
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200/70 flex items-center justify-between">
              <div>
                <div className="text-xs text-rose-600 font-semibold">{at(adminLang, 'countdown')}</div>
                <div className="text-2xl font-mono-num font-extrabold text-[#D92D20] mt-0.5">
                  {String(cur.remainingSeconds ?? 0).padStart(2, '0')}s
                </div>
              </div>
              <Clock className="w-7 h-7 text-rose-400" />
            </div>
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/70">
              <div className="text-xs text-slate-500 font-semibold">Pre-Committed SHA-256 Hash</div>
              <div className="text-[11px] font-mono text-slate-700 mt-1.5 break-all">
                {cur.serverSeedHash}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Live Round Exposure Table (Monitoring Only — Zero Publish/Override Buttons) */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-display font-bold text-slate-900">
            {at(adminLang, 'live_exposure')}
          </h3>
          {cur && (
            <span className="px-2.5 py-1 rounded-lg bg-rose-50 text-[#D92D20] font-mono-num text-xs font-bold">
              Round: {cur.periodId}
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 border-b border-slate-100">
                <th className="py-2.5 px-4 font-semibold">Category</th>
                <th className="py-2.5 px-3 font-semibold">Selection</th>
                <th className="py-2.5 px-3 font-semibold text-right">Bets</th>
                <th className="py-2.5 px-3 font-semibold text-right">Total Stake</th>
                <th className="py-2.5 px-4 font-semibold text-right">Potential Payout</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.currentExposure || []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">
                    No active bets on the current round yet.
                  </td>
                </tr>
              ) : (
                data.currentExposure.map((e: any, idx: number) => (
                  <tr key={`${e.category}-${e.selection}-${idx}`}>
                    <td className="py-2.5 px-4 uppercase font-semibold text-slate-600">{e.category}</td>
                    <td className="py-2.5 px-3 font-bold capitalize text-slate-900">{e.selection}</td>
                    <td className="py-2.5 px-3 text-right font-mono-num">{e.betCount}</td>
                    <td className="py-2.5 px-3 text-right font-mono-num font-semibold">
                      {formatCurrency(e.totalStake, 'USD', adminLang)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-num font-bold text-amber-700">
                      {formatCurrency(e.potentialPayout, 'USD', adminLang)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Official Settled Result History */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <h3 className="text-sm font-display font-bold text-slate-900">
            {at(adminLang, 'recent_official_results')}
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 border-b border-slate-100">
                <th className="py-2.5 px-4 font-semibold">Period ID</th>
                <th className="py-2.5 px-3 font-semibold">Result</th>
                <th className="py-2.5 px-3 font-semibold">Color</th>
                <th className="py-2.5 px-3 font-semibold">Size</th>
                <th className="py-2.5 px-3 font-semibold">Revealed Seed</th>
                <th className="py-2.5 px-4 font-semibold">Settled At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.recentSettled || []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    {at(adminLang, 'no_records')}
                  </td>
                </tr>
              ) : (
                data.recentSettled.map((r: any) => (
                  <tr key={r.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-4 font-mono-num font-bold text-slate-900">{r.periodId}</td>
                    <td className="py-2.5 px-3">
                      <NumberBadge num={r.winningNumber} />
                    </td>
                    <td className="py-2.5 px-3 capitalize font-semibold text-slate-700">
                      {Array.isArray(r.winningColors) ? r.winningColors.join(' + ') : '—'}
                    </td>
                    <td className="py-2.5 px-3 capitalize font-semibold text-slate-700">{r.winningSize}</td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500 max-w-[160px] truncate">
                      {r.serverSeedReveal || '—'}
                    </td>
                    <td className="py-2.5 px-4 font-mono-num text-slate-500">
                      {r.settledAt ? new Date(r.settledAt).toLocaleString() : '—'}
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
// MODULES 7 & 8: BETTING ORDERS (LIVE) & BETTING HISTORY (SETTLED)
// =========================================================================
export function AdminBetsModule({
  adminLang,
  scope,
  onNotify,
}: {
  adminLang: AdminLang;
  scope: 'orders' | 'history';
  onNotify: (msg: string, isError?: boolean) => void;
}) {
  const [items, setItems] = useState<any[]>([]);
  const [mode, setMode] = useState('all');
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ scope, mode, status });
    if (search.trim()) qs.set('search', search.trim());
    const res = await apiFetch(`/api/admin/bets?${qs.toString()}`);
    setItems(res.items || []);
  }, [scope, mode, status, search]);

  useEffect(() => {
    load().catch((e) => onNotify(e?.message || 'Unable to load bets', true));
  }, [load, onNotify]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex flex-wrap items-center gap-2.5 text-xs">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          className="h-9 px-3 rounded-lg bg-slate-50 border border-slate-200"
        >
          <option value="all">Mode: {at(adminLang, 'all')}</option>
          <option value="30s">30s</option>
          <option value="1m">1m</option>
          <option value="3m">3m</option>
          <option value="5m">5m</option>
        </select>
        {scope === 'history' && (
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-9 px-3 rounded-lg bg-slate-50 border border-slate-200"
          >
            <option value="all">{at(adminLang, 'status')}: {at(adminLang, 'all')}</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
            <option value="refunded">Refunded</option>
          </select>
        )}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ticket ID, Period ID, or Player..."
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
                <th className="py-3 px-4 font-semibold">Ticket</th>
                <th className="py-3 px-3 font-semibold">Period / Mode</th>
                <th className="py-3 px-3 font-semibold">Player</th>
                <th className="py-3 px-3 font-semibold">Selection</th>
                <th className="py-3 px-3 font-semibold text-right">Stake</th>
                <th className="py-3 px-3 font-semibold text-right">
                  {scope === 'orders' ? 'Potential' : 'Payout'}
                </th>
                <th className="py-3 px-3 font-semibold">Draw #</th>
                <th className="py-3 px-4 font-semibold">{at(adminLang, 'status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-400">
                    {at(adminLang, 'no_records')}
                  </td>
                </tr>
              ) : (
                items.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-4 font-mono-num font-bold text-slate-800">{b.ticketId}</td>
                    <td className="py-2.5 px-3 font-mono-num">
                      {b.periodId} <span className="text-slate-400 uppercase">({b.mode})</span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-700">{b.userName || b.username || `#${b.userId}`}</td>
                    <td className="py-2.5 px-3 capitalize font-semibold">
                      {b.category}: {b.selection}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono-num font-semibold">
                      {formatCurrency(b.totalStake, 'USD', adminLang)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono-num font-bold text-emerald-700">
                      {formatCurrency(
                        scope === 'orders' ? b.potentialPayout : b.actualPayout,
                        'USD',
                        adminLang
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <NumberBadge num={b.winningNumber} />
                    </td>
                    <td className="py-2.5 px-4">
                      <span
                        className={`px-2 py-0.5 rounded-md font-semibold text-[11px] uppercase ${
                          b.status === 'won'
                            ? 'bg-emerald-50 text-emerald-700'
                            : b.status === 'lost'
                              ? 'bg-slate-100 text-slate-600'
                              : b.status === 'pending'
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-blue-50 text-blue-700'
                        }`}
                      >
                        {b.status}
                      </span>
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
