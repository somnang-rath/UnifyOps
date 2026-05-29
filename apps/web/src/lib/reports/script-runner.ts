export type ScriptContext = {
  value?: unknown;
  data?: unknown;
  rows?: unknown[];
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
};

/**
 * Runs a user-supplied JS script in a sandboxed Function scope.
 * Returns the string result, or '[Script Error: …]' on failure, or null if the
 * script returns null / undefined (meaning "use default display").
 */
export function runScript(script: string, ctx: ScriptContext): string | null {
  if (!script.trim()) return null;
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      'value', 'data', 'rows', 'id', 'type', 'props',
      script,
    );
    const result = fn(
      ctx.value  ?? null,
      ctx.data   ?? null,
      ctx.rows   ?? [],
      ctx.id     ?? '',
      ctx.type   ?? '',
      ctx.props  ?? {},
    );
    if (result === null || result === undefined) return null;
    return String(result);
  } catch (e) {
    return `[Script Error: ${(e as Error).message}]`;
  }
}
