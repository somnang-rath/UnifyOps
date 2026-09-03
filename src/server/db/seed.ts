import { drizzle } from 'drizzle-orm/node-postgres';
import { uuidv7 } from 'uuidv7';
import { appDatabaseUrl, ownerDatabaseUrl } from '@/env';
import { createPool } from './pool';
import * as schema from './schema';
import { project, projectMember, team, teamMember, user, workspace, workspaceMember } from './schema';
import { seedDefaultStates } from '@/server/services/workflow-states';
import { withActor } from './tenant';

/**
 * Development seed. Two workspaces, on purpose: §15's manual check #2 is
 * "paste workspace B's URL while signed in as A", and that check needs a B
 * that actually exists and has data worth leaking.
 *
 * It uses both connections, in the same split signup will use (slice 3):
 *
 *   owner  — the two root tables. Nothing else can create them; a workspace
 *            cannot be inserted by a connection already scoped to a workspace,
 *            and an account exists before any membership does.
 *   app    — everything else, through withActor. The tenant tables have one
 *            write path and this script does not get to skip it, which is also
 *            why the seed is a real exercise of the tenancy layer rather than
 *            a way around it.
 */
const WORKSPACES = [
  {
    slug: 'acme',
    name: 'Acme Trading',
    teams: [
      { slug: 'eng', name: 'Engineering' },
      { slug: 'ops', name: 'Operations' },
    ],
    projects: [
      { slug: 'website', key: 'WEB', name: 'Website Redesign' },
      { slug: 'warehouse', key: 'WH', name: 'Warehouse Move' },
    ],
    people: [
      { email: 'sophea@acme.test', name: 'Sophea Chan', locale: 'km', role: 'owner' as const },
      { email: 'dara@acme.test', name: 'Dara Kim', locale: 'km', role: 'member' as const },
      { email: 'alex@acme.test', name: 'Alex Doyle', locale: 'en', role: 'admin' as const },
    ],
  },
  {
    slug: 'borey',
    name: 'Borey Construction',
    teams: [{ slug: 'site', name: 'Site' }],
    projects: [{ slug: 'tower-b', key: 'TWB', name: 'Tower B' }],
    people: [
      { email: 'vuthy@borey.test', name: 'Vuthy Sok', locale: 'km', role: 'owner' as const },
      { email: 'mei@borey.test', name: 'Mei Lin', locale: 'en', role: 'member' as const },
    ],
  },
];

async function main(): Promise<void> {
  const ownerPool = createPool('seed:owner', { connectionString: ownerDatabaseUrl(), max: 1 });
  const appPool = createPool('seed:app', { connectionString: appDatabaseUrl(), max: 2 });
  const asOwner = drizzle(ownerPool, { schema });
  const asApp = drizzle(appPool, { schema });

  try {
    for (const w of WORKSPACES) {
      const workspaceId = uuidv7();
      const people = w.people.map((p) => ({ ...p, userId: uuidv7(), memberId: uuidv7() }));
      const firstOwner = people.find((p) => p.role === 'owner') ?? people[0];
      if (!firstOwner) continue;

      await asOwner.transaction(async (tx) => {
        await tx.insert(workspace).values({ id: workspaceId, slug: w.slug, name: w.name });
        await tx.insert(user).values(
          people.map((p) => ({ id: p.userId, email: p.email, name: p.name, locale: p.locale })),
        );
      });

      await withActor(
        {
          workspaceId,
          userId: firstOwner.userId,
          actorUserId: firstOwner.userId,
          readOnly: false,
        },
        async (tx) => {
          await tx.insert(workspaceMember).values(
            people.map((p) => ({
              id: p.memberId,
              workspaceId,
              userId: p.userId,
              role: p.role,
            })),
          );

          const teams = w.teams.map((t) => ({ id: uuidv7(), workspaceId, ...t }));
          await tx.insert(team).values(teams);

          // Everyone on the first team, so team_member — the table whose
          // composite keys carry the §9 invariant — is not empty.
          const [firstTeam] = teams;
          if (firstTeam) {
            await tx.insert(teamMember).values(
              people.map((p) => ({
                workspaceId,
                teamId: firstTeam.id,
                workspaceMemberId: p.memberId,
              })),
            );

            // Projects, with the same six seeded states a real one gets — the
            // seed calls `seedDefaultStates` rather than listing them again, so
            // a development workspace cannot drift from what signup produces.
            for (const p of w.projects) {
              const projectId = uuidv7();
              await tx.insert(project).values({
                id: projectId,
                workspaceId,
                teamId: firstTeam.id,
                slug: p.slug,
                key: p.key,
                name: p.name,
              });
              await tx.insert(projectMember).values({
                workspaceId,
                projectId,
                workspaceMemberId: firstOwner.memberId,
                role: 'lead',
              });
              await seedDefaultStates(tx, { workspaceId, projectId });
            }
          }
        },
        asApp,
      );
    }

    console.log(`Seeded ${WORKSPACES.length} workspaces.`);
  } finally {
    await Promise.all([appPool.end(), ownerPool.end()]);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
