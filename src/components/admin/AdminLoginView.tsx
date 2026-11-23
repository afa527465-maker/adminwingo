import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  User as UserIcon,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  Zap,
  Layers,
  LogIn,
  ChevronLeft,
  Terminal,
} from 'lucide-react';
import { apiFetch, type UserProfile, type WalletData } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { WinGoLogo } from '../WinGoBrand';
import { at, type AdminLang } from './adminI18n';

export function AdminLoginView({
  adminLang,
  onChangeAdminLang,
  onExitAdmin,
  onAuthenticated,
}: {
  adminLang: AdminLang;
  onChangeAdminLang: (lang: AdminLang) => void;
  onExitAdmin?: () => void;
  onAuthenticated: () => void;
}) {
  const { setAuthenticatedSession } = useAuth();
  const [requiresClaim, setRequiresClaim] = useState(false);
  const [hasEnvPasscode, setHasEnvPasscode] = useState(false);
  const [checking, setChecking] = useState(true);

  const [identifier, setIdentifier] = useState('Afa');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passcode, setPasscode] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ requiresClaim: boolean; hasEnvPasscode: boolean }>('/api/auth/admin-bootstrap-status')
      .then((res) => {
        setRequiresClaim(Boolean(res.requiresClaim));
        setHasEnvPasscode(Boolean(res.hasEnvPasscode));
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch<{ token: string; user: UserProfile; wallet: WalletData }>(
        '/api/auth/admin-login',
        {
          method: 'POST',
          body: JSON.stringify({ identifier: identifier.trim(), password, rememberMe }),
        }
      );
      setAuthenticatedSession(res.token, res.user, res.wallet);
      onAuthenticated();
    } catch (err: any) {
      setError(err?.message || 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch<{ token: string; user: UserProfile; wallet: WalletData }>(
        '/api/auth/admin-bootstrap',
        {
          method: 'POST',
          body: JSON.stringify({
            username: 'Afa',
            email: email.trim() || undefined,
            password,
            confirmPassword,
            passcode: hasEnvPasscode ? passcode : undefined,
          }),
        }
      );
      setAuthenticatedSession(res.token, res.user, res.wallet);
      onAuthenticated();
    } catch (err: any) {
      setError(err?.message || 'Super Admin setup failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-[#D92D20] via-[#F04428] to-[#FF7A45]">
      {/* Top Bar matching reference Admin Login screenshot */}
      <header className="h-16 px-4 sm:px-8 flex items-center justify-between border-b border-white/15 bg-black/10 backdrop-blur-xs">
        <div className="flex items-center gap-3">
          <WinGoLogo variant="light" size="md" />
          <span className="text-white/90 text-xs font-semibold tracking-wide uppercase hidden sm:inline">
            Admin
          </span>
        </div>

        <div className="flex items-center gap-3">
          {onExitAdmin && (
            <button
              type="button"
              onClick={onExitAdmin}
              className="h-9 px-3 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>{at(adminLang, 'back_to_game')}</span>
            </button>
          )}
          <div className="inline-flex items-center rounded-lg border border-white/30 bg-black/15 p-1 text-xs font-semibold">
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
                onClick={() => onChangeAdminLang(opt.code)}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  adminLang === opt.code ? 'bg-white text-[#D92D20]' : 'text-white/90 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Main Split Content */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="max-w-5xl w-full grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left Branding Panel */}
          <div className="lg:col-span-6 text-white space-y-6 hidden lg:block">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-white/15 text-xs font-semibold">
                <ShieldCheck className="w-4 h-4" />
                <span>{at(adminLang, 'brand')}</span>
              </div>
              <h1 className="text-4xl font-display font-extrabold tracking-tight leading-tight">
                {at(adminLang, 'brand')}
              </h1>
              <p className="text-base text-white/90">{at(adminLang, 'subtitle')}</p>
            </div>

            <div className="grid grid-cols-3 gap-3 pt-4">
              <div className="rounded-2xl bg-white/12 backdrop-blur-xs border border-white/15 p-4 space-y-2">
                <ShieldCheck className="w-5 h-5 text-amber-200" />
                <div className="text-xs font-bold leading-snug">{at(adminLang, 'feat_secure')}</div>
              </div>
              <div className="rounded-2xl bg-white/12 backdrop-blur-xs border border-white/15 p-4 space-y-2">
                <Zap className="w-5 h-5 text-amber-200" />
                <div className="text-xs font-bold leading-snug">{at(adminLang, 'feat_perf')}</div>
              </div>
              <div className="rounded-2xl bg-white/12 backdrop-blur-xs border border-white/15 p-4 space-y-2">
                <Layers className="w-5 h-5 text-amber-200" />
                <div className="text-xs font-bold leading-snug">{at(adminLang, 'feat_full')}</div>
              </div>
            </div>
          </div>

          {/* Right White Auth Card */}
          <div className="lg:col-span-6">
            <div className="bg-white rounded-3xl shadow-2xl p-6 sm:p-8 space-y-5">
              <div className="text-center space-y-1.5">
                <div className="w-12 h-12 rounded-2xl bg-orange-50 text-[#F04428] flex items-center justify-center mx-auto">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <h2 className="text-xl font-display font-extrabold text-slate-900">
                  {requiresClaim ? at(adminLang, 'setup_title') : at(adminLang, 'login_title')}
                </h2>
                <p className="text-xs text-slate-500">
                  {requiresClaim ? at(adminLang, 'setup_sub') : at(adminLang, 'login_sub')}
                </p>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {checking ? (
                <div className="py-8 text-center text-xs text-slate-400">...</div>
              ) : requiresClaim ? (
                <form onSubmit={handleBootstrap} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {at(adminLang, 'username')}
                    </label>
                    <div className="relative">
                      <UserIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                      <input
                        type="text"
                        value="Afa"
                        readOnly
                        className="w-full h-11 pl-10 pr-3 rounded-xl bg-slate-100 border border-slate-200 text-sm font-bold text-slate-900"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {at(adminLang, 'optional_email')}
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="admin@domain.com"
                      className="w-full h-11 px-3.5 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:border-[#F04428]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {at(adminLang, 'new_password')}
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                      <input
                        type={showPass ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        minLength={10}
                        placeholder={at(adminLang, 'password_placeholder')}
                        className="w-full h-11 pl-10 pr-10 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:border-[#F04428]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass(!showPass)}
                        className="absolute right-2.5 top-2.5 p-1 text-slate-400 hover:text-slate-600"
                      >
                        {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {at(adminLang, 'confirm_password')}
                    </label>
                    <input
                      type={showPass ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      minLength={10}
                      className="w-full h-11 px-3.5 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:border-[#F04428]"
                    />
                  </div>

                  {hasEnvPasscode && (
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Bootstrap Passcode
                      </label>
                      <input
                        type="password"
                        value={passcode}
                        onChange={(e) => setPasscode(e.target.value)}
                        required
                        className="w-full h-11 px-3.5 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:border-[#F04428]"
                      />
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full h-11 rounded-xl bg-gradient-to-r from-[#D92D20] to-[#F97316] text-white font-bold text-sm shadow-sm hover:opacity-95 disabled:opacity-50"
                  >
                    {busy ? at(adminLang, 'signing_in') : at(adminLang, 'complete_setup')}
                  </button>

                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 flex items-center gap-2 font-mono">
                    <Terminal className="w-4 h-4 text-slate-500 shrink-0" />
                    <span>{at(adminLang, 'cli_tip')}</span>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleLogin} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      * {at(adminLang, 'username_or_email')}
                    </label>
                    <div className="relative">
                      <UserIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                      <input
                        type="text"
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        required
                        placeholder={at(adminLang, 'username_placeholder')}
                        className="w-full h-11 pl-10 pr-3 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-[#F04428] focus:bg-white"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      * {at(adminLang, 'password')}
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                      <input
                        type={showPass ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        placeholder={at(adminLang, 'password_placeholder')}
                        className="w-full h-11 pl-10 pr-10 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-[#F04428] focus:bg-white"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass(!showPass)}
                        className="absolute right-2.5 top-2.5 p-1 text-slate-400 hover:text-slate-600"
                      >
                        {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <label className="inline-flex items-center gap-2 text-slate-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="w-4 h-4 rounded accent-[#F04428]"
                      />
                      <span>{at(adminLang, 'remember_me')}</span>
                    </label>
                  </div>

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full h-11 rounded-xl bg-gradient-to-r from-[#D92D20] to-[#F97316] text-white font-bold text-sm shadow-sm hover:opacity-95 inline-flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <LogIn className="w-4 h-4" />
                    <span>{busy ? at(adminLang, 'signing_in') : at(adminLang, 'sign_in')}</span>
                  </button>
                </form>
              )}

              <div className="rounded-xl bg-amber-50 border border-amber-200/80 p-3 text-[11px] text-amber-900 leading-relaxed">
                <strong>{at(adminLang, 'security_notice_title')}</strong>{' '}
                {at(adminLang, 'security_notice_body')}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
