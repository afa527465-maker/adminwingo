import type { Request, Response, NextFunction } from 'express';
import { eq, and, gt } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { users, sessions } from '../db/schema.ts';
import { adminAuth } from '../lib/firebase-admin.ts';
import { hashToken, generateInviteCode } from './crypto.ts';
import { ensureWallet } from './ledger.ts';

export type UserRecord = typeof users.$inferSelect;

export interface AuthenticatedRequest extends Request {
  authUser?: UserRecord;
  authMethod?: 'firebase' | 'session';
}

export const ADMIN_ROLES = new Set(['super_admin', 'admin', 'finance', 'support']);

export async function getOrCreateFirebaseUser(decoded: {
  uid: string;
  email?: string;
  name?: string;
}): Promise<UserRecord> {
  const normalizedEmail = decoded.email ? decoded.email.toLowerCase().trim() : null;

  try {
    // Check by Firebase UID first
    const [byUid] = await db.select().from(users).where(eq(users.uid, decoded.uid)).limit(1);
    if (byUid) {
      const updates: Partial<typeof users.$inferInsert> = {
        lastLoginAt: new Date(),
      };
      if (!byUid.isVerified) {
        updates.isVerified = true;
        updates.status = byUid.status === 'pending_verification' ? 'active' : byUid.status;
      }
      const [updated] = await db
        .update(users)
        .set(updates)
        .where(eq(users.id, byUid.id))
        .returning();
      await ensureWallet(updated.id);
      return updated;
    }

    // Check if an account already exists with this email
    if (normalizedEmail) {
      const [byEmail] = await db
        .select()
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);
      if (byEmail) {
        const [linked] = await db
          .update(users)
          .set({
            uid: decoded.uid,
            isVerified: true,
            status: byEmail.status === 'pending_verification' ? 'active' : byEmail.status,
            lastLoginAt: new Date(),
          })
          .where(eq(users.id, byEmail.id))
          .returning();
        await ensureWallet(linked.id);
        return linked;
      }
    }

    // Upsert new player safely under concurrency (never auto-create admin accounts)
    const displayName =
      decoded.name || (normalizedEmail ? normalizedEmail.split('@')[0] : `Player_${decoded.uid.slice(0, 6)}`);

    const [created] = await db
      .insert(users)
      .values({
        uid: decoded.uid,
        email: normalizedEmail,
        displayName,
        role: 'player',
        status: 'active',
        isVerified: true,
        ageConfirmed: true,
        inviteCode: generateInviteCode(),
        lastLoginAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          lastLoginAt: new Date(),
          ...(normalizedEmail ? { email: normalizedEmail } : {}),
        },
      })
      .returning();

    await ensureWallet(created.id);
    return created;
  } catch (error) {
    console.error('Firebase user sync failed:', error);
    throw new Error('Unable to synchronize user profile.', { cause: error });
  }
}

export async function resolveAuthFromHeader(
  authHeader: string | undefined
): Promise<{ user: UserRecord; method: 'firebase' | 'session' } | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) return null;

  // 1. Check WinGo session token first (64-char hex)
  if (/^[0-9a-f]{64}$/i.test(token)) {
    const tokenHash = hashToken(token);
    const now = new Date();
    const rows = await db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
      .limit(1);

    if (rows[0]) {
      return { user: rows[0].user, method: 'session' };
    }
    return null;
  }

  // 2. Verify Firebase ID Token
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const user = await getOrCreateFirebaseUser({
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
    });
    return { user, method: 'firebase' };
  } catch {
    return null;
  }
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const resolved = await resolveAuthFromHeader(req.headers.authorization);
    if (!resolved) {
      return res.status(401).json({ error: 'Authentication required. Please sign in.' });
    }
    if (resolved.user.status === 'suspended') {
      return res.status(403).json({ error: 'This account is suspended. Contact WinGo support.' });
    }
    if (resolved.user.status === 'rejected') {
      return res.status(403).json({ error: 'Your registration was not approved. Please contact WinGo Customer Service.' });
    }
    req.authUser = resolved.user;
    req.authMethod = resolved.method;
    return next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: 'Authentication verification failed.' });
  }
}

export function requireVerifiedAccount(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.authUser) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  if (req.authUser.status !== 'active' && !req.authUser.isVerified) {
    return res.status(403).json({
      error:
        req.authUser.status === 'pending_approval'
          ? 'Waiting for Administrator Approval.'
          : 'Account verification required before placing wagers or transacting.',
      code: req.authUser.status === 'pending_approval' ? 'APPROVAL_REQUIRED' : 'VERIFICATION_REQUIRED',
    });
  }
  return next();
}

export function requireAdmin(allowedRoles: string[] = ['super_admin', 'admin', 'finance', 'support']) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!allowedRoles.includes(req.authUser.role)) {
      return res.status(403).json({ error: 'Administrator privileges required for this action.' });
    }
    return next();
  };
}

export function sanitizeUserProfile(user: UserRecord) {
  return {
    id: user.id,
    uid: user.uid,
    username: user.username,
    countryCode: user.countryCode,
    phone: user.phone,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    isVerified: user.isVerified,
    approvedByUserId: user.approvedByUserId,
    approvedAt: user.approvedAt,
    rejectionReason: user.rejectionReason,
    ageConfirmed: user.ageConfirmed,
    jurisdictionCode: user.jurisdictionCode,
    inviteCode: user.inviteCode,
    referredById: user.referredById,
    vipLevel: user.vipLevel,
    language: user.language,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}
