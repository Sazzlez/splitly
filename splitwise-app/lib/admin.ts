// Admin user IDs. Server reads ADMIN_USER_IDS, client reads NEXT_PUBLIC_ADMIN_USER_IDS.
// Default fallback: Dirk (the creator of the original Rebirth 2026 event).
const DEFAULT_ADMIN = 'fb0bb245-34e4-40ff-b9bb-150297887e18';

function parseList(raw: string | undefined): string[] {
  return (raw || DEFAULT_ADMIN)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getServerAdminIds(): string[] {
  return parseList(process.env.ADMIN_USER_IDS);
}

export function getClientAdminIds(): string[] {
  return parseList(process.env.NEXT_PUBLIC_ADMIN_USER_IDS);
}

export function isAdmin(userId: string): boolean {
  // Server-side check
  if (typeof window === 'undefined') return getServerAdminIds().includes(userId);
  return getClientAdminIds().includes(userId);
}
