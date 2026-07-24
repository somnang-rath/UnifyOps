'use client';
import { useEffect, useState } from 'react';
import { Button, Skeleton, ErrorState } from '@prism/ui';
import {
  usePublicInstance,
  useUpdateInstanceName,
  useAdmins,
} from '@/hooks/useInstance';
import { PageHeader, Card, inputCls } from '@/components/ui';

export default function GeneralPage() {
  const { data, isLoading, isError, refetch } = usePublicInstance();
  const { data: admins } = useAdmins();
  const rename = useUpdateInstanceName();
  const [name, setName] = useState('');

  useEffect(() => {
    if (data) setName(data.instanceName);
  }, [data]);

  return (
    <>
      <PageHeader title="General" description="Instance identity and admins." />
      {isLoading ? (
        <Card><Skeleton rows={4} /></Card>
      ) : isError || !data ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (
        <div className="space-y-6">
          <Card>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                rename.mutate(name);
              }}
              className="space-y-4"
            >
              <label className="block space-y-1">
                <span className="text-sm font-medium text-fg-muted">Instance name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputCls}
                />
              </label>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Meta label="Instance ID" value={data.instanceId} />
                <Meta label="Version" value={data.currentVersion} />
                <Meta label="Setup done" value={data.isSetupDone ? 'Yes' : 'No'} />
              </dl>
              <Button type="submit" disabled={rename.isPending}>
                {rename.isPending ? 'Saving…' : 'Save'}
              </Button>
            </form>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-fg">
              Instance admins
            </h2>
            <ul className="divide-y divide-line">
              {(admins ?? []).map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="font-medium text-fg">
                    {a.user?.name ?? 'Unknown'}
                  </span>
                  <span className="text-fg-subtle">{a.user?.email}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-fg-subtle">{label}</dt>
      <dd className="truncate font-mono text-fg-muted">{value}</dd>
    </div>
  );
}
