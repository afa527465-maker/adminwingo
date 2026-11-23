import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { eq, or, and, ne, desc, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { users, sessions, platformSettings } from '../../db/schema.ts';
import {
  createRateLimiter,
  generateInviteCode,
  generateSessionToken,
  generateVerificationCode,
  hashPassword,
  hashToken,
  verifyPassword,
} from '../crypto.ts';
import { ensureWallet, recordAuditLog } from '../ledger.ts';
import {
  ADMIN_ROLES,
  requireAuth,
  sanitizeUserProfile,
  type AuthenticatedRequest,
} from '../auth.ts';

export const authRouter = Router();

const authLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 40, label: 'auth' });
const recoveryLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10, label: 'recovery' });

export function getVerificationProviderStatus() {
  const emailConfigured = Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim());
  const smsConfigured = Boolean(process.env.SMS_PROVIDER_URL?.trim() && process.env.SMS_PROVIDER_API_KEY?.trim());
  return { emailConfigured, smsConfigured };
}

export type RegistrationApprovalMode = 'manual_admin_approval' | 'verified_sms_registration';

export async function getRegistrationPolicy(): Promise<{ mode: RegistrationApprovalMode }> {
  try {
    const [row] = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, 'registration_policy'))
      .limit(1);
    const val = row?.valueJson as { mode?: string } | undefined;
    if (val?.mode === 'verified_sms_registration') {
      return { mode: 'verified_sms_registration' };
    }
  } catch {
    // Fallback to default manual admin approval if settings lookup fails
  }
  return { mode: 'manual_admin_approval' };
}

const registerSchema = z.object({
  method: z.enum(['phone', 'email']),
  countryCode: z.string().min(1).max(6).default('+91'),
  phone: z.string().trim().min(6).max(20).optional(),
  email: z.string().trim().email().max(120).optional(),
  username: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_.-]+$/).optional(),
  displayName: z.string().trim().min(2).max(50).optional(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  confirmPassword: z.string().min(8).max(128),
  inviteCode: z.string().trim().max(32).optional().or(z.literal('')),
  acceptedTerms: z.literal(true, { message: 'You must accept the Privacy Policy and Terms.' }),
  ageConfirmed: z.literal(true, { message: 'You must confirm you meet legal age requirements.' }),
  jurisdictionCode: z.string().trim().min(2).max(12).default('IN'),
});

const loginSchema = z.object({
  method: z.enum(['phone', 'email']),
  countryCode: z.string().min(1).max(6).default('+91'),
  phone: z.string().trim().optional(),
  email: z.string().trim().email().optional(),
  password: z.string().min(1),
  rememberMe: z.boolean().optional().default(false),
});

const adminLoginSchema = z.object({
  identifier: z.string().trim().min(2, 'Username or email is required').max(120),
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean().optional().default(false),
});

const verifySchema = z.object({
  identifier: z.string().trim().min(3),
  code: z.string().trim().length(6),
});

const forgotSchema = z.object({
  identifier: z.string().trim().min(3),
});

const resetSchema = z.object({
  identifier: z.string().trim().min(3),
  code: z.string().trim().length(6),
  newPassword: z.string().min(8).max(128),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required.'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters.').max(128),
  confirmPassword: z.string().min(8).max(128).optional(),
});

const BLOCKED_JURISDICTIONS = new Set(['KP', 'IR', 'SY']);

async function createSessionForUser(userId: number, req: any, rememberMe = false) {
  const token = generateSessionToken();
  const tokenHash = hashToken(token);
  const ttlMs = rememberMe ? 14 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);
  const ipAddress =
    (typeof req.headers['x-forwarded-for'] === 'string'
      ? req.headers['x-forwarded-for'].split(',')[0].trim()
      : req.ip) || 'unknown';

  await db.insert(sessions).values({
    userId,
    tokenHash,
    ipAddress,
    userAgent: String(req.headers['user-agent'] || '').slice(0, 240),
    expiresAt,
  });

  return { token, tokenHash, expiresAt: expiresAt.toISOString() };
}

authRouter.get('/providers-status', (_req, res) => {
  return res.json(getVerificationProviderStatus());
});

authRouter.post('/register', authLimiter, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid registration data.' });
  }

  const data = parsed.data;
  if (data.password !== data.confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match.' });
  }
  if (!/[A-Za-z]/.test(data.password) || !/[0-9]/.test(data.password)) {
    return res.status(400).json({ error: 'Password must include both letters and numbers.' });
  }
  if (BLOCKED_JURISDICTIONS.has(data.jurisdictionCode.toUpperCase())) {
    return res.status(403).json({ error: 'Registration is not permitted from the selected jurisdiction.' });
  }

  const normalizedEmail = data.method === 'email' ? data.email?.toLowerCase().trim() : undefined;
  const normalizedPhone = data.method === 'phone' ? data.phone?.replace(/[^\d]/g, '') : undefined;
  const normalizedUsername = data.username?.trim() || undefined;

  if (data.method === 'email' && !normalizedEmail) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }
  if (data.method === 'phone' && (!normalizedPhone || normalizedPhone.length < 6)) {
    return res.status(400).json({ error: 'A valid phone number is required.' });
  }
  if (normalizedUsername && normalizedUsername.toLowerCase() === 'afa') {
    return res.status(403).json({ error: 'This username is reserved.' });
  }

  try {
    // Prevent duplicate accounts
    const dupConditions = [];
    if (normalizedEmail) dupConditions.push(eq(users.email, normalizedEmail));
    if (normalizedPhone) dupConditions.push(eq(users.phone, `${data.countryCode}${normalizedPhone}`));
    if (normalizedUsername) {
      dupConditions.push(sql`LOWER(${users.username}) = LOWER(${normalizedUsername})`);
    }

    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(dupConditions.length > 1 ? or(...dupConditions) : dupConditions[0])
      .limit(1);

    if (existing.length > 0) {
      return res.status(409).json({ error: 'An account with this phone number, email, or username already exists.' });
    }

    // Validate optional referral invite code
    let referredById: number | null = null;
    if (data.inviteCode) {
      const [referrer] = await db
        .select({ id: users.id, status: users.status })
        .from(users)
        .where(eq(users.inviteCode, data.inviteCode.toUpperCase()))
        .limit(1);
      if (!referrer || referrer.status === 'suspended') {
        return res.status(400).json({ error: 'Invalid or inactive invitation code.' });
      }
      referredById = referrer.id;
    }

    const fullPhone = normalizedPhone ? `${data.countryCode}${normalizedPhone}` : null;
    const providers = getVerificationProviderStatus();
    const providerConfigured = data.method === 'email' ? providers.emailConfigured : providers.smsConfigured;
    const policy = await getRegistrationPolicy();
    const useSmsOrEmailVerification =
      policy.mode === 'verified_sms_registration' && providerConfigured;

    const verificationCode = useSmsOrEmailVerification ? generateVerificationCode() : null;
    const displayName =
      data.displayName ||
      normalizedUsername ||
      (normalizedEmail ? normalizedEmail.split('@')[0] : `Player${normalizedPhone?.slice(-4)}`);

    const [created] = await db
      .insert(users)
      .values({
        uid: `local_${crypto.randomUUID()}`,
        username: normalizedUsername ?? null,
        countryCode: data.countryCode,
        phone: fullPhone,
        email: normalizedEmail ?? null,
        displayName,
        passwordHash: hashPassword(data.password),
        role: 'player',
        status: useSmsOrEmailVerification ? 'pending_verification' : 'pending_approval',
        isVerified: false,
        verificationCode: verificationCode ? hashToken(verificationCode) : null,
        ageConfirmed: true,
        jurisdictionCode: data.jurisdictionCode.toUpperCase(),
        inviteCode: generateInviteCode(),
        referredById,
      })
      .returning();

    await ensureWallet(created.id);

    await recordAuditLog({
      actorUserId: created.id,
      actorEmail: created.email || created.phone || created.username,
      action: 'player.register',
      entityType: 'user',
      entityId: String(created.id),
      details: {
        method: data.method,
        referredById,
        jurisdiction: created.jurisdictionCode,
        approvalMode: useSmsOrEmailVerification ? 'verified_sms_registration' : 'manual_admin_approval',
      },
      ipAddress: req.ip,
    });

    if (useSmsOrEmailVerification) {
      return res.status(201).json({
        message:
          'Account created. Please complete verification with the 6-digit code sent by the configured verification provider.',
        requiresVerification: true,
        requiresApproval: false,
        approvalMode: 'verified_sms_registration',
        verificationProviderConfigured: true,
        identifier: normalizedEmail || fullPhone,
        user: sanitizeUserProfile(created),
      });
    }

    return res.status(201).json({
      message: 'Registration Successful! Your account is waiting for administrator approval.',
      requiresVerification: false,
      requiresApproval: true,
      approvalMode: 'manual_admin_approval',
      verificationProviderConfigured: providerConfigured,
      identifier: normalizedEmail || fullPhone,
      user: sanitizeUserProfile(created),
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Unable to complete registration right now.' });
  }
});

authRouter.post('/verify', authLimiter, async (req, res) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Valid identifier and 6-digit verification code are required.' });
  }

  const { identifier, code } = parsed.data;
  const cleanId = identifier.trim();

  try {
    const [user] = await db
      .select()
      .from(users)
      .where(or(eq(users.email, cleanId.toLowerCase()), eq(users.phone, cleanId)))
      .limit(1);

    if (!user) {
      return res.status(404).json({ error: 'Account not found.' });
    }
    if (user.isVerified) {
      return res.status(400).json({ error: 'Account is already verified. Please sign in.' });
    }
    if (!user.verificationCode || user.verificationCode !== hashToken(code)) {
      return res.status(400).json({ error: 'Invalid verification code.' });
    }

    const [updated] = await db
      .update(users)
      .set({
        isVerified: true,
        status: 'active',
        verificationCode: null,
        lastLoginAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();

    const wallet = await ensureWallet(updated.id);
    const session = await createSessionForUser(updated.id, req, false);

    await recordAuditLog({
      actorUserId: updated.id,
      actorEmail: updated.email || updated.phone,
      action: 'player.verify',
      entityType: 'user',
      entityId: String(updated.id),
      ipAddress: req.ip,
    });

    return res.json({
      message: 'Account verified successfully.',
      token: session.token,
      expiresAt: session.expiresAt,
      user: sanitizeUserProfile(updated),
      wallet,
    });
  } catch (error) {
    console.error('Verify error:', error);
    return res.status(500).json({ error: 'Verification failed.' });
  }
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Please provide valid login credentials.' });
  }

  const data = parsed.data;
  const lookup =
    data.method === 'email'
      ? data.email?.toLowerCase().trim()
      : `${data.countryCode}${(data.phone || '').replace(/[^\d]/g, '')}`;

  if (!lookup) {
    return res.status(400).json({ error: 'Phone number or email is required.' });
  }

  try {
    const [user] = await db
      .select()
      .from(users)
      .where(data.method === 'email' ? eq(users.email, lookup) : eq(users.phone, lookup))
      .limit(1);

    if (!user || !verifyPassword(data.password, user.passwordHash)) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'Your account has been suspended. Please contact WinGo Customer Service.' });
    }
    if (user.status === 'rejected') {
      return res.status(403).json({ error: 'Your registration was not approved. Please contact WinGo Customer Service.' });
    }
    if (user.status === 'pending_approval') {
      return res.status(403).json({
        error: 'Waiting for Administrator Approval',
        requiresApproval: true,
        requiresVerification: false,
        status: user.status,
        identifier: lookup,
      });
    }
    if (user.status !== 'active' && !user.isVerified) {
      const providers = getVerificationProviderStatus();
      const providerConfigured = data.method === 'email' ? providers.emailConfigured : providers.smsConfigured;
      const policy = await getRegistrationPolicy();
      if (policy.mode === 'manual_admin_approval' || !providerConfigured) {
        return res.status(403).json({
          error: 'Waiting for Administrator Approval',
          requiresApproval: true,
          requiresVerification: false,
          status: user.status,
          identifier: lookup,
        });
      }
      return res.status(403).json({
        error: 'Account verification required before signing in.',
        requiresVerification: true,
        requiresApproval: false,
        verificationProviderConfigured: true,
        identifier: lookup,
      });
    }

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    const wallet = await ensureWallet(user.id);
    const session = await createSessionForUser(user.id, req, data.rememberMe);

    await recordAuditLog({
      actorUserId: user.id,
      actorEmail: user.email || user.phone || user.username,
      action: 'player.login',
      entityType: 'user',
      entityId: String(user.id),
      details: { method: data.method },
      ipAddress: req.ip,
    });

    return res.json({
      token: session.token,
      expiresAt: session.expiresAt,
      user: sanitizeUserProfile(user),
      wallet,
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Unable to sign in right now.' });
  }
});

// Dedicated Admin Panel Login (Username e.g. "Afa" or Email + Password; enforces admin RBAC)
authRouter.post('/admin-login', authLimiter, async (req, res) => {
  const parsed = adminLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Username/email and password are required.' });
  }

  const identifier = parsed.data.identifier.trim();
  try {
    const [adminUser] = await db
      .select()
      .from(users)
      .where(
        or(
          sql`LOWER(${users.username}) = LOWER(${identifier})`,
          eq(users.email, identifier.toLowerCase())
        )
      )
      .limit(1);

    if (!adminUser || !verifyPassword(parsed.data.password, adminUser.passwordHash)) {
      return res.status(401).json({ error: 'Invalid administrator credentials.' });
    }
    if (!ADMIN_ROLES.has(adminUser.role)) {
      return res.status(403).json({ error: 'This account does not have administrator privileges.' });
    }
    if (adminUser.status === 'suspended') {
      return res.status(403).json({ error: 'This administrator account is suspended.' });
    }

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, adminUser.id));
    const wallet = await ensureWallet(adminUser.id);
    const session = await createSessionForUser(adminUser.id, req, parsed.data.rememberMe);

    await recordAuditLog({
      actorUserId: adminUser.id,
      actorEmail: adminUser.username || adminUser.email,
      action: 'admin.login',
      entityType: 'user',
      entityId: String(adminUser.id),
      details: { role: adminUser.role },
      ipAddress: req.ip,
    });

    return res.json({
      token: session.token,
      expiresAt: session.expiresAt,
      user: sanitizeUserProfile(adminUser),
      wallet,
    });
  } catch (error) {
    console.error('Admin login error:', error);
    return res.status(500).json({ error: 'Administrator sign-in failed.' });
  }
});

authRouter.post('/forgot-password', recoveryLimiter, async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Provide your registered phone number or email.' });
  }

  const providers = getVerificationProviderStatus();
  const cleanId = parsed.data.identifier.trim();
  const isEmail = cleanId.includes('@');
  const providerAvailable = isEmail ? providers.emailConfigured : providers.smsConfigured;

  if (!providerAvailable) {
    return res.status(503).json({
      error: isEmail
        ? 'Email recovery provider (SMTP) is not configured. Please contact WinGo Customer Service or an administrator.'
        : 'SMS recovery provider is not configured. Please contact WinGo Customer Service or an administrator.',
      recoveryProviderConfigured: false,
    });
  }

  try {
    const [user] = await db
      .select()
      .from(users)
      .where(or(eq(users.email, cleanId.toLowerCase()), eq(users.phone, cleanId)))
      .limit(1);

    if (user) {
      const code = generateVerificationCode();
      await db
        .update(users)
        .set({ verificationCode: hashToken(code) })
        .where(eq(users.id, user.id));
    }

    return res.json({
      message: 'If an account matches this identifier, a 6-digit recovery code has been dispatched.',
      recoveryProviderConfigured: true,
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ error: 'Password recovery request failed.' });
  }
});

authRouter.post('/reset-password', recoveryLimiter, async (req, res) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Valid identifier, 6-digit code, and new password (min 8 chars) are required.' });
  }

  const { identifier, code, newPassword } = parsed.data;
  if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    return res.status(400).json({ error: 'New password must include both letters and numbers.' });
  }

  try {
    const cleanId = identifier.trim();
    const [user] = await db
      .select()
      .from(users)
      .where(or(eq(users.email, cleanId.toLowerCase()), eq(users.phone, cleanId)))
      .limit(1);

    if (!user || !user.verificationCode || user.verificationCode !== hashToken(code)) {
      return res.status(400).json({ error: 'Invalid or expired recovery code.' });
    }

    await db
      .update(users)
      .set({ passwordHash: hashPassword(newPassword), verificationCode: null })
      .where(eq(users.id, user.id));

    await db.delete(sessions).where(eq(sessions.userId, user.id));

    await recordAuditLog({
      actorUserId: user.id,
      actorEmail: user.email || user.phone || user.username,
      action: 'player.password_reset',
      entityType: 'user',
      entityId: String(user.id),
      ipAddress: req.ip,
    });

    return res.json({ message: 'Password updated successfully. Please sign in with your new password.' });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ error: 'Unable to reset password.' });
  }
});

// Secure password change for both players and administrators
authRouter.post('/change-password', requireAuth, authLimiter, async (req: AuthenticatedRequest, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid password change request.' });
  }

  const { currentPassword, newPassword, confirmPassword } = parsed.data;
  if (confirmPassword !== undefined && newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'New password and confirmation do not match.' });
  }

  const isAdmin = ADMIN_ROLES.has(req.authUser!.role);
  if (isAdmin && newPassword.length < 10) {
    return res.status(400).json({ error: 'Administrator password must be at least 10 characters long.' });
  }
  if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    return res.status(400).json({ error: 'New password must include both letters and numbers.' });
  }

  try {
    const [freshUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, req.authUser!.id))
      .limit(1);

    if (!freshUser || !verifyPassword(currentPassword, freshUser.passwordHash)) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    await db
      .update(users)
      .set({ passwordHash: hashPassword(newPassword) })
      .where(eq(users.id, freshUser.id));

    // Revoke other sessions while preserving the current active session if bearer session token is used
    const authHeader = req.headers.authorization;
    let currentTokenHash: string | null = null;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice('Bearer '.length).trim();
      if (/^[0-9a-f]{64}$/i.test(token)) {
        currentTokenHash = hashToken(token);
      }
    }

    if (currentTokenHash) {
      await db
        .delete(sessions)
        .where(and(eq(sessions.userId, freshUser.id), ne(sessions.tokenHash, currentTokenHash)));
    } else {
      await db.delete(sessions).where(eq(sessions.userId, freshUser.id));
    }

    await recordAuditLog({
      actorUserId: freshUser.id,
      actorEmail: freshUser.username || freshUser.email || freshUser.phone,
      action: isAdmin ? 'admin.password_changed' : 'player.password_changed',
      entityType: 'user',
      entityId: String(freshUser.id),
      ipAddress: req.ip,
    });

    return res.json({ message: 'Password changed successfully. All other sessions have been signed out.' });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({ error: 'Unable to update password.' });
  }
});

authRouter.post('/logout', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice('Bearer '.length).trim();
      if (/^[0-9a-f]{64}$/i.test(token)) {
        await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
      }
    }
    return res.json({ message: 'Signed out successfully.' });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({ error: 'Failed to sign out.' });
  }
});

authRouter.get('/me', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const wallet = await ensureWallet(req.authUser!.id);
    return res.json({
      user: sanitizeUserProfile(req.authUser!),
      wallet,
    });
  } catch (error) {
    console.error('Fetch me error:', error);
    return res.status(500).json({ error: 'Unable to load account profile.' });
  }
});

authRouter.get('/sessions', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const items = await db
      .select({
        id: sessions.id,
        ipAddress: sessions.ipAddress,
        userAgent: sessions.userAgent,
        expiresAt: sessions.expiresAt,
        createdAt: sessions.createdAt,
      })
      .from(sessions)
      .where(eq(sessions.userId, req.authUser!.id))
      .orderBy(desc(sessions.createdAt))
      .limit(20);
    return res.json({ items });
  } catch (error) {
    console.error('Fetch sessions error:', error);
    return res.status(500).json({ error: 'Unable to load active sessions.' });
  }
});

authRouter.delete('/sessions/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid session ID.' });
  }
  try {
    await db
      .delete(sessions)
      .where(and(eq(sessions.id, id), eq(sessions.userId, req.authUser!.id)));
    return res.json({ message: 'Session revoked.' });
  } catch (error) {
    console.error('Revoke session error:', error);
    return res.status(500).json({ error: 'Unable to revoke session.' });
  }
});

const ALLOWED_PREF_LANGUAGES = [
  'en', 'zh-CN', 'km', 'zh-TW', 'th', 'vi', 'lo', 'id', 'ms', 'hi', 'bn', 'my',
  'ja', 'ko', 'fr', 'es', 'pt', 'de', 'it', 'ru', 'ar', 'tr', 'fil', 'ur', 'ne',
] as const;

const updateProfileHandler = async (req: AuthenticatedRequest, res: any) => {
  const schema = z.object({
    language: z.enum(ALLOWED_PREF_LANGUAGES).optional(),
    displayName: z.string().trim().min(2).max(50).optional(),
    countryCode: z.string().trim().min(1).max(6).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid profile payload.' });
  }

  try {
    const updates: Partial<typeof users.$inferInsert> = {};
    if (parsed.data.language) updates.language = parsed.data.language;
    if (parsed.data.displayName) updates.displayName = parsed.data.displayName;
    if (parsed.data.countryCode) updates.countryCode = parsed.data.countryCode;

    if (Object.keys(updates).length === 0) {
      return res.json({ user: sanitizeUserProfile(req.authUser!) });
    }

    const [updated] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, req.authUser!.id))
      .returning();

    return res.json({ user: sanitizeUserProfile(updated) });
  } catch (error) {
    console.error('Preferences update error:', error);
    return res.status(500).json({ error: 'Failed to update profile.' });
  }
};

authRouter.patch('/preferences', requireAuth, updateProfileHandler);
authRouter.patch('/profile', requireAuth, updateProfileHandler);

// One-time secure first-run Super Administrator ("Afa") initialization status & claim
// Strictly locked once Super Admin Afa has been configured via CLI (`npm run setup:admin`) or one-time claim.
authRouter.get('/admin-bootstrap-status', async (_req, res) => {
  try {
    const existingSuperAdmins = await db
      .select({ id: users.id, username: users.username, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.role, 'super_admin'));

    const configured = existingSuperAdmins.some((a) => Boolean(a.passwordHash));
    return res.json({
      requiresClaim: !configured,
      superAdminUsername: 'Afa',
      hasEnvPasscode: Boolean(process.env.WINGO_ADMIN_BOOTSTRAP_PASSCODE?.trim()),
    });
  } catch (error) {
    console.error('Admin bootstrap status error:', error);
    return res.status(500).json({ error: 'Failed to check admin setup status.' });
  }
});

authRouter.post('/admin-bootstrap', authLimiter, async (req, res) => {
  const schema = z.object({
    username: z.literal('Afa', { message: 'Initial Super Administrator username must be "Afa".' }),
    email: z.string().trim().email().optional().or(z.literal('')),
    password: z.string().min(10, 'Admin password must be at least 10 characters').max(128),
    confirmPassword: z.string().min(10).max(128).optional(),
    passcode: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid Super Admin setup request.' });
  }

  if (parsed.data.confirmPassword !== undefined && parsed.data.password !== parsed.data.confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match.' });
  }
  if (!/[A-Za-z]/.test(parsed.data.password) || !/[0-9]/.test(parsed.data.password)) {
    return res.status(400).json({ error: 'Administrator password must include both letters and numbers.' });
  }

  try {
    const existingSuperAdmins = await db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.role, 'super_admin'));

    if (existingSuperAdmins.some((a) => Boolean(a.passwordHash))) {
      return res.status(403).json({
        error: 'Super Administrator "Afa" is already configured. Public administrator registration is disabled.',
      });
    }

    const envPasscode = process.env.WINGO_ADMIN_BOOTSTRAP_PASSCODE?.trim();
    if (envPasscode && parsed.data.passcode !== envPasscode) {
      return res.status(403).json({ error: 'Invalid administrator setup passcode.' });
    }

    const normalizedEmail = parsed.data.email?.trim() ? parsed.data.email.trim().toLowerCase() : null;

    const [created] = await db
      .insert(users)
      .values({
        uid: `admin_${crypto.randomUUID()}`,
        username: 'Afa',
        email: normalizedEmail,
        displayName: 'Afa (Super Admin)',
        passwordHash: hashPassword(parsed.data.password),
        role: 'super_admin',
        status: 'active',
        isVerified: true,
        ageConfirmed: true,
        jurisdictionCode: 'GLOBAL',
        inviteCode: generateInviteCode(),
      })
      .returning();

    const wallet = await ensureWallet(created.id);
    const session = await createSessionForUser(created.id, req, false);

    await recordAuditLog({
      actorUserId: created.id,
      actorEmail: created.username || created.email,
      action: 'admin.initial_setup',
      entityType: 'user',
      entityId: String(created.id),
      details: { username: 'Afa' },
      ipAddress: req.ip,
    });

    return res.status(201).json({
      token: session.token,
      expiresAt: session.expiresAt,
      user: sanitizeUserProfile(created),
      wallet,
    });
  } catch (error) {
    console.error('Admin bootstrap error:', error);
    return res.status(500).json({ error: 'Failed to initialize Super Administrator account.' });
  }
});
