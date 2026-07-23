'use client';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { IssueTodo } from '@/schemas/issue';

interface TodoChecklistProps {
  todos: IssueTodo[];
  onChange: (todos: IssueTodo[]) => void;
  /**
   * Hide the done-count + progress bar (template modal: templates define
   * items, not completion — templates-csv-import spec §2.2).
   */
  showProgress?: boolean;
}

/**
 * Checklist block (add / toggle / remove + Enter-to-add), lifted out of
 * issue-modal.tsx so the template modal reuses the exact markup instead of
 * forking it (templates-csv-import spec §2.2 / §5). Shared within apps/web
 * only — no second app uses it, so it stays out of packages/ui.
 */
export function TodoChecklist({
  todos,
  onChange,
  showProgress = true,
}: TodoChecklistProps) {
  const [newTodoText, setNewTodoText] = useState('');
  const newTodoRef = useRef<HTMLInputElement>(null);

  const doneTodos = todos.filter((t) => t.done).length;
  const progress =
    todos.length > 0 ? Math.round((doneTodos / todos.length) * 100) : 0;

  const addTodo = () => {
    const text = newTodoText.trim();
    if (!text) return;
    onChange([
      ...todos,
      { id: Math.random().toString(36).slice(2), text, done: false },
    ]);
    setNewTodoText('');
    newTodoRef.current?.focus();
  };

  const toggleTodo = (id: string) =>
    onChange(todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));

  const removeTodo = (id: string) => onChange(todos.filter((t) => t.id !== id));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-[--text]">Checklist</span>
        {showProgress && todos.length > 0 && (
          <span className="text-xs text-[--text-muted]">
            {doneTodos}/{todos.length} &mdash; {progress}%
          </span>
        )}
      </div>

      {showProgress && todos.length > 0 && (
        <div className="w-full h-1.5 rounded-full bg-[--bg-subtle] overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${progress}%`, backgroundColor: 'var(--a)' }}
          />
        </div>
      )}

      {todos.length > 0 && (
        <div className="flex flex-col gap-1">
          {todos.map((todo) => (
            <div
              key={todo.id}
              className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-[--bg-hover]"
            >
              <input
                type="checkbox"
                checked={todo.done}
                onChange={() => toggleTodo(todo.id)}
                className="h-4 w-4 shrink-0 cursor-pointer accent-[--a]"
              />
              <span
                className={`flex-1 text-sm ${todo.done ? 'line-through text-[--text-muted]' : 'text-[--text]'}`}
              >
                {todo.text}
              </span>
              <button
                type="button"
                onClick={() => removeTodo(todo.id)}
                className="opacity-0 group-hover:opacity-100 text-[--text-muted] hover:text-red-500 transition-opacity text-base leading-none"
                aria-label="Remove task"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          ref={newTodoRef}
          type="text"
          value={newTodoText}
          onChange={(e) => setNewTodoText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTodo();
            }
          }}
          placeholder="Add a task…"
          className="flex-1 rounded-md border border-[--border] bg-[--bg-input] px-3 py-1.5 text-sm text-[--text] placeholder:text-[--text-muted] outline-none focus:border-[--a] transition-colors"
        />
        <Button
          type="button"
          variant="outline"
          onClick={addTodo}
          className="shrink-0"
        >
          Add
        </Button>
      </div>
    </div>
  );
}
