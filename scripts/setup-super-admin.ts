import 'dotenv/config';
import crypto from 'crypto';
import readline from 'readline';
import { eq, sql } from 'drizzle-orm';
import { db, createPool } from '../src/db/index.ts';
import { users, auditLogs } from '../src/db/schema.ts';
import { generateInviteCode, hashPassword } from '../src/server/crypto.ts';
import { ensureWallet } from '../src/server/ledger.ts';

const SUPER_ADMIN_USERNAME = 'Afa';

function askQuestion(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer.trim()));
  });
}

/**
 * Prompts for a password in the terminal with masked (*) echo so plaintext is never shown on screen.
 */
function askHiddenPassword(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      // Non-TTY fallback (e.g., piped stdin in automated scripts)
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(prompt, (ans) => {
        rl.close();
        resolve(ans.trim());
      });
      return;
    }

    process.stdout.write(prompt);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';
    const onData = (ch: string) => {
      for (const char of ch) {
        if (char === '\r' || char === '\n') {
          stdin.setRawMode(Boolean(wasRaw));
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u0003') {
          stdin.setRawMode(Boolean(wasRaw));
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\nCancelled.\n');
          reject(new Error('Setup cancelled by user.'));
          return;
        }
        if (char === '\u007f' || char === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        value += char;
        process.stdout.write('*');
      }
    };

    stdin.on('data', onData);
  });
}

function validatePasswordStrength(password: string): string | null {
  if (password.length < 10) {
    return 'Password must be at least 10 characters long.';
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must include both letters and numbers.';
  }
  return null;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const allowReset = args.has('--reset-password');
  const pool = createPool();

  console.log('\n=======================================================');
  console.log('  WinGo Platform — Initial Super Administrator Setup');
  console.log('=======================================================\n');
  console.log(`Target Super Administrator username: ${SUPER_ADMIN_USERNAME}`);
  console.log('Passwords are hashed with scrypt and are never stored in plaintext.\n');

  try {
    // Check whether Super Admin Afa already exists (case-insensitive username check)
    const [existingAfa] = await db
      .select()
      .from(users)
      .where(sql`LOWER(${users.username}) = LOWER(${SUPER_ADMIN_USERNAME})`)
      .limit(1);

    if (existingAfa && existingAfa.passwordHash && !allowReset) {
      console.log(`Super Administrator "${existingAfa.username}" already exists in the database.`);
      console.log('For safety, existing credentials are never overwritten automatically.');
      console.log('To reset the password intentionally, run:');
      console.log('  npm run setup:admin -- --reset-password\n');
      return;
    }

    const password = await askHiddenPassword('Enter Super Administrator password (min 10 chars, letters + numbers): ');
    const strengthErr = validatePasswordStrength(password);
    if (strengthErr) {
      console.error(`\nError: ${strengthErr}`);
      process.exitCode = 1;
      return;
    }

    const confirm = await askHiddenPassword('Confirm Super Administrator password: ');
    if (password !== confirm) {
      console.error('\nError: Passwords do not match.');
      process.exitCode = 1;
      return;
    }

    let optionalEmail: string | null = existingAfa?.email || null;
    if (!existingAfa && process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const emailInput = await askQuestion(rl, 'Optional admin email (press Enter to skip): ');
      rl.close();
      if (emailInput) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput)) {
          console.error('\nError: Invalid email format.');
          process.exitCode = 1;
          return;
        }
        optionalEmail = emailInput.toLowerCase();
      }
    }

    const passwordHash = hashPassword(password);

    if (existingAfa) {
      const [updated] = await db
        .update(users)
        .set({
          username: SUPER_ADMIN_USERNAME,
          passwordHash,
          role: 'super_admin',
          status: 'active',
          isVerified: true,
        })
        .where(eq(users.id, existingAfa.id))
        .returning();

      await ensureWallet(updated.id);
      await db.insert(auditLogs).values({
        actorUserId: updated.id,
        actorEmail: updated.username || updated.email,
        action: 'admin.cli_password_reset',
        entityType: 'user',
        entityId: String(updated.id),
        detailsJson: { username: SUPER_ADMIN_USERNAME },
      });

      console.log(`\nSuccess! Password updated for Super Administrator "${SUPER_ADMIN_USERNAME}".\n`);
      return;
    }

    const [created] = await db
      .insert(users)
      .values({
        uid: `admin_${crypto.randomUUID()}`,
        username: SUPER_ADMIN_USERNAME,
        email: optionalEmail,
        displayName: 'Afa (Super Admin)',
        passwordHash,
        role: 'super_admin',
        status: 'active',
        isVerified: true,
        ageConfirmed: true,
        jurisdictionCode: 'GLOBAL',
        inviteCode: generateInviteCode(),
      })
      .returning();

    await ensureWallet(created.id);
    await db.insert(auditLogs).values({
      actorUserId: created.id,
      actorEmail: created.username || created.email,
      action: 'admin.cli_initial_setup',
      entityType: 'user',
      entityId: String(created.id),
      detailsJson: { username: SUPER_ADMIN_USERNAME, role: 'super_admin' },
    });

    console.log('\n-------------------------------------------------------');
    console.log(`Super Administrator "${SUPER_ADMIN_USERNAME}" created successfully!`);
    console.log('You can now sign in to WinGo Admin Panel using:');
    console.log(`  Username: ${SUPER_ADMIN_USERNAME}`);
    console.log('  Password: (the password you just entered)');
    console.log('-------------------------------------------------------\n');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('\nSetup failed:', err?.message || err);
  process.exit(1);
});
