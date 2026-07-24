'use client';
import { useState } from 'react';
import Link from 'next/link';
import { GitBranch, Link2, Plus, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/feature/issue/pills';
import { IssueTypeIcon } from '@/components/feature/issue/icons';
import {
  useIssueChildren,
  useIssueRelations,
  useRelationMutations,
  type CreatableRelation,
  type LinkedIssue,
  type RelationKind,
} from '@/hooks/use-issue-links';

type IssueType = 'bug' | 'feature' | 'task' | 'docs';

/** Matches the local CardHeader in the issue detail page for a consistent look. */
function SectionHeader({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border [&_svg]:w-3.5 [&_svg]:h-3.5 [&_svg]:text-text-muted">
      {icon}
      <span className="text-[11.5px] font-semibold text-text-muted uppercase tracking-wider">
        {title}
      </span>
      {children}
    </div>
  );
}

/** How each relation kind reads as a heading, in display order. */
const RELATION_LABEL: Record<RelationKind, string> = {
  blocks: 'Blocks',
  blocked_by: 'Blocked by',
  relates_to: 'Relates to',
  duplicate: 'Duplicate of',
};
const RELATION_ORDER: RelationKind[] = [
  'blocks',
  'blocked_by',
  'relates_to',
  'duplicate',
];

function LinkedRow({
  issue,
  onRemove,
}: {
  issue: LinkedIssue;
  onRemove?: () => void;
}) {
  return (
    <div className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-bg-hover transition-colors">
      <IssueTypeIcon type={issue.type as IssueType} size={16} className="shrink-0" />
      <Link
        href={`/issues/${issue._id}`}
        className="flex-1 min-w-0 truncate text-[13px] text-text hover:text-accent"
      >
        {issue.title}
      </Link>
      <StatusPill status={issue.status} />
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove link"
          className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red transition-opacity"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

/**
 * Sub-issues and relations for one work item (docs/plan/03-feature-parity.md §1).
 *
 * Reads through the same endpoints the API access-gates, so it only ever shows
 * links to issues the viewer may already see.
 */
export function IssueLinks({ issueId }: { issueId: string }) {
  const children = useIssueChildren(issueId);
  const relations = useIssueRelations(issueId);
  const { add, remove } = useRelationMutations(issueId);

  const [linking, setLinking] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [type, setType] = useState<CreatableRelation>('relates_to');

  const rollup = children.data?.rollup;
  const kids = children.data?.items ?? [];
  const rels = relations.data ?? {};
  const hasRelations = RELATION_ORDER.some((k) => (rels[k]?.length ?? 0) > 0);

  const submitLink = () => {
    const id = targetId.trim();
    if (!/^[0-9a-fA-F]{24}$/.test(id)) return;
    add.mutate(
      { targetId: id, type },
      {
        onSuccess: () => {
          setTargetId('');
          setLinking(false);
        },
      },
    );
  };

  return (
    <Card>
      <SectionHeader icon={<GitBranch />} title="Sub-issues & relations">
        <div className="ml-auto flex items-center gap-2">
          {rollup && rollup.total > 0 && (
            <span className="text-[11px] font-mono text-text-muted">
              {rollup.done}/{rollup.total} done
            </span>
          )}
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setLinking((v) => !v)}
            aria-expanded={linking}
          >
            <Link2 /> Link
          </Button>
        </div>
      </SectionHeader>

      <div className="px-4 py-2.5 flex flex-col gap-3">
        {/* Add-relation row */}
        {linking && (
          <div className="flex items-center gap-2 p-2 rounded-md bg-bg-subtle">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as CreatableRelation)}
              aria-label="Relation type"
              className="h-ctl-sm rounded-md border border-border bg-bg-input px-2 text-xs text-text"
            >
              <option value="relates_to">Relates to</option>
              <option value="blocks">Blocks</option>
              <option value="duplicate">Duplicate of</option>
            </select>
            <input
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              placeholder="Paste issue ID (24 hex)"
              aria-label="Target issue id"
              className="flex-1 h-ctl-sm rounded-md border border-border bg-bg-input px-2 text-xs text-text placeholder:text-text-muted"
              onKeyDown={(e) => e.key === 'Enter' && submitLink()}
            />
            <Button size="sm" variant="primary" onClick={submitLink} disabled={add.isPending}>
              <Plus /> Add
            </Button>
          </div>
        )}

        {/* Sub-issues */}
        {kids.length > 0 && (
          <div>
            <p className="px-2 pb-1 text-2xs font-medium uppercase tracking-wide text-text-muted">
              Sub-issues
            </p>
            {kids.map((k) => (
              <LinkedRow key={k._id} issue={k} />
            ))}
          </div>
        )}

        {/* Relations, grouped by kind */}
        {RELATION_ORDER.map((kind) => {
          const list = rels[kind];
          if (!list?.length) return null;
          return (
            <div key={kind}>
              <p className="px-2 pb-1 text-2xs font-medium uppercase tracking-wide text-text-muted">
                {RELATION_LABEL[kind]}
              </p>
              {list.map(({ relationId, issue }) => (
                <LinkedRow
                  key={relationId}
                  issue={issue}
                  onRemove={() => remove.mutate(relationId)}
                />
              ))}
            </div>
          );
        })}

        {kids.length === 0 && !hasRelations && !linking && (
          <p className="px-2 py-4 text-center text-xs text-text-muted">
            No sub-issues or relations yet.
          </p>
        )}
      </div>
    </Card>
  );
}
