'use client';
import { PageHeader } from '@/components/ui';
import { ConfigForm, type ConfigField } from '@/components/config-form';

// Telegram bridge (ADR 0007). The bot token is a secret (category `integrations`,
// stored encrypted); the enable flag + webhook URL are non-secret. These map to the
// keys read by InstanceService.getTelegramConfig().
const TELEGRAM_FIELDS: ConfigField[] = [
  {
    key: 'TELEGRAM_ENABLED',
    label: 'Enable the Telegram bridge',
    type: 'toggle',
    category: 'integrations',
    help: 'When off, the per-channel “Connect Telegram” option is hidden in the web app.',
  },
  {
    key: 'TELEGRAM_BOT_TOKEN',
    label: 'Bot token',
    type: 'password',
    category: 'integrations',
    help: 'From @BotFather. Remember to disable the bot’s privacy mode, or it won’t see group messages.',
  },
  {
    key: 'TELEGRAM_WEBHOOK_URL',
    label: 'Public API base URL (webhook mode)',
    type: 'text',
    category: 'integrations',
    help: 'Leave blank for local dev — the bridge then uses long polling (no public endpoint needed). In production set your API base, e.g. https://api.example.com',
  },
];

export default function TelegramPage() {
  return (
    <>
      <PageHeader
        title="Telegram"
        description="Connect a Telegram bot so workspace channels can mirror Telegram groups both ways."
      />
      <div className="space-y-8">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-fg">Bot connection</h2>
          <ConfigForm fields={TELEGRAM_FIELDS} />
        </section>
      </div>
    </>
  );
}
