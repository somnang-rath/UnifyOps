'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Copy, Download, FileSpreadsheet, Pencil, Plus, Search, Trash2, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Confirm } from '@/components/ui/confirm';
import { Field, Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { SheetsShell } from '@/components/feature/sheets/sheets-shell';
import {
  useWorkbookMutations,
  useWorkbooks,
} from '@/hooks/use-workbooks';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { WorkbookSummary } from '@/schemas/workbook';

export default function TablesPage() {
  const { data: workbooks = [], isLoading, isFetching } = useWorkbooks();
  const { create, remove, copy, update } = useWorkbookMutations();

  const searchParams = useSearchParams();
  const [activeId, setActiveId] = useState<string | null>(() => searchParams.get('open'));
  const persistRef = useRef(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState<WorkbookSummary | null>(null);
  const [search, setSearch] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const filteredWorkbooks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return workbooks;
    return workbooks.filter((w) => w.name.toLowerCase().includes(q));
  }, [workbooks, search]);

  useEffect(() => {
    if (!isLoading && !isFetching && activeId && !workbooks.find((w) => w._id === activeId))
      setActiveId(null);
  }, [activeId, workbooks, isLoading, isFetching]);

  // Restore the last-open workbook on mount so switching pages and coming back
  // keeps your place. A `?open=` URL param (set at initial state) wins; otherwise
  // fall back to the persisted id. (localStorage is unavailable during SSR.)
  useEffect(() => {
    try {
      if (activeId) localStorage.setItem('tables-active-id', activeId);
      else {
        const saved = localStorage.getItem('tables-active-id');
        if (saved) setActiveId(saved);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the open workbook so it re-opens when returning to this page.
  useEffect(() => {
    if (!persistRef.current) {
      persistRef.current = true;
      return;
    }
    try {
      if (activeId) localStorage.setItem('tables-active-id', activeId);
      else localStorage.removeItem('tables-active-id');
    } catch {}
  }, [activeId]);

  const downloadXlsx = async (w: WorkbookSummary) => {
    const blob = await api
      .get<Blob>(`/workbooks/${w._id}/export.xlsx`, { responseType: 'blob' })
      .then((r) => r.data);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${w.name}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onCreate = async () => {
    const finalName = name.trim() || 'Untitled spreadsheet';
    const wb = await create.mutateAsync({ name: finalName });
    setActiveId(wb._id);
    setName('');
    setCreating(false);
  };

  const startRename = (w: WorkbookSummary) => {
    setRenamingId(w._id);
    setRenameValue(w.name);
  };

  const commitRename = () => {
    if (!renamingId) return;
    const v = renameValue.trim();
    if (v) update.mutate({ id: renamingId, body: { name: v } });
    setRenamingId(null);
  };

  if (activeId) {
    return <SheetsShell workbookId={activeId} onBack={() => setActiveId(null)} />;
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-[24px] font-bold tracking-[-.02em] leading-[1.2]">
            Spreadsheets
          </h1>
          <p className="text-[13px] text-text-muted mt-1">
            A familiar spreadsheet for tracking numbers, lists, and plans.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {workbooks.length > 0 && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="h-9 pl-8 pr-3 text-[13px] rounded-md border border-border bg-bg-input outline-none focus:border-accent w-44"
              />
            </div>
          )}
          <Button variant="grad" onClick={() => setCreating(true)}>
            <Plus className="w-3.5 h-3.5" /> New spreadsheet
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-text-muted text-[13px]">Loading…</div>
      ) : workbooks.length === 0 ? (
        <div className="flex flex-col items-center text-center gap-3 py-16 bg-bg-card border border-border rounded-lg">
          <div className="w-14 h-14 rounded-full flex items-center justify-center bg-[color:color-mix(in_srgb,var(--a)_10%,transparent)]">
            <FileSpreadsheet className="w-7 h-7 text-accent" />
          </div>
          <h3 className="text-[16px] font-semibold">No spreadsheets yet</h3>
          <p className="text-[13px] text-text-muted max-w-[340px]">
            Create your first spreadsheet to capture data with rows, columns,
            and formulas.
          </p>
          <Button variant="grad" onClick={() => setCreating(true)}>
            <Plus className="w-3.5 h-3.5" /> New spreadsheet
          </Button>
        </div>
      ) : filteredWorkbooks.length === 0 ? (
        <div className="text-[13px] text-text-muted py-8 text-center">
          No spreadsheets match &ldquo;{search}&rdquo;
        </div>
      ) : (
        <WorkbookSections
          workbooks={filteredWorkbooks}
          renamingId={renamingId}
          renameValue={renameValue}
          onRenameValueChange={setRenameValue}
          onStartRename={startRename}
          onCommitRename={commitRename}
          onOpen={setActiveId}
          onDelete={setDeleting}
          onCopy={(id) => copy.mutate(id)}
          onDownload={downloadXlsx}
        />
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New spreadsheet"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={onCreate}>
              Create
            </Button>
          </>
        }
      >
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Untitled spreadsheet"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && onCreate()}
          />
        </Field>
      </Modal>

      <Confirm
        open={!!deleting}
        title="Delete spreadsheet"
        body={
          <>
            Permanently delete <strong>{deleting?.name}</strong>?
          </>
        }
        danger
        onConfirm={() => deleting && remove.mutate(deleting._id)}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}

const ACCESS_CHIP_LABEL: Record<'read' | 'edit', string> = {
  read: 'Read',
  edit: 'Edit',
};

function WorkbookSections({
  workbooks,
  renamingId,
  renameValue,
  onRenameValueChange,
  onStartRename,
  onCommitRename,
  onOpen,
  onDelete,
  onCopy,
  onDownload,
}: {
  workbooks: WorkbookSummary[];
  renamingId: string | null;
  renameValue: string;
  onRenameValueChange: (v: string) => void;
  onStartRename: (w: WorkbookSummary) => void;
  onCommitRename: () => void;
  onOpen: (id: string) => void;
  onDelete: (w: WorkbookSummary) => void;
  onCopy: (id: string) => void;
  onDownload: (w: WorkbookSummary) => void;
}) {
  const own = useMemo(
    () => workbooks.filter((w) => w._access === 'owner'),
    [workbooks],
  );
  const shared = useMemo(
    () => workbooks.filter((w) => w._access && w._access !== 'owner'),
    [workbooks],
  );

  return (
    <div className="space-y-6">
      {own.length > 0 && (
        <WorkbookGrid
          workbooks={own}
          renamingId={renamingId}
          renameValue={renameValue}
          onRenameValueChange={onRenameValueChange}
          onStartRename={onStartRename}
          onCommitRename={onCommitRename}
          onOpen={onOpen}
          onDelete={onDelete}
          onCopy={onCopy}
          onDownload={onDownload}
          isOwned
        />
      )}
      {shared.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-3 text-[10.5px] font-bold uppercase tracking-[.06em] text-text-muted">
            <Users className="w-3 h-3" />
            Shared with me
          </div>
          <WorkbookGrid
            workbooks={shared}
            renamingId={renamingId}
            renameValue={renameValue}
            onRenameValueChange={onRenameValueChange}
            onStartRename={onStartRename}
            onCommitRename={onCommitRename}
            onOpen={onOpen}
            onDelete={onDelete}
            onCopy={onCopy}
            onDownload={onDownload}
            isOwned={false}
          />
        </div>
      )}
    </div>
  );
}

function WorkbookGrid({
  workbooks,
  renamingId,
  renameValue,
  onRenameValueChange,
  onStartRename,
  onCommitRename,
  onOpen,
  onDelete,
  onCopy,
  onDownload,
  isOwned,
}: {
  workbooks: WorkbookSummary[];
  renamingId: string | null;
  renameValue: string;
  onRenameValueChange: (v: string) => void;
  onStartRename: (w: WorkbookSummary) => void;
  onCommitRename: () => void;
  onOpen: (id: string) => void;
  onDelete: (w: WorkbookSummary) => void;
  onCopy: (id: string) => void;
  onDownload: (w: WorkbookSummary) => void;
  isOwned: boolean;
}) {
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
      {workbooks.map((w) => {
        const chip =
          w._access && w._access !== 'owner'
            ? ACCESS_CHIP_LABEL[w._access]
            : null;
        const isRenaming = renamingId === w._id;

        return (
          <div
            key={w._id}
            className={cn(
              'bg-bg-card border border-border rounded-lg p-5 text-left transition-all duration-[var(--dur)] group',
              'hover:-translate-y-px hover:shadow-sm hover:border-accent',
            )}
          >
            <button
              onClick={() => !isRenaming && onOpen(w._id)}
              className="block w-full text-left"
            >
              <div className="flex items-start justify-between mb-2">
                <FileSpreadsheet className="w-5 h-5 text-[#0f9d58]" />
                <span className="text-[10px] text-text-muted">
                  {fmtDate(w.updatedAt)}
                </span>
              </div>
            </button>

            {isRenaming ? (
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => onRenameValueChange(e.target.value)}
                onBlur={onCommitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onCommitRename();
                  if (e.key === 'Escape') onRenameValueChange(w.name);
                }}
                className="block w-full text-[15px] font-semibold mb-1 px-1.5 py-0.5 rounded border border-accent bg-bg-input outline-none"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <button
                onClick={() => onOpen(w._id)}
                className="block w-full text-left"
              >
                <strong className="block text-[15px] font-semibold mb-1 truncate">
                  {w.name}
                </strong>
              </button>
            )}

            <div className="flex items-center gap-1.5">
              <span className="text-[12px] text-text-muted">
                {w.sheets.length} sheet{w.sheets.length === 1 ? '' : 's'}
              </span>
              {chip && (
                <span className="text-[9.5px] uppercase tracking-wider text-text-muted bg-bg-subtle border border-border px-1.5 py-[1px] rounded-xs">
                  {chip}
                </span>
              )}
            </div>

            {isOwned && (
              <div className="flex justify-end gap-1 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => { e.stopPropagation(); onStartRename(w); }}
                  className="text-text-muted hover:text-text p-1 rounded hover:bg-bg-hover"
                  title="Rename"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDownload(w); }}
                  className="text-text-muted hover:text-green-600 p-1 rounded hover:bg-bg-hover"
                  title="Export as .xlsx"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onCopy(w._id); }}
                  className="text-text-muted hover:text-text p-1 rounded hover:bg-bg-hover"
                  title="Duplicate"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(w); }}
                  className="text-text-muted hover:text-red-500 p-1 rounded hover:bg-bg-hover"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
