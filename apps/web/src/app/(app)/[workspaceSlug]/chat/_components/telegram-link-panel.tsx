'use client';
import { Modal, Button, Spinner, Switch } from '@prism/ui';
import { AlertTriangle, Copy } from 'lucide-react';
import {
  useLinkTelegram,
  useTelegramStatus,
  useUnlinkTelegram,
  useUpdateTelegramLink,
} from '@/hooks/use-telegram-link';
import type { ChannelView } from '@/schemas/chat';

export function TelegramLinkPanel({
  channel,
  onClose,
}: {
  channel: ChannelView;
  onClose: () => void;
}) {
  const { data: status, isLoading, isError } = useTelegramStatus(channel._id);
  const link = useLinkTelegram(channel._id);
  const update = useUpdateTelegramLink(channel._id);
  const unlink = useUnlinkTelegram(channel._id);

  const linked = status?.linked;

  return (
    <Modal
      open
      onClose={onClose}
      title="Telegram bridge"
      description="Mirror this channel to a Telegram group. Messages relay both ways."
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      {isLoading ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : isError ? (
        <p className="text-[13px] text-text-muted py-4">
          The Telegram integration isn&apos;t available on this instance yet.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-2 text-[12px] text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-sm p-2.5">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              Anyone in the linked Telegram group can read messages in this
              channel, even without a Prism account. Only link groups you trust.
            </span>
          </div>

          {!linked ? (
            <LinkFlow
              code={link.data?.code}
              botUsername={link.data?.botUsername ?? status?.botUsername}
              pending={link.isPending}
              onStart={() => link.mutate()}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="text-[13px]">
                Linked to{' '}
                <span className="font-semibold">
                  {status?.chatTitle || 'a Telegram group'}
                </span>
              </div>

              <label className="flex items-center justify-between">
                <span className="text-[13px]">Relay active</span>
                <Switch
                  checked={!!status?.active}
                  onCheckedChange={(v) => update.mutate({ active: v })}
                  aria-label="Relay active"
                />
              </label>

              <div className="flex flex-col gap-1">
                <span className="text-[12px] text-text-muted">Direction</span>
                <select
                  value={status?.direction ?? 'both'}
                  onChange={(e) =>
                    update.mutate({
                      direction: e.target.value as
                        | 'both'
                        | 'to-telegram'
                        | 'from-telegram',
                    })
                  }
                  className="bg-bg-input border border-border rounded-sm px-2 py-1.5 text-[13px] outline-none focus:border-accent"
                >
                  <option value="both">Both directions</option>
                  <option value="to-telegram">Prism → Telegram only</option>
                  <option value="from-telegram">Telegram → Prism only</option>
                </select>
              </div>

              {status?.lastError && (
                <p className="text-[12px] text-red-500">
                  Last error: {status.lastError}
                </p>
              )}

              <Button
                variant="ghost"
                onClick={() => unlink.mutate()}
                disabled={unlink.isPending}
                className="self-start text-red-500"
              >
                Unlink
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function LinkFlow({
  code,
  botUsername,
  pending,
  onStart,
}: {
  code?: string;
  botUsername?: string | null;
  pending: boolean;
  onStart: () => void;
}) {
  if (!code) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[13px] text-text-sub">
          Generate a code, then add the bot to your Telegram group and send it
          there to confirm you control the group.
        </p>
        <Button onClick={onStart} disabled={pending} className="self-start">
          Generate link code
        </Button>
      </div>
    );
  }
  return (
    <ol className="flex flex-col gap-3 text-[13px] text-text-sub list-decimal list-inside">
      <li>
        Add{' '}
        <span className="font-mono font-semibold">
          @{botUsername ?? 'the bot'}
        </span>{' '}
        to your Telegram group.
      </li>
      <li>
        In the group, send:
        <div className="mt-1 flex items-center gap-2">
          <code className="flex-1 font-mono text-[13px] bg-bg-input border border-border rounded-sm px-2 py-1.5">
            /link {code}
          </code>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(`/link ${code}`)}
            title="Copy"
            className="w-8 h-8 rounded-sm border border-border flex items-center justify-center text-text-muted hover:text-text"
          >
            <Copy className="w-4 h-4" />
          </button>
        </div>
      </li>
      <li>This dialog updates automatically once the group is linked.</li>
    </ol>
  );
}
