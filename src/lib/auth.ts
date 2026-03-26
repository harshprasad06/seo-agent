import { type NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { saveTokens } from './tokens';

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          // Request offline access so we get a refresh token for GSC/GA API calls
          access_type: 'offline',
          prompt: 'consent',
          scope: [
            'openid',
            'email',
            'profile',
            // Google Search Console
            'https://www.googleapis.com/auth/webmasters.readonly',
            // Google Analytics
            'https://www.googleapis.com/auth/analytics.readonly',
          ].join(' '),
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      // Persist the OAuth access/refresh tokens in the JWT on first sign-in
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.accessTokenExpires = account.expires_at
          ? account.expires_at * 1000
          : undefined;

        // Persist encrypted tokens to the database for server-side API access
        if (account.access_token && account.refresh_token && account.expires_at) {
          try {
            await saveTokens(
              'gsc',
              account.access_token,
              account.refresh_token,
              new Date(account.expires_at * 1000),
            );
          } catch (err) {
            console.error('[auth] Failed to save GSC tokens:', err);
          }
        }
      }
      return token;
    },
    async session({ session, token }) {
      // Expose tokens to the server session (never sent to the browser)
      (session as any).accessToken = token.accessToken;
      (session as any).refreshToken = token.refreshToken;
      (session as any).accessTokenExpires = token.accessTokenExpires;
      return session;
    },
  },
  pages: {
    signIn: '/auth/signin',
  },
  secret: process.env.NEXTAUTH_SECRET,
};
