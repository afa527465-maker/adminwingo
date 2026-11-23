import React, { useState, useCallback } from 'react';
import {
  LayoutDashboard,
  Users,
  Shield,
  Gamepad2,
  Clock,
  BarChart3,
  ListChecks,
  History,
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  ReceiptText,
  UserCheck,
  Share2,
  Percent,
  Gift,
  Megaphone,
  Headphones,
  Bell,
  FileBarChart2,
  Settings,
  Lock,
  FileSearch,
  Menu,
  X,
  LogOut,
  KeyRound,
  ChevronLeft,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';
import { WinGoLogo } from './WinGoBrand';
import { at, resolveAdminLang, type AdminKey, type AdminLang } from './admin/adminI18n';
import { AdminLoginView } from './admin/AdminLoginView';
import {
  AdminDashboardModule,
  AdminPlayersModule,
  AdminStaffModule,
} from './admin/AdminUsersModules';
import {
  AdminGamesModule,
  AdminRoundsModule,
  AdminResultsModule,
  AdminBetsModule,
} from './admin/AdminGameModules';
import {
  AdminWalletsModule,
  AdminDepositsModule,
  AdminWithdrawalsModule,
  AdminLedgerModule,
} from './admin/AdminFinanceModules';
import {
  AdminAgentsModule,
  AdminReferralsModule,
  AdminCommissionsModule,
  AdminGiftCodesModule,
  AdminPromotionsModule,
} from './admin/AdminGrowthModules';
import {
  AdminSupportModule,
  AdminAnnouncementsModule,
  AdminReportsModule,
  AdminPlatformSettingsModule,
  AdminSecurityModule,
  AdminAuditLogsModule,
} from './admin/AdminSystemModules';

type AdminModuleId =
  | 'dashboard'
  | 'players'
  | 'admins'
  | 'games'
  | 'rounds'
  | 'results'
  | 'bet_orders'
  | 'bet_history'
  | 'wallets'
  | 'deposits'
  | 'withdrawals'
  | 'transactions'
  | 'agents'
  | 'referrals'
  | 'commissions'
  | 'gift_codes'
  | 'promotions'
  | 'support'
  | 'announcements'
  | 'reports'
  | 'settings'
  | 'security'
  | 'audit';

interface NavGroup {
  groupKey: AdminKey;
  items: { id: AdminModuleId; labelKey: AdminKey; icon: React.ComponentType<any> }[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    groupKey: 'grp_overview',
    items: [{ id: 'dashboard', labelKey: 'm_dashboard', icon: LayoutDashboard }],
  },
  {
    groupKey: 'grp_accounts',
    items: [
      { id: 'players', labelKey: 'm_players', icon: Users },
      { id: 'admins', labelKey: 'm_admins', icon: Shield },
    ],
  },
  {
    groupKey: 'grp_gaming',
    items: [
      { id: 'games', labelKey: 'm_games', icon: Gamepad2 },
      { id: 'rounds', labelKey: 'm_rounds', icon: Clock },
      { id: 'results', labelKey: 'm_results', icon: BarChart3 },
      { id: 'bet_orders', labelKey: 'm_bet_orders', icon: ListChecks },
      { id: 'bet_history', labelKey: 'm_bet_history', icon: History },
    ],
  },
  {
    groupKey: 'grp_finance',
    items: [
      { id: 'wallets', labelKey: 'm_wallets', icon: Wallet },
      { id: 'deposits', labelKey: 'm_deposits', icon: ArrowDownLeft },
      { id: 'withdrawals', labelKey: 'm_withdrawals', icon: ArrowUpRight },
      { id: 'transactions', labelKey: 'm_transactions', icon: ReceiptText },
    ],
  },
  {
    groupKey: 'grp_growth',
    items: [
      { id: 'agents', labelKey: 'm_agents', icon: UserCheck },
      { id: 'referrals', labelKey: 'm_referrals', icon: Share2 },
      { id: 'commissions', labelKey: 'm_commissions', icon: Percent },
      { id: 'gift_codes', labelKey: 'm_gift_codes', icon: Gift },
      { id: 'promotions', labelKey: 'm_promotions', icon: Megaphone },
    ],
  },
  {
    groupKey: 'grp_system',
    items: [
      { id: 'support', labelKey: 'm_support', icon: Headphones },
      { id: 'announcements', labelKey: 'm_announcements', icon: Bell },
      { id: 'reports', labelKey: 'm_reports', icon: FileBarChart2 },
      { id: 'settings', labelKey: 'm_settings', icon: Settings },
      { id: 'security', labelKey: 'm_security', icon: Lock },
      { id: 'audit', labelKey: 'm_audit', icon: FileSearch },
    ],
  },
];

export function AdminPanel({ onExitAdmin }: { onExitAdmin?: () => void }) {
  const { user, language, setLanguage, logout } = useAuth();
  const [adminLang, setAdminLang] = useState<AdminLang>(() => resolveAdminLang(language));
  const [activeTab, setActiveTab] = useState<AdminModuleId>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; isError?: boolean } | null>(null);

  // Change Password modal
  const [showPassModal, setShowPassModal] = useState(false);
  const [curPass, setCurPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');

  const handleAdminLangChange = (next: AdminLang) => {
    setAdminLang(next);
    setLanguage(next);
  };

  const notify = useCallback((msg: string, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => {
      setToast((prev) => (prev?.msg === msg ? null : prev));
    }, 4500);
  }, []);

  const isAdminUser = Boolean(
    user && ['super_admin', 'admin', 'finance', 'support'].includes(user.role)
  );

  if (!isAdminUser) {
    return (
      <AdminLoginView
        adminLang={adminLang}
        onChangeAdminLang={handleAdminLangChange}
        onExitAdmin={onExitAdmin}
        onAuthenticated={() => setActiveTab('dashboard')}
      />
    );
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: curPass,
          newPassword: newPass,
          confirmPassword: confirmPass,
        }),
      });
      notify('Administrator password updated securely.');
      setShowPassModal(false);
      setCurPass('');
      setNewPass('');
      setConfirmPass('');
    } catch (err: any) {
      notify(err?.message || 'Unable to change password', true);
    }
  };

  const activeItem =
    NAV_GROUPS.flatMap((g) => g.items).find((i) => i.id === activeTab) || NAV_GROUPS[0].items[0];
  const ActiveIcon = activeItem.icon;

  return (
    <div className="min-h-screen flex flex-col bg-[#F4F6FA] text-slate-900">
      {/* Top Red-Orange Header matching reference Admin Panel screenshots */}
      <header className="sticky top-0 z-40 h-14 bg-gradient-to-r from-[#D92D20] via-[#E63E22] to-[#F97316] text-white shadow-sm flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden p-1.5 rounded-lg hover:bg-white/15"
            aria-label="Toggle sidebar"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2">
            <WinGoLogo variant="light" size="sm" />
            <span className="font-display font-bold text-sm tracking-tight hidden sm:inline">
              Admin
            </span>
          </div>
          {onExitAdmin && (
            <button
              type="button"
              onClick={onExitAdmin}
              className="ml-2 h-8 px-2.5 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-semibold inline-flex items-center gap-1"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span className="hidden md:inline">{at(adminLang, 'back_to_game')}</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          {/* EN | 中文 | ខ្មែរ Switcher */}
          <div className="inline-flex items-center rounded-lg border border-white/30 bg-black/15 p-0.5 text-xs font-semibold">
            {(
              [
                { code: 'en', label: 'EN' },
                { code: 'zh-CN', label: '中文' },
                { code: 'km', label: 'ខ្មែរ' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.code}
                type="button"
                onClick={() => handleAdminLangChange(opt.code)}
                className={`px-2 py-1 rounded-md transition-colors ${
                  adminLang === opt.code ? 'bg-white text-[#D92D20]' : 'text-white/90 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowPassModal(true)}
            title={at(adminLang, 'change_password')}
            className="h-8 px-2.5 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-semibold inline-flex items-center gap-1"
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{at(adminLang, 'change_password')}</span>
          </button>

          <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-white/20">
            <div className="text-right leading-tight">
              <div className="text-xs font-bold">{user!.username || user!.displayName}</div>
              <div className="text-[10px] text-white/80 uppercase">{user!.role}</div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => logout()}
            title={at(adminLang, 'sign_out')}
            className="h-8 px-2.5 rounded-lg bg-slate-900/40 hover:bg-slate-900/60 text-white text-xs font-semibold inline-flex items-center gap-1"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{at(adminLang, 'sign_out')}</span>
          </button>
        </div>
      </header>

      <div className="flex-1 flex relative">
        {/* Dark Slate #121826 Sidebar matching Screenshots #2–#4 */}
        <aside
          className={`fixed lg:static inset-y-14 lg:inset-y-0 left-0 z-30 w-64 bg-[#121826] text-slate-300 flex flex-col border-r border-slate-800 transition-transform duration-200 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
          }`}
        >
          <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
            {NAV_GROUPS.map((group) => (
              <div key={group.groupKey} className="space-y-1">
                <div className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  {at(adminLang, group.groupKey)}
                </div>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveTab(item.id);
                        setSidebarOpen(false);
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${
                        isActive
                          ? 'bg-gradient-to-r from-[#D92D20] to-[#F97316] text-white shadow-sm'
                          : 'text-slate-300 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{at(adminLang, item.labelKey)}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

        {/* Mobile Sidebar Backdrop */}
        {sidebarOpen && (
          <div
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 z-20 bg-slate-950/50 lg:hidden"
          />
        )}

        {/* Main Workspace */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 space-y-5">
          {/* Page Header + Breadcrumb */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-rose-100 text-[#D92D20] flex items-center justify-center">
                <ActiveIcon className="w-5 h-5" />
              </div>
              <h1 className="text-lg sm:text-xl font-display font-extrabold text-slate-900">
                {at(adminLang, activeItem.labelKey)}
              </h1>
            </div>
            <div className="text-xs text-slate-400">
              {at(adminLang, 'brand')} /{' '}
              <span className="text-[#D92D20] font-semibold">{at(adminLang, activeItem.labelKey)}</span>
            </div>
          </div>

          {/* Toast */}
          {toast && (
            <div
              className={`p-3 rounded-xl text-xs font-semibold flex items-center justify-between gap-2 border ${
                toast.isError
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-800'
              }`}
            >
              <div className="flex items-center gap-2">
                {toast.isError ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                <span>{toast.msg}</span>
              </div>
              <button type="button" onClick={() => setToast(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Render Active Module (1–23) */}
          {activeTab === 'dashboard' && (
            <AdminDashboardModule adminLang={adminLang} onNavigate={(t) => setActiveTab(t as AdminModuleId)} />
          )}
          {activeTab === 'players' && <AdminPlayersModule adminLang={adminLang} onNotify={notify} />}
          {activeTab === 'admins' && (
            <AdminStaffModule adminLang={adminLang} currentUserRole={user!.role} onNotify={notify} />
          )}
          {activeTab === 'games' && (
            <AdminGamesModule adminLang={adminLang} currentUserRole={user!.role} onNotify={notify} />
          )}
          {activeTab === 'rounds' && <AdminRoundsModule adminLang={adminLang} onNotify={notify} />}
          {activeTab === 'results' && <AdminResultsModule adminLang={adminLang} onNotify={notify} />}
          {activeTab === 'bet_orders' && (
            <AdminBetsModule adminLang={adminLang} scope="orders" onNotify={notify} />
          )}
          {activeTab === 'bet_history' && (
            <AdminBetsModule adminLang={adminLang} scope="history" onNotify={notify} />
          )}
          {activeTab === 'wallets' && (
            <AdminWalletsModule adminLang={adminLang} currentUserRole={user!.role} onNotify={notify} />
          )}
          {activeTab === 'deposits' && (
            <AdminDepositsModule adminLang={adminLang} currentUserRole={user!.role} onNotify={notify} />
          )}
          {activeTab === 'withdrawals' && (
            <AdminWithdrawalsModule adminLang={adminLang} currentUserRole={user!.role} onNotify={notify} />
          )}
          {activeTab === 'transactions' && <AdminLedgerModule adminLang={adminLang} onNotify={notify} />}
          {activeTab === 'agents' && <AdminAgentsModule adminLang={adminLang} onNotify={notify} />}
          {activeTab === 'referrals' && <AdminReferralsModule adminLang={adminLang} onNotify={notify} />}
          {activeTab === 'commissions' && <AdminCommissionsModule adminLang={adminLang} onNotify={notify} />}
          {activeTab === 'gift_codes' && <AdminGiftCodesModule adminLang={adminLang} onNotify={notify} />}
          {activeTab === 'promotions' && <AdminPromotionsModule adminLang={adminLang} onNotify={notify} />}
          {activeTab === 'support' && <AdminSupportModule adminLang={adminLang} onNotify={notify} />}
          {activeTab === 'announcements' && <AdminAnnouncementsModule adminLang={adminLang} onNotify={notify} />}
          {activeTab === 'reports' && <AdminReportsModule adminLang={adminLang} onNotify={notify} />}
          {activeTab === 'settings' && <AdminPlatformSettingsModule adminLang={adminLang} onNotify={notify} />}
          {activeTab === 'security' && (
            <AdminSecurityModule adminLang={adminLang} currentUserRole={user!.role} onNotify={notify} />
          )}
          {activeTab === 'audit' && <AdminAuditLogsModule adminLang={adminLang} onNotify={notify} />}
        </main>
      </div>

      {/* Change Password Modal */}
      {showPassModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <form onSubmit={handleChangePassword} className="bg-white rounded-2xl max-w-sm w-full p-5 space-y-3 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">{at(adminLang, 'change_password')}</h3>
              <button type="button" onClick={() => setShowPassModal(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="password"
              required
              placeholder={at(adminLang, 'current_password')}
              value={curPass}
              onChange={(e) => setCurPass(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-slate-50 border border-slate-200 text-xs"
            />
            <input
              type="password"
              required
              minLength={10}
              placeholder={at(adminLang, 'new_password')}
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-slate-50 border border-slate-200 text-xs"
            />
            <input
              type="password"
              required
              minLength={10}
              placeholder={at(adminLang, 'confirm_password')}
              value={confirmPass}
              onChange={(e) => setConfirmPass(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-slate-50 border border-slate-200 text-xs"
            />
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowPassModal(false)}
                className="h-9 px-3 rounded-lg border border-slate-200 text-xs"
              >
                {at(adminLang, 'cancel')}
              </button>
              <button
                type="submit"
                className="h-9 px-4 rounded-lg bg-[#D92D20] text-white text-xs font-semibold"
              >
                {at(adminLang, 'update_password')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
