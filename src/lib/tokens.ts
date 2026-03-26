import crypto from 'crypto';
import { supabaseAdmin } from './supabase';

// ── Encryption helpers ────────────────────────────────────────────────────────

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16; // AES block size

function getEncryptionKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET is not set');
  // Derive a 32-byte key from the secret using SHA-256
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  // Store as iv:ciphertext (both hex-encoded)
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(ciphertext: string): string {
  const key = getEncryptionKey();
  const [ivHex, encryptedHex] = ciphertext.split(':');
  if (!ivHex || !encryptedHex) throw new Error('Invalid ciphertext format');
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

// ── TokenRevokedError ─────────────────────────────────────────────────────────

export class TokenRevokedError extends Error {
  constructor(provider: 'gsc' | 'ga') {
    super(`OAuth refresh token for provider "${provider}" has been revoked. Re-authentication required.`);
    this.name = 'TokenRevokedError';
  }
}

// ── Token types ───────────────────────────────────────────────────────────────

export interface TokenRecord {
  provider: 'gsc' | 'ga';
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

// ── saveTokens ────────────────────────────────────────────────────────────────

/**
 * Encrypts and upserts OAuth tokens for the given provider into `oauth_tokens`.
 */
export async function saveTokens(
  provider: 'gsc' | 'ga',
  accessToken: string,
  refreshToken: string,
  expiresAt: Date,
): Promise<void> {
  const encryptedAccess = encrypt(accessToken);
  const encryptedRefresh = encrypt(refreshToken);

  const { error } = await supabaseAdmin
    .from('oauth_tokens')
    .upsert(
      {
        provider,
        access_token: encryptedAccess,
        refresh_token: encryptedRefresh,
        expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'provider' },
    );

  if (error) {
    throw new Error(`Failed to save tokens for provider "${provider}": ${error.message}`);
  }
}

// ── getTokens ─────────────────────────────────────────────────────────────────

/**
 * Fetches and decrypts OAuth tokens for the given provider.
 * Returns null if no tokens are stored.
 */
export async function getTokens(provider: 'gsc' | 'ga'): Promise<TokenRecord | null> {
  const { data, error } = await supabaseAdmin
    .from('oauth_tokens')
    .select('provider, access_token, refresh_token, expires_at')
    .eq('provider', provider)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch tokens for provider "${provider}": ${error.message}`);
  }

  if (!data) return null;

  return {
    provider: data.provider as 'gsc' | 'ga',
    accessToken: decrypt(data.access_token),
    refreshToken: decrypt(data.refresh_token),
    expiresAt: new Date(data.expires_at),
  };
}

// ── refreshTokenIfNeeded ──────────────────────────────────────────────────────

const REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Checks if the stored access token for the given provider expires within 5 minutes.
 * If so, calls the Google OAuth token refresh endpoint and saves the new tokens.
 * Throws TokenRevokedError if the refresh token is revoked or invalid.
 * Returns the current (or refreshed) token record.
 */
export async function refreshTokenIfNeeded(provider: 'gsc' | 'ga'): Promise<TokenRecord> {
  const tokens = await getTokens(provider);
  if (!tokens) {
    throw new Error(`No tokens found for provider "${provider}". Authentication required.`);
  }

  const msUntilExpiry = tokens.expiresAt.getTime() - Date.now();
  if (msUntilExpiry > REFRESH_THRESHOLD_MS) {
    // Token is still valid — no refresh needed
    return tokens;
  }

  // Token is expiring soon — refresh it
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    refresh_token: tokens.refreshToken,
    grant_type: 'refresh_token',
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const body = await response.json();

  if (!response.ok) {
    // Google returns error codes like 'invalid_grant' when the refresh token is revoked
    const isRevoked =
      body.error === 'invalid_grant' ||
      body.error === 'token_revoked' ||
      body.error_description?.includes('revoked');

    if (isRevoked) {
      throw new TokenRevokedError(provider);
    }

    throw new Error(
      `Token refresh failed for provider "${provider}": ${body.error} — ${body.error_description}`,
    );
  }

  const newAccessToken: string = body.access_token;
  // Google may not return a new refresh token; keep the existing one if absent
  const newRefreshToken: string = body.refresh_token ?? tokens.refreshToken;
  const expiresInSeconds: number = body.expires_in ?? 3600;
  const newExpiresAt = new Date(Date.now() + expiresInSeconds * 1000);

  await saveTokens(provider, newAccessToken, newRefreshToken, newExpiresAt);

  return {
    provider,
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    expiresAt: newExpiresAt,
  };
}
