'use client';
import { PageHeader } from '@/components/ui';
import { ConfigForm, type ConfigField } from '@/components/config-form';

// Assistant behaviour — mirrors the ASSISTANT_* keys read by
// InstanceService.getAiConfig(). Non-secret, so category 'ai' (not encrypted).
const ASSISTANT_FIELDS: ConfigField[] = [
  {
    key: 'ASSISTANT_ENABLED',
    label: 'Enable the in-app AI assistant',
    type: 'toggle',
    category: 'ai',
    help: 'When off, the assistant is hidden across the web app.',
  },
  {
    key: 'ASSISTANT_PROVIDER',
    label: 'Provider',
    type: 'select',
    category: 'ai',
    options: [
      { value: 'anthropic', label: 'Anthropic (Claude)' },
      { value: 'openai', label: 'OpenAI' },
    ],
    help: 'Which provider’s key/model below the assistant uses.',
  },
  {
    key: 'ASSISTANT_SYSTEM_PROMPT',
    label: 'System prompt',
    type: 'textarea',
    category: 'ai',
    rows: 5,
    help: 'Instance-wide persona and guardrails prepended to every conversation.',
  },
  {
    key: 'ASSISTANT_EFFORT',
    label: 'Reasoning effort',
    type: 'select',
    category: 'ai',
    default: 'high',
    options: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High (default)' },
      { value: 'xhigh', label: 'Extra high' },
      { value: 'max', label: 'Max' },
    ],
  },
  {
    key: 'ASSISTANT_MAX_TOKENS',
    label: 'Max output tokens',
    type: 'text',
    category: 'ai',
    help: 'Cap per reply. Default 8000.',
  },
  {
    key: 'ASSISTANT_ALLOW_TOOLS',
    label: 'Allow agentic tools (search wiki, create issue…)',
    type: 'toggle',
    category: 'ai',
  },
  {
    key: 'ASSISTANT_RATE_LIMIT_PER_MIN',
    label: 'Rate limit (messages / user / min)',
    type: 'text',
    category: 'ai',
    help: 'Per-user throttle. Default 20.',
  },
];

// Provider credentials — secrets, stored encrypted.
const PROVIDER_FIELDS: ConfigField[] = [
  { key: 'ANTHROPIC_API_KEY', label: 'Anthropic (Claude) API key', type: 'password', category: 'ai' },
  { key: 'ANTHROPIC_MODEL', label: 'Claude model', type: 'text', category: 'ai', help: 'e.g. claude-opus-4-8' },
  { key: 'OPENAI_API_KEY', label: 'OpenAI API key', type: 'password', category: 'ai' },
  { key: 'OPENAI_MODEL', label: 'OpenAI model', type: 'text', category: 'ai', help: 'e.g. gpt-4o-mini' },
];

export default function AiPage() {
  return (
    <>
      <PageHeader
        title="AI Assistant"
        description="Enable the assistant, tune its behaviour, and set provider credentials."
      />
      <div className="space-y-8">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-fg">Assistant</h2>
          <ConfigForm fields={ASSISTANT_FIELDS} />
        </section>
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-fg">Provider credentials</h2>
          <ConfigForm fields={PROVIDER_FIELDS} />
        </section>
      </div>
    </>
  );
}
