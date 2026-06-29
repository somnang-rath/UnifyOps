/**
 * Excel-style header / footer token expansion.
 * Supported tokens: &[Page] &[Pages] &[Date] &[Time] &[Tab] &[File]
 */
export interface HeaderFooterContext {
  page: number;
  pages: number;
  date: string;
  time: string;
  tab: string; // sheet name
  file: string; // workbook name
}

export function expandTokens(text: string, ctx: HeaderFooterContext): string {
  if (!text) return '';
  return text
    .replace(/&\[Pages\]/gi, String(ctx.pages))
    .replace(/&\[Page\]/gi, String(ctx.page))
    .replace(/&\[Date\]/gi, ctx.date)
    .replace(/&\[Time\]/gi, ctx.time)
    .replace(/&\[Tab\]/gi, ctx.tab)
    .replace(/&\[File\]/gi, ctx.file);
}

/** Token chips offered by the header/footer editor toolbar. */
export const HEADER_FOOTER_TOKENS: Array<{ label: string; token: string }> = [
  { label: 'Page', token: '&[Page]' },
  { label: 'of Y', token: 'of &[Pages]' },
  { label: 'Date', token: '&[Date]' },
  { label: 'Time', token: '&[Time]' },
  { label: 'Sheet', token: '&[Tab]' },
  { label: 'File', token: '&[File]' },
];
