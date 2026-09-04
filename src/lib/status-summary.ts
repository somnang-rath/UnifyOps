/**
 * §7.4's "Copy status summary → markdown to clipboard, ready to paste in chat".
 *
 * Pure, and in `src/lib` for the reason everything else here is: the server
 * composes the text and the browser puts it on the clipboard, and a second
 * implementation would be a second set of numbers to keep in step.
 *
 * **The labels arrive already translated**, as strings and closures rather than
 * as message keys. That keeps this function language-agnostic — it can be tested
 * without a translator, and it cannot be the place a Khmer workspace silently
 * gets an English word (§13). It is the same shape `describeSize` uses in
 * `attachments.ts`: return the pieces, let the caller phrase them.
 *
 * **It carries numbers and never item titles.** A status summary is pasted into
 * a group chat, and a chat is not the access-control boundary the product is —
 * a line naming every task would leak the contents of a private project to
 * whoever is in that channel. Counts describe the shape of the week without
 * saying what anybody is working on.
 */

export type SummaryColumn = {
  /** A member id, or the `none` sentinel for the unassigned column. */
  key: string;
  name: string;
  open: number;
  overdue: number;
  away: boolean;
  unavailableUntil: string | null;
};

export function summaryMarkdown(input: {
  title: string;
  scope: string;
  columns: readonly SummaryColumn[];
  unassignedLabel: string;
  awayLabel: (date: string) => string;
  overdueLabel: (count: number) => string;
  emptyLabel: string;
}): string {
  const lines = [`## ${input.title} — ${input.scope}`, ''];

  for (const column of input.columns) {
    /*
     * A person with nothing assigned and no leave is not worth a line in a chat
     * message. A person who is **away** is, even with an empty queue — that is
     * precisely the fact the reader does not otherwise have, and §17-25 exists
     * because its absence made the picture confidently wrong.
     */
    if (column.open === 0 && !column.away) continue;

    const parts = [String(column.open)];
    if (column.overdue > 0) parts.push(input.overdueLabel(column.overdue));
    if (column.away && column.unavailableUntil) parts.push(input.awayLabel(column.unavailableUntil));

    const name = column.key === 'none' ? input.unassignedLabel : column.name;
    lines.push(`- **${name}** — ${parts.join(' · ')}`);
  }

  // §11: never a bare absence. A summary of a quiet week is still a summary, and
  // an empty code block pasted into a chat reads as a broken button.
  if (lines.length === 2) lines.push(`- ${input.emptyLabel}`);

  return lines.join('\n');
}
