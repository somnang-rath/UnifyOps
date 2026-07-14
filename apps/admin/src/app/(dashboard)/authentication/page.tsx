'use client';
import { PageHeader } from '@/components/ui';
import { ConfigForm, type ConfigField } from '@/components/config-form';

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

export default function AuthenticationPage() {
  return (
    <>
      <PageHeader
        title="Authentication"
        description="Enable sign-in methods for this instance."
      />
      <ConfigForm fields={FIELDS} />
    </>
  );
}
