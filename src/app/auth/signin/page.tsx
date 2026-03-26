'use client';

import { signIn } from 'next-auth/react';

export default function SignInPage() {
  return (
    <main style={{
      fontFamily: 'system-ui, sans-serif',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: '#f9fafb',
    }}>
      <div style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: '2.5rem',
        textAlign: 'center',
        maxWidth: 400,
        width: '100%',
      }}>
        <h1 style={{ marginBottom: '0.5rem', fontSize: '1.5rem' }}>SEO Agent</h1>
        <p style={{ color: '#6b7280', marginBottom: '2rem', fontSize: '0.95rem' }}>
          Sign in with your Google account to connect Google Search Console and Analytics.
        </p>
        <button
          onClick={() => signIn('google', { callbackUrl: '/dashboard' })}
          style={{
            background: '#4285F4',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '0.75rem 1.5rem',
            fontSize: '1rem',
            cursor: 'pointer',
            width: '100%',
          }}
        >
          Sign in with Google
        </button>
      </div>
    </main>
  );
}
