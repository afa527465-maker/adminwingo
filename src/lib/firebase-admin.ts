// Standalone local PostgreSQL mode: Bearer authentication uses WinGo PostgreSQL sessions.
export const adminAuth = {
  async verifyIdToken(_token: string): Promise<{ uid: string; email?: string; name?: string }> {
    throw new Error('Firebase Admin SDK is disabled in standalone local PostgreSQL mode.');
  },
};
