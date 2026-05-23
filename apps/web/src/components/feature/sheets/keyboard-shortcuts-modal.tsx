'use client';
import { Modal } from '@/components/ui/modal';

interface Props {
  open: boolean;
  onClose: () => void;
}

const SECTIONS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Navigation',
    rows: [
      ['Arrow keys', 'Move selection'],
      ['Tab / Shift+Tab', 'Move right / left'],
      ['Enter / Shift+Enter', 'Move down / up'],
      ['Ctrl+Home', 'Go to A1'],
      ['Ctrl+End', 'Go to last used cell'],
      ['Ctrl+Arrow', 'Jump to edge of data'],
      ['Page Down / Page Up', 'Scroll down / up'],
    ],
  },
  {
    title: 'Selection',
    rows: [
      ['Shift+Arrow', 'Extend selection'],
      ['Ctrl+Shift+Arrow', 'Extend to edge of data'],
      ['Ctrl+A', 'Select all cells'],
      ['Ctrl+Space', 'Select entire column'],
      ['Shift+Space', 'Select entire row'],
    ],
  },
  {
    title: 'Editing',
    rows: [
      ['F2 / Enter', 'Edit active cell'],
      ['Escape', 'Cancel edit'],
      ['Delete / Backspace', 'Clear cell contents'],
      ['Ctrl+Z', 'Undo'],
      ['Ctrl+Y / Ctrl+Shift+Z', 'Redo'],
      ['Ctrl+D', 'Fill down'],
      ['Ctrl+R', 'Fill right'],
    ],
  },
  {
    title: 'Clipboard',
    rows: [
      ['Ctrl+C', 'Copy'],
      ['Ctrl+X', 'Cut'],
      ['Ctrl+V', 'Paste'],
      ['Ctrl+Shift+V', 'Paste values only'],
    ],
  },
  {
    title: 'Formatting',
    rows: [
      ['Ctrl+B', 'Bold'],
      ['Ctrl+I', 'Italic'],
      ['Ctrl+U', 'Underline'],
      ['Alt+Shift+5', 'Strikethrough'],
    ],
  },
  {
    title: 'File & View',
    rows: [
      ['Ctrl+S', 'Save'],
      ['Ctrl+P', 'Print'],
      ['Ctrl+F', 'Find'],
      ['Ctrl+H', 'Find & Replace'],
    ],
  },
];

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex items-center gap-0.5 flex-wrap">
      {children.split('+').map((part, i, arr) => (
        <span key={i} className="inline-flex items-center gap-0.5">
          <span className="px-1.5 py-0.5 rounded bg-bg-subtle border border-border text-[11px] font-mono font-medium text-text-sub leading-none">
            {part.trim()}
          </span>
          {i < arr.length - 1 && (
            <span className="text-text-muted text-[10px]">+</span>
          )}
        </span>
      ))}
    </kbd>
  );
}

export function KeyboardShortcutsModal({ open, onClose }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" size="lg">
      <div className="grid grid-cols-2 gap-x-8 gap-y-6 max-h-[60vh] overflow-y-auto pr-1">
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <h3 className="text-[11px] font-bold uppercase tracking-[.06em] text-text-muted mb-2">
              {section.title}
            </h3>
            <table className="w-full text-[13px]">
              <tbody>
                {section.rows.map(([keys, desc]) => (
                  <tr key={keys} className="border-b border-border last:border-0">
                    <td className="py-1.5 pr-3 w-1/2">
                      <Kbd>{keys}</Kbd>
                    </td>
                    <td className="py-1.5 text-text-sub">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </Modal>
  );
}
