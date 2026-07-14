'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Mail } from 'lucide-react';
import { api, login } from '@/lib/api';
import { AuthShell } from '@/components/auth/auth-shell';
import {
  AuthField,
  PasswordField,
  SubmitButton,
  ErrorBanner,
} from '@/components/auth/auth-form';

/**
 * First-run: sign in with an existing Unify account and claim this instance.
 * The signed-in user becomes the first instance admin (only works while none
 * exists — the API enforces this).
 */
export default function SetupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      await api.post('/instance/setup');
      router.replace('/general');
    } catch (err: any) {
      if (err?.response?.status === 409) {
        setError('This instance already has an admin. Redirecting…');
        setTimeout(() => router.replace('/login'), 1500);
      } else if (err?.response?.status === 401) {
        setError('Invalid email or password');
      } else {
        setError('Setup failed. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow="First-run setup"
      title="Set up this instance"
      subtitle="Sign in with your UnifyOps account to become the first instance admin."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <AuthField
          label="Email"
          type="email"
          icon={Mail}
          autoComplete="email"
          placeholder="you@company.com"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <PasswordField
          label="Password"
          icon={Lock}
          autoComplete="current-password"
          placeholder="••••••••"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <ErrorBanner>{error}</ErrorBanner>
        <SubmitButton busy={busy} busyLabel="Claiming…">
          Claim instance
        </SubmitButton>
      </form>
    </AuthShell>
  );
}
