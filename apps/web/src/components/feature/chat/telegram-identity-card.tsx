'use client';
import { Copy, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/stores/toast-store';
import {
  useLinkMyTelegram,
  useMyTelegramIdentity,
  useUnlinkMyTelegram,
} from '@/hooks/use-telegram-link';

/**
 * Personal Telegram account linking (attribution). Once linked, the user's
 * messages in any Telegram group connected to a Prism channel show as their real
 * Prism identity instead of an external "via Telegram" author.
 */
export function TelegramIdentityCard() {
  const { data, isLoading, isError } = useMyTelegramIdentity();
  const link = useLinkMyTelegram();
  const unlink = useUnlinkMyTelegram();

  // Telegram not available on this instance → hide the card entirely.
  if (isError) return null;

  return (
    <section className="bg-bg-card border border-border rounded-lg p-6 flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold flex items-center gap-2">
            <Send className="w-4 h-4 text-[#229ED9]" /> Telegram account
          </h3>
          <p className="text-[13px] text-text-muted mt-0.5">
            Link your Telegram so your messages in connected groups show as you.
          </p>
        </div>
      </header>

      {isLoading ? (
        <p className="text-[13px] text-text-muted">Loading…</p>
      ) : data?.linked ? (
        <div className="flex items-center justify-between gap-3">
          <div className="text-[13px]">
            Linked as{' '}
            <span className="font-semibold">
              {data.telegramUsername
                ? `@${data.telegramUsername}`
                : data.telegramName || 'your Telegram account'}
            </span>
          </div>
          <Button
            variant="ghost"
            type="button"
            onClick={() => unlink.mutate()}
            disabled={unlink.isPending}
            className="text-red-500"
          >
            Unlink
          </Button>
        </div>
      ) : data?.pendingCode ? (
        <VerifyInstructions
          code={data.pendingCode}
          botUsername={data.botUsername}
        />
      ) : (
        <div>
          <Button
            variant="primary"
            type="button"
            onClick={() =>
              link.mutate(undefined, {
                onError: () =>
                  toast('Telegram is not configured on this instance', 'error'),
              })
            }
            disabled={link.isPending}
          >
            Link Telegram
          </Button>
        </div>
      )}
    </section>
  );
}

function VerifyInstructions({
  code,
  botUsername,
}: {
  code: string;
  botUsername: string | null;
}) {
  const command = `/verify ${code}`;
  return (
    <ol className="flex flex-col gap-3 text-[13px] text-text-sub list-decimal list-inside">
      <li>
        Open a private chat with{' '}
        <span className="font-mono font-semibold">
          @{botUsername ?? 'the bot'}
        </span>{' '}
        in Telegram.
      </li>
      <li>
        Send this message:
        <div className="mt-1 flex items-center gap-2">
          <code className="flex-1 font-mono text-[13px] bg-bg-input border border-border rounded-sm px-2 py-1.5">
            {command}
          </code>
          <button
            type="button"
            title="Copy"
            onClick={() => {
              navigator.clipboard?.writeText(command);
              toast('Copied', 'success');
            }}
            className="w-8 h-8 rounded-sm border border-border flex items-center justify-center text-text-muted hover:text-text"
          >
            <Copy className="w-4 h-4" />
          </button>
        </div>
      </li>
      <li>This card updates automatically once verified.</li>
    </ol>
  );
}
