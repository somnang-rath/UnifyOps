import { describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { ReadOnlyActorError, UnitOfWork, actorContextSchema } from './tenant';

/**
 * The parts of withActor that hold without a database. The parts that do not —
 * whether the RLS policies actually stop a cross-workspace read — live in
 * src/server/db/__tenancy__ and need real Postgres.
 */

const ids = () => ({ workspaceId: uuidv7(), userId: uuidv7(), actorUserId: uuidv7() });

describe('ActorContext', () => {
  it('defaults to not read-only', () => {
    const ctx = actorContextSchema.parse(ids());
    expect(ctx.readOnly).toBe(false);
  });

  // The ids are interpolated into set_config and read back through a ::uuid
  // cast in the policy functions. Validating here means a malformed id fails
  // at the door rather than as a cast error deep inside a query plan.
  it('rejects an id that is not a UUID', () => {
    expect(() => actorContextSchema.parse({ ...ids(), workspaceId: 'acme' })).toThrow();
    expect(() => actorContextSchema.parse({ ...ids(), userId: '' })).toThrow();
  });

  it('keeps the principal separate from the member being viewed as', () => {
    const principal = uuidv7();
    const target = uuidv7();
    const ctx = actorContextSchema.parse({
      workspaceId: uuidv7(),
      userId: target,
      actorUserId: principal,
      readOnly: true,
    });

    expect(ctx.userId).not.toBe(ctx.actorUserId);
  });
});

describe('UnitOfWork', () => {
  const ctx = actorContextSchema.parse(ids());

  it('collects events in order without writing anything', () => {
    const uow = new UnitOfWork(ctx);
    uow.emit({ type: 'workspace.created', workspaceId: ctx.workspaceId, slug: 'a', name: 'A' });
    uow.emit({ type: 'workspace.renamed', workspaceId: ctx.workspaceId, from: 'A', to: 'B' });

    expect(uow.events.map((e) => e.type)).toEqual(['workspace.created', 'workspace.renamed']);
  });

  // §7.13: view-as refuses every mutation. An emitted event is the record of a
  // mutation, so refusing it here catches the mistake before it reaches a
  // policy check that would only refuse the write itself.
  it('refuses to emit while view-as is active', () => {
    const readOnly = actorContextSchema.parse({ ...ids(), readOnly: true });
    const uow = new UnitOfWork(readOnly);

    expect(() =>
      uow.emit({ type: 'team.created', workspaceId: readOnly.workspaceId, teamId: uuidv7(), slug: 'x', name: 'X' }),
    ).toThrow(ReadOnlyActorError);
  });
});
