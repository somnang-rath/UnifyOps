'use client';
import { useRef, useState } from 'react';
import { Upload, Link2, FileText, AlertCircle, ChevronDown } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { parseCSV, parseTSV } from '@/lib/sheets/clipboard';
import type { Cell } from '@/schemas/workbook';
import { cn } from '@/lib/utils';

type Tab = 'file' | 'url';

export interface ImportResult {
  cells: (Cell | null | undefined)[][];
  merges?: Array<{ r1: number; c1: number; r2: number; c2: number }>;
  colWidths?: Record<string, number>;
  rowHeights?: Record<string, number>;
}

interface XlsxSheet {
  name: string;
  rows: number;
  cols: number;
  cells: (Cell | null)[][];
  colWidths: Record<string, number>;
  rowHeights: Record<string, number>;
  merges: Array<{ r1: number; c1: number; r2: number; c2: number }>;
}

interface Preview {
  result: ImportResult;
  rows: number;
  cols: number;
  /** Available sheets from XLSX; empty for CSV */
  sheets?: XlsxSheet[];
  selectedSheet?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onImport: (result: ImportResult) => void;
}

export function ImportModal({ open, onClose, onImport }: Props) {
  const [tab, setTab] = useState<Tab>('file');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setPreview(null);
    setError(null);
    setUrl('');
    setLoading(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  function handleClose() { reset(); onClose(); }

  function sheetToResult(s: XlsxSheet): ImportResult {
    return {
      cells: s.cells,
      merges: s.merges,
      colWidths: s.colWidths,
      rowHeights: s.rowHeights,
    };
  }

  function selectSheet(sheets: XlsxSheet[], idx: number) {
    const s = sheets[idx];
    setPreview({
      result: sheetToResult(s),
      rows: s.rows, cols: s.cols,
      sheets, selectedSheet: idx,
    });
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setPreview(null);

    const ext = file.name.split('.').pop()?.toLowerCase();

    // ── XLSX / XLS → backend parse (styles preserved) ──
    if (ext === 'xlsx' || ext === 'xls') {
      setLoading(true);
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await api.post<{ sheets: XlsxSheet[] }>(
          '/workbooks/import-xlsx',
          fd,
          { headers: { 'Content-Type': 'multipart/form-data' } },
        );
        const sheets = res.data.sheets;
        if (!sheets?.length) { setError('File contains no sheets.'); return; }
        selectSheet(sheets, 0);
      } catch (err: any) {
        setError(
          err?.response?.data?.message ?? 'Failed to parse the XLSX file.',
        );
      } finally {
        setLoading(false);
      }
      return;
    }

    // ── CSV / TSV → parse client-side (values only) ──
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      try {
        const cells = ext === 'tsv' ? parseTSV(text) : parseCSV(text);
        if (cells.length === 0) { setError('File is empty.'); return; }
        const result: ImportResult = { cells };
        setPreview({ result, rows: cells.length, cols: Math.max(0, ...cells.map((r) => r.length)) });
        setError(null);
      } catch {
        setError('Could not parse file. Make sure it is a valid CSV.');
      }
    };
    reader.readAsText(file);
  }

  async function handleFetchUrl() {
    const trimmed = url.trim();
    if (!trimmed) return;

    const idMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (!idMatch) {
      setError('Invalid Google Sheets URL. Copy the full URL from your browser address bar.');
      return;
    }

    const id = idMatch[1];
    const gidMatch = trimmed.match(/[#?&]gid=(\d+)/);
    const gidParam = gidMatch ? `&gid=${gidMatch[1]}` : '';

    const candidates = [
      `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv${gidParam}`,
      `https://docs.google.com/spreadsheets/d/${id}/pub?output=csv${gidParam}`,
    ];

    setLoading(true);
    setError(null);
    setPreview(null);

    for (const fetchUrl of candidates) {
      try {
        const res = await fetch(fetchUrl);
        if (!res.ok) continue;
        const ct = res.headers.get('content-type') ?? '';
        const text = await res.text();
        if (ct.includes('text/html') || text.trimStart().startsWith('<')) continue;
        const cells = parseCSV(text);
        if (cells.length === 0) { setError('Sheet appears to be empty.'); setLoading(false); return; }
        const result: ImportResult = { cells };
        setPreview({ result, rows: cells.length, cols: Math.max(0, ...cells.map((r) => r.length)) });
        setLoading(false);
        return;
      } catch {
        // CORS/network — try next
      }
    }

    setLoading(false);
    setError(
      'Could not access this sheet. The sheet must be published to the web. ' +
      'In Google Sheets: File → Share → Publish to web → Comma-separated values → Publish, then paste that URL. ' +
      'For styles, use the "Upload File" tab: File → Download → Microsoft Excel (.xlsx).',
    );
  }

  function handleImport() {
    if (!preview) return;
    onImport(preview.result);
    handleClose();
  }

  const hasSheets = (preview?.sheets?.length ?? 0) > 1;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Import into sheet"
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button variant="grad" disabled={!preview || loading} onClick={handleImport}>
            {preview
              ? `Import (${preview.rows} rows × ${preview.cols} cols)`
              : 'Import'}
          </Button>
        </>
      }
    >
      {/* Tabs */}
      <div className="flex gap-1 border-b border-border -mx-6 px-6 pb-0 mb-1">
        {([['file', 'Upload File'], ['url', 'Google Sheets URL']] as [Tab, string][]).map(
          ([t, label]) => (
            <button
              key={t}
              type="button"
              onClick={() => { setTab(t); setPreview(null); setError(null); }}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium border-b-2 -mb-px transition-colors',
                tab === t
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-sub hover:text-text',
              )}
            >
              {t === 'file' ? <FileText className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />}
              {label}
            </button>
          ),
        )}
      </div>

      {/* Upload File tab */}
      {tab === 'file' && (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-text-sub">
            Upload an <strong>.xlsx</strong> file to preserve colors, bold, fonts and all styles.
            CSV/TSV imports values only.
          </p>
          <label className={cn(
            'flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg p-8 cursor-pointer transition-colors',
            'hover:border-accent hover:bg-bg-subtle',
            loading && 'pointer-events-none opacity-60',
          )}>
            <Upload className="w-8 h-8 text-text-muted" />
            <span className="text-[13px] text-text-sub">
              {loading ? 'Parsing file…' : 'Click to choose a file, or drag and drop here'}
            </span>
            <span className="text-[11px] text-text-muted">.xlsx · .csv · .tsv</span>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv,.tsv,text/csv"
              className="hidden"
              onChange={handleFile}
            />
          </label>
          <div className="text-[12px] text-text-muted flex flex-col gap-0.5">
            <p><strong>With styles:</strong> Google Sheets → File → Download → Microsoft Excel (.xlsx)</p>
            <p><strong>Values only:</strong> Google Sheets → File → Download → Comma Separated Values (.csv)</p>
          </div>
        </div>
      )}

      {/* Google Sheets URL tab */}
      {tab === 'url' && (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-text-sub">
            Paste a published Google Sheets link <span className="text-text-muted">(values only — for styles, download .xlsx and use Upload File)</span>.
          </p>
          <div className="flex gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleFetchUrl()}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="flex-1 px-3 py-2 text-[13px] border border-border rounded-lg bg-bg-input outline-none focus:border-accent"
            />
            <Button variant="primary" onClick={handleFetchUrl} disabled={loading || !url.trim()}>
              {loading ? 'Fetching…' : 'Fetch'}
            </Button>
          </div>
          <p className="text-[12px] text-text-muted">
            In Google Sheets: <strong>File → Share → Publish to web → CSV → Publish</strong>, then paste the URL.
          </p>
        </div>
      )}

      {/* Sheet selector (multi-sheet XLSX) */}
      {hasSheets && preview?.sheets && (
        <div className="flex flex-col gap-1">
          <label className="text-[12px] font-medium text-text-sub">Select sheet to import</label>
          <div className="relative">
            <select
              value={preview.selectedSheet ?? 0}
              onChange={(e) => selectSheet(preview.sheets!, Number(e.target.value))}
              className="w-full appearance-none px-3 py-2 pr-8 text-[13px] border border-border rounded-lg bg-bg-input outline-none focus:border-accent"
            >
              {preview.sheets.map((s, i) => (
                <option key={i} value={i}>{s.name} ({s.rows} rows × {s.cols} cols)</option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-text-muted absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Preview */}
      {preview && !error && (
        <div className="flex items-center gap-2 px-3 py-2.5 bg-green-50 border border-green-200 rounded-lg text-[13px] text-green-700">
          <FileText className="w-4 h-4 flex-shrink-0" />
          Ready: <strong>{preview.rows} rows × {preview.cols} cols</strong>
          {preview.result.merges?.length ? ` · ${preview.result.merges.length} merged cells` : ''}
          {' '}— will replace content starting at A1.
        </div>
      )}
    </Modal>
  );
}
