import React, { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { apiFetch, formatCurrency } from '../../lib/api';
import { at, type AdminLang } from './adminI18n';

// =========================================================================
// MODULE 13: AGENT MANAGEMENT
// =========================================================================
export function AdminAgentsModule({
  adminLang,
  onNotify,
}: {
  adminLang: AdminLang;
  onNotify: (msg: string, isError?: boolean) => void;
}) {
  const [agents, setAgents] = useState<any[]>([]);

  const load = useCallback(async () => {
    const res = await apiFetch('/api/admin/agency/overview');
    setAgents(res.agents || []);
  }, []);

  useEffect(() => {
    load().catch((e) => onNotify(e?.message || 'Unable to load agents', true));
  }, [load, onNotify]);

  const toggleRole = async (id: number, currentRole: string) => {
    const nextRole = currentRole === 'agent' ? 'player' : 'agent';
    try {
      await apiFetch(`/api/admin/agents/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: nextRole }),
      });
      onNotify(`User role updated to ${nextRole}.`);
      await load();
    } catch (err: any) {
      onNotify(err?.message || 'Role update failed', true);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50 text-slate-500 border-b border-slate-100">
              <th className="py-3 px-4 font-semibold">Agent / User</th>
              <th className="py-3 px-3 font-semibold">{at(adminLang, 'referral_code')}</th>
              <th className="py-3 px-3 font-semibold">{at(adminLang, 'role')}</th>
              <th className="py-3 px-3 font-semibold text-right">Direct Referrals</th>
              <th className="py-3 px-3 font-semibold text-right">Total Commission</th>
              <th className="py-3 px-4 font-semibold text-right">{at(adminLang, 'actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {agents.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-slate-400">
                  {at(adminLang, 'no_records')}
                </td>
              </tr>
            ) : (
              agents.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4">
                    <div className="font-bold text-slate-900">{a.username || a.display_name}</div>
                    <div className="text-[11px] text-slate-400">{a.email || a.phone}</div>
                  </td>
                  <td className="py-3 px-3 font-mono-num font-semibold text-slate-700">{a.invite_code}</td>
                  <td className="py-3 px-3 uppercase font-semibold">{a.role}</td>
                  <td className="py-3 px-3 text-right font-mono-num">{a.direct_referrals}</td>
                  <td className="py-3 px-3 text-right font-mono-num font-bold text-emerald-700">
                    {formatCurrency(a.total_commission || 0, 'USD', adminLang)}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => toggleRole(a.id, a.role)}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 font-semibold"
                    >
                      {a.role === 'agent' ? 'Set Player' : 'Promote Agent'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// =========================================================================
// MODULE 14: REFERRAL MANAGEMENT
// =========================================================================
export function AdminReferralsModule({
  adminLang,
  onNotify,
}: {
  adminLang: AdminLang;
  onNotify: (msg: string, isError?: boolean) => void;
}) {
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    apiFetch('/api/admin/referrals')
      .then((res) => setItems(res.items || []))
      .catch((e) => onNotify(e?.message || 'Unable to load referrals', true));
  }, [onNotify]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50 text-slate-500 border-b border-slate-100">
              <th className="py-3 px-4 font-semibold">Referred Player</th>
              <th className="py-3 px-3 font-semibold">Contact</th>
              <th className="py-3 px-3 font-semibold">Referrer</th>
              <th className="py-3 px-3 font-semibold">Code Used</th>
              <th className="py-3 px-3 font-semibold">{at(adminLang, 'status')}</th>
              <th className="py-3 px-4 font-semibold">Joined</th>
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
                <tr key={r.referred_user_id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4 font-bold text-slate-900">{r.referred_name}</td>
                  <td className="py-3 px-3 text-slate-500">{r.referred_email || r.referred_phone || '—'}</td>
                  <td className="py-3 px-3 font-semibold text-slate-800">{r.referrer_name}</td>
                  <td className="py-3 px-3 font-mono-num text-slate-600">{r.referrer_code}</td>
                  <td className="py-3 px-3 capitalize">{r.referred_status}</td>
                  <td className="py-3 px-4 font-mono-num text-slate-400">
                    {new Date(r.joined_at).toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// =========================================================================
// MODULE 15: COMMISSION MANAGEMENT
// =========================================================================
export function AdminCommissionsModule({
  adminLang,
  onNotify,
}: {
  adminLang: AdminLang;
  onNotify: (msg: string, isError?: boolean) => void;
}) {
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    apiFetch('/api/admin/commissions')
      .then((res) => setItems(res.items || []))
      .catch((e) => onNotify(e?.message || 'Unable to load commissions', true));
  }, [onNotify]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50 text-slate-500 border-b border-slate-100">
              <th className="py-3 px-4 font-semibold">Agent</th>
              <th className="py-3 px-3 font-semibold">Tier</th>
              <th className="py-3 px-3 font-semibold text-right">Bet Amount</th>
              <th className="py-3 px-3 font-semibold text-right">Rate</th>
              <th className="py-3 px-3 font-semibold text-right">Commission</th>
              <th className="py-3 px-4 font-semibold">{at(adminLang, 'status')}</th>
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
              items.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4 font-bold text-slate-900">{c.agentName || `#${c.agentUserId}`}</td>
                  <td className="py-3 px-3 font-mono-num">Tier {c.tier}</td>
                  <td className="py-3 px-3 text-right font-mono-num">
                    {formatCurrency(c.betAmount, 'USD', adminLang)}
                  </td>
                  <td className="py-3 px-3 text-right font-mono-num">
                    {(parseFloat(c.commissionRate) * 100).toFixed(2)}%
                  </td>
                  <td className="py-3 px-3 text-right font-mono-num font-bold text-emerald-700">
                    {formatCurrency(c.commissionAmount, 'USD', adminLang)}
                  </td>
                  <td className="py-3 px-4 uppercase text-[11px] font-semibold text-slate-600">{c.status}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// =========================================================================
// MODULE 16: GIFT CODES
// =========================================================================
export function AdminGiftCodesModule({
  adminLang,
  onNotify,
}: {
  adminLang: AdminLang;
  onNotify: (msg: string, isError?: boolean) => void;
}) {
  const [data, setData] = useState<{ giftCodes: any[]; redemptions: any[] }>({ giftCodes: [], redemptions: [] });
  const [form, setForm] = useState({
    code: '',
    title: '',
    rewardAmount: 10,
    maxRedemptions: 100,
    minDepositRequired: 0,
    expiresInDays: 30,
  });

  const load = useCallback(async () => {
    const res = await apiFetch('/api/admin/promotions');
    setData({ giftCodes: res.giftCodes || [], redemptions: res.redemptions || [] });
  }, []);

  useEffect(() => {
    load().catch((e) => onNotify(e?.message || 'Unable to load gift codes', true));
  }, [load, onNotify]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/promotions', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          rewardAmount: Number(form.rewardAmount),
          maxRedemptions: Number(form.maxRedemptions),
          minDepositRequired: Number(form.minDepositRequired),
          expiresInDays: Number(form.expiresInDays),
        }),
      });
      onNotify('Gift code created.');
      setForm({ code: '', title: '', rewardAmount: 10, maxRedemptions: 100, minDepositRequired: 0, expiresInDays: 30 });
      await load();
    } catch (err: any) {
      onNotify(err?.message || 'Failed to create gift code', true);
    }
  };

  const handleToggle = async (id: number, isActive: boolean) => {
    try {
      await apiFetch(`/api/admin/promotions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive }),
      });
      await load();
    } catch (err: any) {
      onNotify(err?.message || 'Unable to toggle gift code', true);
    }
  };

  return (
    <div className="space-y-5">
      <form
        onSubmit={handleCreate}
        className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs grid grid-cols-1 sm:grid-cols-6 gap-2.5 text-xs items-end"
      >
        <div>
          <label className="block text-[11px] text-slate-500 mb-1">Code *</label>
          <input
            type="text"
            required
            placeholder="WINGO2026"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            className="w-full h-9 px-3 rounded-lg bg-slate-50 border border-slate-200 font-mono-num"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-[11px] text-slate-500 mb-1">Title *</label>
          <input
            type="text"
            required
            placeholder="Welcome Bonus"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="w-full h-9 px-3 rounded-lg bg-slate-50 border border-slate-200"
          />
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-1">Reward</label>
          <input
            type="number"
            min="1"
            value={form.rewardAmount}
            onChange={(e) => setForm({ ...form, rewardAmount: Number(e.target.value) })}
            className="w-full h-9 px-3 rounded-lg bg-slate-50 border border-slate-200 font-mono-num"
          />
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-1">Max Uses</label>
          <input
            type="number"
            min="1"
            value={form.maxRedemptions}
            onChange={(e) => setForm({ ...form, maxRedemptions: Number(e.target.value) })}
            className="w-full h-9 px-3 rounded-lg bg-slate-50 border border-slate-200 font-mono-num"
          />
        </div>
        <button
          type="submit"
          className="h-9 px-4 rounded-lg bg-[#D92D20] text-white font-semibold inline-flex items-center justify-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" /> {at(adminLang, 'create')}
        </button>
      </form>

      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 border-b border-slate-100">
                <th className="py-3 px-4 font-semibold">Code</th>
                <th className="py-3 px-3 font-semibold">Title</th>
                <th className="py-3 px-3 font-semibold text-right">Reward</th>
                <th className="py-3 px-3 font-semibold text-right">Used / Max</th>
                <th className="py-3 px-3 font-semibold">{at(adminLang, 'status')}</th>
                <th className="py-3 px-4 font-semibold text-right">{at(adminLang, 'actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.giftCodes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400">
                    {at(adminLang, 'no_records')}
                  </td>
                </tr>
              ) : (
                data.giftCodes.map((g) => (
                  <tr key={g.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono-num font-bold text-slate-900">{g.code}</td>
                    <td className="py-3 px-3">{g.title}</td>
                    <td className="py-3 px-3 text-right font-mono-num font-bold text-emerald-700">
                      {formatCurrency(g.rewardAmount, 'USD', adminLang)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono-num">
                      {g.redeemedCount} / {g.maxRedemptions}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`px-2 py-0.5 rounded-md font-semibold text-[11px] ${
                          g.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {g.isActive ? at(adminLang, 'active') : at(adminLang, 'disabled')}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleToggle(g.id, !g.isActive)}
                        className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 font-semibold"
                      >
                        {g.isActive ? 'Pause' : 'Enable'}
                      </button>
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
// MODULE 17: PROMOTIONS CAMPAIGNS
// =========================================================================
export function AdminPromotionsModule({
  adminLang,
  onNotify,
}: {
  adminLang: AdminLang;
  onNotify: (msg: string, isError?: boolean) => void;
}) {
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState({
    title: '',
    description: '',
    bonusType: 'deposit_match' as 'deposit_match' | 'cashback' | 'referral_boost' | 'event',
    bonusPercent: 3,
    minQualifyingAmount: 100,
  });

  const load = useCallback(async () => {
    const res = await apiFetch('/api/admin/campaigns');
    setItems(res.items || []);
  }, []);

  useEffect(() => {
    load().catch((e) => onNotify(e?.message || 'Unable to load promotions', true));
  }, [load, onNotify]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          bonusPercent: Number(form.bonusPercent),
          minQualifyingAmount: Number(form.minQualifyingAmount),
          active: true,
        }),
      });
      onNotify('Promotion campaign created.');
      setForm({ title: '', description: '', bonusType: 'deposit_match', bonusPercent: 3, minQualifyingAmount: 100 });
      await load();
    } catch (err: any) {
      onNotify(err?.message || 'Failed to create campaign', true);
    }
  };

  const handleToggle = async (id: string, active: boolean) => {
    await apiFetch(`/api/admin/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) });
    await load();
  };

  const handleDelete = async (id: string) => {
    await apiFetch(`/api/admin/campaigns/${id}`, { method: 'DELETE' });
    await load();
  };

  return (
    <div className="space-y-5">
      <form
        onSubmit={handleCreate}
        className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs space-y-3 text-xs"
      >
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <input
            type="text"
            required
            placeholder="Campaign Title *"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="h-9 px-3 rounded-lg bg-slate-50 border border-slate-200 sm:col-span-2"
          />
          <select
            value={form.bonusType}
            onChange={(e) => setForm({ ...form, bonusType: e.target.value as any })}
            className="h-9 px-3 rounded-lg bg-slate-50 border border-slate-200"
          >
            <option value="deposit_match">Deposit Match</option>
            <option value="cashback">Cashback</option>
            <option value="referral_boost">Referral Boost</option>
            <option value="event">Special Event</option>
          </select>
          <input
            type="number"
            min="0"
            max="100"
            placeholder="Bonus %"
            value={form.bonusPercent}
            onChange={(e) => setForm({ ...form, bonusPercent: Number(e.target.value) })}
            className="h-9 px-3 rounded-lg bg-slate-50 border border-slate-200"
          />
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            required
            placeholder="Description *"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="flex-1 h-9 px-3 rounded-lg bg-slate-50 border border-slate-200"
          />
          <button
            type="submit"
            className="h-9 px-4 rounded-lg bg-[#D92D20] text-white font-semibold inline-flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> {at(adminLang, 'create')}
          </button>
        </div>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {items.length === 0 ? (
          <div className="md:col-span-2 bg-white rounded-2xl p-10 text-center text-xs text-slate-400 border border-slate-200/80">
            {at(adminLang, 'no_records')}
          </div>
        ) : (
          items.map((c) => (
            <div key={c.id} className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-bold text-slate-900">{c.title}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{c.description}</div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${
                    c.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {c.active ? at(adminLang, 'active') : at(adminLang, 'disabled')}
                </span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                <span className="font-mono-num text-slate-600">
                  {c.bonusType} · {c.bonusPercent}%
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleToggle(c.id, !c.active)}
                    className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 font-semibold"
                  >
                    {c.active ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(c.id)}
                    className="p-1.5 rounded-lg text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
