import { describe, expect, it } from 'vitest';
import { auditRowFor, eventRegistry } from './registry';
import type { DomainEvent, EventType } from './types';

/**
 * The registry's real guarantee is a compile error, not a test: it is a mapped
 * type over the event union, so adding an event without deciding whether it is
 * auditable does not build. These tests cover what the type cannot — that the
 * decision, once made, is actually carried out.
 */

const sample: { [T in EventType]: Extract<DomainEvent, { type: T }> } = {
  'workspace.created': {
    type: 'workspace.created',
    workspaceId: 'w1',
    slug: 'acme',
    name: 'Acme',
  },
  'workspace.renamed': { type: 'workspace.renamed', workspaceId: 'w1', from: 'Acme', to: 'Acme Co' },
  'workspace_member.added': {
    type: 'workspace_member.added',
    workspaceId: 'w1',
    memberId: 'm1',
    userId: 'u1',
    role: 'member',
  },
  'workspace_member.role_changed': {
    type: 'workspace_member.role_changed',
    workspaceId: 'w1',
    memberId: 'm1',
    from: 'member',
    to: 'admin',
  },
  'workspace_member.removed': {
    type: 'workspace_member.removed',
    workspaceId: 'w1',
    memberId: 'm1',
    userId: 'u1',
  },
  'team.created': { type: 'team.created', workspaceId: 'w1', teamId: 't1', slug: 'eng', name: 'Eng' },
  'team.renamed': { type: 'team.renamed', workspaceId: 'w1', teamId: 't1', from: 'Eng', to: 'Product' },
  'team.deleted': { type: 'team.deleted', workspaceId: 'w1', teamId: 't1', name: 'Eng' },
  'team.member_added': {
    type: 'team.member_added',
    workspaceId: 'w1',
    teamId: 't1',
    memberId: 'm1',
  },
  'team.member_removed': {
    type: 'team.member_removed',
    workspaceId: 'w1',
    teamId: 't1',
    memberId: 'm1',
  },
  'invitation.sent': {
    type: 'invitation.sent',
    workspaceId: 'w1',
    invitationId: 'i1',
    email: 'sophea@example.com',
    role: 'member',
  },
  'invitation.resent': {
    type: 'invitation.resent',
    workspaceId: 'w1',
    invitationId: 'i1',
    email: 'sophea@example.com',
  },
  'invitation.revoked': {
    type: 'invitation.revoked',
    workspaceId: 'w1',
    invitationId: 'i1',
    email: 'sophea@example.com',
  },
  'invitation.accepted': {
    type: 'invitation.accepted',
    workspaceId: 'w1',
    invitationId: 'i1',
    email: 'sophea@example.com',
    userId: 'u2',
    memberId: 'm2',
  },
};

const everyEvent = Object.values(sample) as DomainEvent[];

describe('the event registry', () => {
  it('has an entry for every event type', () => {
    for (const event of everyEvent) {
      expect(eventRegistry[event.type], event.type).toBeDefined();
    }
    expect(Object.keys(eventRegistry).sort()).toEqual(Object.keys(sample).sort());
  });

  it('produces a row for every event it marks auditable, and none for the rest', () => {
    for (const event of everyEvent) {
      const auditable = eventRegistry[event.type].audit !== false;
      expect(auditRowFor(event) !== null, event.type).toBe(auditable);
    }
  });

  it('names the subject on every audit row', () => {
    for (const event of everyEvent) {
      const row = auditRowFor(event);
      if (!row) continue;
      expect(row.action, event.type).toBe(event.type);
      expect(row.subjectType, event.type).toBeTruthy();
      expect(row.subjectId, event.type).toBeTruthy();
    }
  });

  // Audit is workspace-scoped, Owner/Admin-visible and never translated
  // (§18-11). A payload only makes sense in that log if it reads as data.
  it('carries a plain-object payload', () => {
    for (const event of everyEvent) {
      const row = auditRowFor(event);
      if (!row) continue;
      expect(typeof row.data, event.type).toBe('object');
      expect(Array.isArray(row.data), event.type).toBe(false);
    }
  });

  it('audits membership and workspace changes, not team composition', () => {
    const audited = everyEvent.filter((e) => auditRowFor(e) !== null).map((e) => e.type);

    expect(audited.sort()).toEqual(
      [
        'invitation.accepted',
        'invitation.resent',
        'invitation.revoked',
        'invitation.sent',
        'team.created',
        'team.deleted',
        'team.renamed',
        'workspace.created',
        'workspace.renamed',
        'workspace_member.added',
        'workspace_member.removed',
        'workspace_member.role_changed',
      ].sort(),
    );
  });

  // §18-11: the audit log exists so an owner can reconstruct how someone got
  // access. An invitation accepted by an account whose address differs from the
  // one invited is exactly the case that question is asked about, so the row
  // has to carry both.
  it('records who accepted an invitation, not only who was invited', () => {
    const row = auditRowFor(sample['invitation.accepted']);
    expect(row?.data).toMatchObject({ email: 'sophea@example.com', userId: 'u2' });
  });
});
