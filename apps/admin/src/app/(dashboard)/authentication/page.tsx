'use client';
import { useMemo } from 'react';
import { PageHeader } from '@/components/ui';
import { ConfigForm, type ConfigField } from '@/components/config-form';
import { useConfig, usePublicInstance } from '@/hooks/useInstance';

const FIELDS: ConfigField[] = [
  { key: 'ENABLE_SIGNUP', label: 'Allow new sign-ups', type: 'toggle', category: 'auth' },
  { key: 'ENABLE_EMAIL_PASSWORD_LOGIN', label: 'Email + password login', type: 'toggle', category: 'auth' },
  { key: 'ENABLE_MAGIC_LINK_LOGIN', label: 'Magic-link (email code) login', type: 'toggle', category: 'auth' },
  { key: 'GOOGLE_OAUTH_ENABLED', label: 'Google OAuth', type: 'toggle', category: 'auth' },
  { key: 'GOOGLE_CLIENT_ID', label: 'Google Client ID', type: 'text', category: 'auth' },
  { key: 'GOOGLE_CLIENT_SECRET', label: 'Google Client Secret', type: 'password', category: 'auth' },
  { key: 'GITHUB_OAUTH_ENABLED', label: 'GitHub OAuth', type: 'toggle', category: 'auth' },
  { key: 'GITHUB_CLIENT_ID', label: 'GitHub Client ID', type: 'text', category: 'auth' },
  { key: 'GITHUB_CLIENT_SECRET', label: 'GitHub Client Secret', type: 'password', category: 'auth' },
];

const CREDENTIALS_MISSING =
  'Credentials missing — the provider stays disabled until a client ID and ' +
  'secret are set (here or via server env).';

export default function AuthenticationPage() {
  // Raw saved toggle (admin config endpoint) vs the EFFECTIVE boolean that
  // GET /instance reports (toggle on AND credentials resolved, ADR 0008 §1).
  // Toggle on + effective off ⇒ credentials are missing.
  const { data: rows } = useConfig();
  const { data: pub } = usePublicInstance();

  const warnings = useMemo(() => {
    if (!rows || !pub) return undefined;
    const out: Record<string, string | undefined> = {};
    for (const provider of ['GOOGLE', 'GITHUB'] as const) {
      const key = `${provider}_OAUTH_ENABLED`;
      const toggledOn = rows.find((r) => r.key === key)?.value === 'true';
      const effective = pub.config?.[key] === true;
      if (toggledOn && !effective) out[key] = CREDENTIALS_MISSING;
    }
    return out;
  }, [rows, pub]);

  return (
    <>
      <PageHeader
        title="Authentication"
        description="Enable sign-in methods for this instance."
      />
      <ConfigForm fields={FIELDS} warnings={warnings} />
    </>
  );
}
