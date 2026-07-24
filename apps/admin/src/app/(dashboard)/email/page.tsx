'use client';
import { useState } from 'react';
import { Button } from '@prism/ui';
import { PageHeader, Card, inputCls } from '@/components/ui';
import { ConfigForm, type ConfigField } from '@/components/config-form';
import { api } from '@/lib/api';

const FIELDS: ConfigField[] = [
  { key: 'SMTP_HOST', label: 'SMTP Host', type: 'text', category: 'smtp' },
  { key: 'SMTP_PORT', label: 'SMTP Port', type: 'text', category: 'smtp' },
  { key: 'SMTP_USER', label: 'SMTP Username', type: 'text', category: 'smtp' },
  { key: 'SMTP_PASSWORD', label: 'SMTP Password', type: 'password', category: 'smtp' },
  { key: 'SMTP_FROM', label: 'From address', type: 'text', category: 'smtp' },
];

export default function EmailPage() {
  const [to, setTo] = useState('');
  const [result, setResult] = useState<string | null>(null);

  async function sendTest(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    try {
      const { data } = await api.post<{ message: string }>('/instance/email/test', {
        to,
      });
      setResult(data.message);
    } catch (err: any) {
      setResult(err?.response?.data?.message ?? 'Test failed');
    }
  }

  return (
    <>
      <PageHeader title="Email (SMTP)" description="Configure outbound email." />
      <div className="space-y-6">
        <ConfigForm fields={FIELDS} />
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-fg">Send test email</h2>
          <form onSubmit={sendTest} className="flex items-end gap-3">
            <label className="flex-1 space-y-1">
              <span className="text-sm font-medium text-fg-muted">Recipient</span>
              <input
                type="email"
                required
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className={inputCls}
              />
            </label>
            <Button type="submit" variant="secondary">Send test</Button>
          </form>
          {result && <p className="mt-2 text-sm text-fg-muted">{result}</p>}
        </Card>
      </div>
    </>
  );
}
