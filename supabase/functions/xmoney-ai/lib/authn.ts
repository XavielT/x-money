// Authentication of xmoney-ai: the SAME rules as xmoney-api (the account has its own session and
// token, there is no separate AI account): a valid signature, not expired, the session alive and
// not revoked, the account enabled. On top of that the account must have ai_enabled.
import type { Db } from '../../xmoney-api/lib/db.ts';
import { verifyAccessToken } from '../../xmoney-api/lib/tokens.ts';

export interface AiPrincipal {
  accountId: string;
  aiEnabled: boolean;
  requestCap: number | null;
  tokenCap: number | null;
}

export interface AuthnDeps {
  db: Pick<Db, 'findSessionById' | 'findAccountById'>;
  tokenSecret: string;
  now: () => number;
  loadCaps: (accountId: string) => Promise<{ requestCap: number | null; tokenCap: number | null }>;
}

export function createAuthenticator(deps: AuthnDeps) {
  return async function authenticate(header: string | null): Promise<AiPrincipal | null> {
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return null;
    const claims = await verifyAccessToken(token, deps.tokenSecret, deps.now());
    if (!claims) return null;
    const session = await deps.db.findSessionById(claims.sid);
    if (!session || session.accountId !== claims.sub || session.revokedAt || session.expiresAt <= deps.now()) return null;
    const account = await deps.db.findAccountById(claims.sub);
    if (!account?.enabled) return null;
    const caps = await deps.loadCaps(account.id);
    return { accountId: account.id, aiEnabled: account.aiEnabled, ...caps };
  };
}
