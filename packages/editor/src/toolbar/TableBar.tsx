'use client';

import * as React from 'react';
import type { Editor } from '@tiptap/react';
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Heading,
  Trash2,
  X,
} from 'lucide-react';
import { TCtl } from './primitives';

/**
 * Contextual table controls — rendered only while the caret is inside a table.
 * Shared by RichTextEditor and CollabToolbar (identical strip in both).
 */
export function TableBar({ editor }: { editor: Editor }) {
  if (!editor.isActive('table')) return null;
  return (
    <div className="prism-rich-tablebar">
      <span className="prism-rich-tablebar-label">Table</span>
      <TCtl
        title="Insert column left"
        onClick={() => editor.chain().focus().addColumnBefore().run()}
      >
        <ArrowLeftToLine />
        Col
      </TCtl>
      <TCtl
        title="Insert column right"
        onClick={() => editor.chain().focus().addColumnAfter().run()}
      >
        <ArrowRightToLine />
        Col
      </TCtl>
      <TCtl
        title="Delete column"
        onClick={() => editor.chain().focus().deleteColumn().run()}
      >
        <X />
        Col
      </TCtl>
      <span className="prism-rich-sep" />
      <TCtl
        title="Insert row above"
        onClick={() => editor.chain().focus().addRowBefore().run()}
      >
        <ArrowUpToLine />
        Row
      </TCtl>
      <TCtl
        title="Insert row below"
        onClick={() => editor.chain().focus().addRowAfter().run()}
      >
        <ArrowDownToLine />
        Row
      </TCtl>
      <TCtl
        title="Delete row"
        onClick={() => editor.chain().focus().deleteRow().run()}
      >
        <X />
        Row
      </TCtl>
      <span className="prism-rich-sep" />
      <TCtl
        title="Toggle header row"
        onClick={() => editor.chain().focus().toggleHeaderRow().run()}
      >
        <Heading />
        Header
      </TCtl>
      <TCtl
        title="Delete table"
        danger
        onClick={() => editor.chain().focus().deleteTable().run()}
      >
        <Trash2 />
        Delete
      </TCtl>
    </div>
  );
}
