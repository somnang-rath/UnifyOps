'use client';

import * as React from 'react';
import { Plus, Search, Settings, Trash2 } from 'lucide-react';
import {
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Checkbox,
  CommandPalette,
  Field,
  FilterBar,
  FilterChip,
  FilterSpacer,
  IconButton,
  Input,
  InputWithIcon,
  Kbd,
  Label,
  Modal,
  Radio,
  SearchInput,
  Separator,
  SidebarItem,
  SidebarNav,
  SidebarSection,
  Skeleton,
  Spinner,
  StateBadge,
  Switch,
  TBody,
  THead,
  TRow,
  Table,
  Tabs,
  Textarea,
  Tooltip,
  type WorkItemState,
} from '@prism/ui';
import { useThemeStore } from '@/stores/theme-store';

/**
 * Component gallery — every primitive, every state, on one page.
 *
 * This is the cheap version of a Storybook: when a token changes (a control
 * height, a radius, the focus ring), this is the screen that shows what it did
 * to everything at once. Dev-only surface; it ships nothing to users.
 */

const STATES: WorkItemState[] = [
  'backlog',
  'unstarted',
  'started',
  'completed',
  'cancelled',
];

/** Static demo commands for the shared ⌘K palette (onSelect added at render). */
const PALETTE_DEMO = [
  { group: 'Navigate', icon: <Settings className="w-[15px] h-[15px]" />, title: 'Go to Settings' },
  { group: 'Navigate', icon: <Search className="w-[15px] h-[15px]" />, title: 'Go to Search' },
  { group: 'Create', icon: <Plus className="w-[15px] h-[15px]" />, title: 'New work item', badge: 'C' },
  { group: 'Actions', icon: <Trash2 className="w-[15px] h-[15px]" />, title: 'Delete something' },
];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-border last:border-0">
      <span className="w-28 shrink-0 text-2xs text-text-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-bg-card p-4">
      <h2 className="mb-2 text-md font-semibold text-text">{title}</h2>
      {children}
    </section>
  );
}

export default function UiGalleryPage() {
  const { density, setDensity } = useThemeStore();
  const [modal, setModal] = React.useState(false);
  const [palette, setPalette] = React.useState(false);
  const [paletteQ, setPaletteQ] = React.useState('');
  const [tab, setTab] = React.useState('list');
  const [checked, setChecked] = React.useState(true);
  const [on, setOn] = React.useState(true);

  return (
    <div className="mx-auto max-w-[900px] space-y-4 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">UI gallery</h1>
          <p className="text-xs text-text-muted">
            @prism/ui — the same components web, admin, and space render.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="density">Density</Label>
          <Tabs
            aria-label="Density"
            variant="pill"
            value={density}
            onValueChange={(v) => setDensity(v as typeof density)}
            items={[
              { value: 'compact', label: 'Compact' },
              { value: 'comfy', label: 'Comfy' },
            ]}
          />
        </div>
      </header>

      <Section title="Button">
        <Row label="variant">
          <Button variant="primary">Primary</Button>
          <Button variant="success">Success</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="subtle">Subtle</Button>
        </Row>
        <Row label="size">
          <Button size="xs">xs · 22</Button>
          <Button size="sm">sm · 26</Button>
          <Button size="md">md · 30</Button>
          <Button size="lg">lg · 36</Button>
        </Row>
        <Row label="with icon">
          <Button variant="primary" size="sm">
            <Plus /> New
          </Button>
          <Button variant="outline" size="sm">
            <Settings /> Settings
          </Button>
          <Button variant="danger" size="sm">
            <Trash2 /> Delete
          </Button>
        </Row>
        <Row label="state">
          <Button disabled>Disabled</Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <Button variant="outline">
            <Spinner /> Loading
          </Button>
        </Row>
        <Row label="icon only">
          <IconButton aria-label="Add" size="xs">
            <Plus />
          </IconButton>
          <IconButton aria-label="Add" size="sm">
            <Plus />
          </IconButton>
          <IconButton aria-label="Add" size="md" variant="outline">
            <Plus />
          </IconButton>
          <Tooltip label="With tooltip">
            <IconButton aria-label="Settings" variant="outline">
              <Settings />
            </IconButton>
          </Tooltip>
        </Row>
      </Section>

      <Section title="Form">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Label" hint="(hint)">
            <Input placeholder="Placeholder" />
          </Field>
          <Field label="Required" required>
            <Input placeholder="30px tall" />
          </Field>
          <Field label="With error" error="This field is required">
            <Input defaultValue="Bad value" />
          </Field>
          <Field label="Disabled">
            <Input disabled defaultValue="Disabled" />
          </Field>
          <Field label="Textarea" className="col-span-2">
            <Textarea placeholder="Multi-line" rows={2} />
          </Field>
        </div>
        <Row label="variants">
          <InputWithIcon icon={<Search />} placeholder="With icon" />
          <SearchInput placeholder="Search…" />
        </Row>
        <Row label="toggles">
          <Checkbox
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <Checkbox checked={false} readOnly />
          <Checkbox disabled />
          <Radio name="demo" defaultChecked />
          <Radio name="demo" />
          <Switch checked={on} onCheckedChange={setOn} aria-label="Toggle" />
          <Switch checked={false} onCheckedChange={() => {}} aria-label="Off" />
          <Switch
            checked
            onCheckedChange={() => {}}
            disabled
            aria-label="Disabled"
          />
        </Row>
      </Section>

      <Section title="Data display">
        <Row label="badge">
          <Badge>Neutral</Badge>
          <Badge variant="accent">Accent</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="danger">Danger</Badge>
          <Badge variant="outline">Outline</Badge>
        </Row>
        <Row label="state">
          {STATES.map((s) => (
            <StateBadge key={s} state={s} />
          ))}
        </Row>
        <Row label="avatar">
          <Avatar name="Ada Lovelace" size="xs" />
          <Avatar name="Grace Hopper" size="sm" />
          <Avatar name="Alan Turing" size="md" />
          <Avatar name="Katherine Johnson" size="lg" />
          <AvatarGroup
            people={[
              { name: 'Ada Lovelace' },
              { name: 'Grace Hopper' },
              { name: 'Alan Turing' },
              { name: 'Linus T' },
              { name: 'Ken T' },
            ]}
          />
        </Row>
        <Row label="misc">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
          <Separator orientation="vertical" className="h-4" />
          <Spinner />
          <Skeleton className="h-4 w-24" />
        </Row>
      </Section>

      <Section title="Table">
        <Table>
          <THead>
            <tr>
              <th>Title</th>
              <th>State</th>
              <th>Assignee</th>
              <th className="text-right">Points</th>
            </tr>
          </THead>
          <TBody>
            {[
              ['Fix login redirect', 'started', 'Ada Lovelace', 3],
              ['Add audit trail', 'completed', 'Grace Hopper', 5],
              ['Drop localStorage token', 'backlog', 'Alan Turing', 2],
            ].map(([title, state, who, pts], i) => (
              <TRow key={String(title)} selected={i === 1}>
                <td className="font-medium">{title}</td>
                <td>
                  <StateBadge state={state as WorkItemState} />
                </td>
                <td>
                  <span className="inline-flex items-center gap-1.5">
                    <Avatar name={String(who)} size="xs" />
                    <span className="text-text-sub">{who}</span>
                  </span>
                </td>
                <td className="text-right">{pts}</td>
              </TRow>
            ))}
          </TBody>
        </Table>
      </Section>

      <Section title="Navigation & overlay">
        <Row label="tabs (line)">
          <Tabs
            aria-label="Layout"
            value={tab}
            onValueChange={setTab}
            items={[
              { value: 'list', label: 'List', count: 24 },
              { value: 'board', label: 'Board', count: 8 },
              { value: 'calendar', label: 'Calendar' },
              { value: 'gantt', label: 'Gantt', disabled: true },
            ]}
          />
        </Row>
        <Row label="tabs (pill)">
          <Tabs
            aria-label="Filter"
            variant="pill"
            value={tab}
            onValueChange={setTab}
            items={[
              { value: 'list', label: 'All' },
              { value: 'board', label: 'Mine' },
            ]}
          />
        </Row>
        <Row label="modal">
          <Button variant="outline" onClick={() => setModal(true)}>
            Open modal
          </Button>
        </Row>
        <Row label="⌘K palette">
          <Button variant="outline" onClick={() => setPalette(true)}>
            Open command palette
          </Button>
          <span className="text-2xs text-text-muted">
            ↑↓ navigate · ↵ run · Esc close
          </span>
        </Row>
      </Section>

      <Section title="FilterBar (Tier 3)">
        <FilterBar className="rounded-md border border-border px-2">
          <FilterChip label="State" active onRemove={() => {}}>
            Started
          </FilterChip>
          <FilterChip label="Priority" onRemove={() => {}}>
            Urgent
          </FilterChip>
          <FilterChip icon={<Search className="w-3 h-3" />} onClick={() => {}}>
            Saved view
          </FilterChip>
          <FilterSpacer />
          <Button size="sm" variant="ghost">
            Group: status
          </Button>
          <Button size="sm" variant="ghost">
            Sort: newest
          </Button>
        </FilterBar>
      </Section>

      <Section title="SidebarNav (Tier 3)">
        <div className="flex gap-4">
          {[false, true].map((collapsed) => (
            <div
              key={String(collapsed)}
              className={
                'rounded-md border border-border bg-bg-subtle py-2 ' +
                (collapsed ? 'w-12' : 'w-52')
              }
            >
              <SidebarNav className="pb-2">
                <SidebarSection label="Workspace" collapsed={collapsed}>
                  <SidebarItem
                    icon={<Settings className="w-4 h-4" />}
                    label="Active + badge"
                    active
                    collapsed={collapsed}
                    badge={12}
                  />
                  <SidebarItem
                    icon={<Plus className="w-4 h-4" />}
                    label="Default"
                    collapsed={collapsed}
                  />
                  <SidebarItem
                    icon={<Trash2 className="w-4 h-4" />}
                    label="Overflow badge"
                    collapsed={collapsed}
                    badge={120}
                  />
                </SidebarSection>
              </SidebarNav>
            </div>
          ))}
        </div>
      </Section>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="Delete work item?"
        description="This cannot be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => setModal(false)}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-sub">
          Escape closes this, Tab is trapped inside, and focus returns to the
          button that opened it.
        </p>
      </Modal>

      <CommandPalette
        open={palette}
        onClose={() => setPalette(false)}
        items={PALETTE_DEMO.filter(
          (i) =>
            !paletteQ.trim() ||
            i.title.toLowerCase().includes(paletteQ.toLowerCase().trim()),
        ).map((i) => ({ ...i, onSelect: () => setPalette(false) }))}
        query={paletteQ}
        onQueryChange={setPaletteQ}
      />
    </div>
  );
}
