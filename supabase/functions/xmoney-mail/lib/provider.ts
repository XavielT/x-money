// The mail provider behind xmoney-mail. The handler only knows this interface, so another provider
// (IMAP, Microsoft) would be one more implementation. This round only Gmail exists: anything else is
// reported as "provider not covered", never faked.
export interface MailMessage {
  id: string;
  from: string;
  subject: string;
  date: string; // ISO
  internalDateMs: number;
  text: string; // plain text, before reduction
  pdf?: { name: string; base64: string }; // the first PDF attachment, only when asked for
}

export interface MailProvider {
  readonly name: 'gmail';
  authUrl(params: { redirectUri: string; state: string; challenge: string }): string;
  exchange(params: { code: string; verifier: string; redirectUri: string }): Promise<{ refreshToken: string; email?: string } | null>;
  accessToken(refreshToken: string): Promise<string | null>; // null = the grant is gone (revoked, expired)
  list(accessToken: string, query: string, max: number): Promise<string[]>;
  get(accessToken: string, id: string, includePdf: boolean): Promise<MailMessage | null>;
  revoke(refreshToken: string): Promise<void>;
}
