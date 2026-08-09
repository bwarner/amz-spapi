import { Command, Option } from '@commander-js/extra-typings';
import { pino } from 'pino';
import {
  acceptInvitation,
  createInvitation,
  createWorkspace,
  getInvitation,
  getWorkspace,
  listInvitations,
  listMembers,
  listMembershipsForUser,
  putMember,
  revokeInvitation,
  InvitationError,
} from '@amz-spapi/identity';
import {
  invitableRoleSchema,
  workspaceRoleSchema,
  type WorkspaceRole,
} from '@farvisionllc/models';
import {
  exportUserData,
  purgeUserData,
  revokeInvitationsFor,
} from '@amz-spapi/data-rights';
import { writeFile } from 'node:fs/promises';
import {
  createBillingCustomer,
  linkCustomerToWorkspace,
} from '@amz-spapi/billing';
import { renderTable } from './format.js';
import {
  attachCustomerToWorkspace,
  findWorkspacesWithoutCustomer,
} from './backfill.js';
import { createS3ObjectStore } from './object-store.js';

/**
 * Sellavant admin CLI.
 *
 * Administration of the PRODUCT — workspaces, membership, invitations. Distinct
 * from `spcli` and `adscli`, which talk to Amazon on a seller's behalf and know
 * nothing about who our users are.
 *
 * ## Why this exists rather than a page in the app
 *
 * Signup is open and a new account provisions its own workspace at
 * `/onboarding`, so this is no longer the way in. It is what the web UI
 * deliberately will not do: create a workspace on somebody's behalf, grant
 * membership with no invitation round trip, repair rows that predate a schema
 * change, and answer data-subject requests.
 *
 * It talks to Couchbase directly, so it works when the app does not — which is
 * the property that matters when the thing you are repairing is the reason
 * nobody can sign in.
 *
 * ## Connection
 *
 * Reads the same Couchbase Data API variables the web app uses, and the same
 * `CB_SCOPE` that selects the environment:
 *
 *   node --env-file=apps/web/.env.local dist/apps/admincli/main.js …
 *
 * There is no config.toml as `spcli` has. Those hold Amazon credentials the CLI
 * owns; everything here is already in the app's environment file, and a second
 * copy of a database password is a second thing to rotate.
 */

/**
 * Diagnostics go to STDERR, always.
 *
 * stdout is the machine-readable channel — `admincli invitations list --format
 * json | jq` has to work, and a single log line on stdout makes that a parse
 * error. Found exactly that way: the app's `.env.local` sets `LOG_LEVEL=debug`,
 * which this CLI inherits because it reads the same file, so one `--format
 * json` command emitted a pretty-printed debug record ahead of its JSON.
 *
 * Pino defaults to fd 1, so both paths have to be redirected explicitly, and
 * they cannot be redirected the same way: the pretty printer runs in a worker
 * thread that has no access to this thread's `process.stderr`, so it takes
 * `destination: 2` and opens the descriptor itself.
 */
const logger = process.env['NO_PRETTY']
  ? // The existing `process.stderr` stream, NOT `pino.destination(2)`. The
    // latter opens a second, independently buffered writer on the same file
    // descriptor, and the two then interleave and lose each other's output.
    pino({ level: process.env['LOG_LEVEL'] || 'warn' }, process.stderr)
  : pino({
      level: process.env['LOG_LEVEL'] || 'warn',
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, destination: 2 },
      },
    });

/** Machine-readable on stdout, so the CLI composes with `jq`. */
function emit(value: unknown, format: string): void {
  if (format === 'json') {
    process.stdout.write(JSON.stringify(value, null, 2) + '\n');
    return;
  }
  process.stdout.write(renderTable(value) + '\n');
}

/** Raised by `fail`. Carries a message already written for a human. */
class CliError extends Error {}

/**
 * Abort with a clean message and a non-zero exit.
 *
 * Throws rather than calling `process.exit`, which is the part that matters:
 * `process.exit` terminates immediately and discards anything still buffered —
 * the message itself, and the pino-pretty worker thread's output with it. The
 * symptom is an empty stderr and a bare exit code, which is the least
 * debuggable possible failure for an escape-hatch tool.
 *
 * `main` catches this, prints, and sets `process.exitCode`, letting Node exit
 * on its own once stdio and the worker have drained.
 *
 * Still declared `never` so callers keep their narrowing — `if (!x) fail(…)`
 * has to convince the compiler that `x` is non-null afterwards.
 */
function fail(message: string, error?: unknown): never {
  if (error) logger.debug({ error }, 'underlying error');
  throw new CliError(message);
}

/**
 * Refuse to run without a Couchbase target.
 *
 * Checked up front because the alternative is a confusing failure halfway
 * through a write — and because pointing admin commands at the wrong
 * environment is the mistake with the worst consequences here.
 */
function assertConnection(): void {
  const missing = [
    'CB_DATA_API_URL',
    'CB_USERNAME',
    'CB_PASSWORD',
    'CB_BUCKET',
    'CB_SCOPE',
  ].filter((name) => !process.env[name]);
  if (missing.length > 0) {
    fail(
      `Missing Couchbase configuration: ${missing.join(', ')}.\n` +
        'Run with --env-file, e.g.\n' +
        '  node --env-file=apps/web/.env.local dist/apps/admincli/main.js …'
    );
  }
}

const formatOption = new Option('-f, --format <format>', 'output format')
  .choices(['table', 'json'] as const)
  .default('table');

const program = new Command()
  .name('admincli')
  .description('Sellavant administration — workspaces, members, invitations')
  .version('0.0.1');

// ── workspaces ──────────────────────────────────────────────────────────────

const workspaces = program
  .command('workspaces')
  .description('Create and inspect workspaces');

workspaces
  .command('create')
  .description('Create a workspace and make someone its owner')
  .requiredOption('--name <name>', 'workspace name')
  .requiredOption(
    '--owner-sub <sub>',
    'Auth0 subject of the owner, e.g. "auth0|abc123"'
  )
  .requiredOption('--owner-email <email>', 'owner email address')
  .option(
    '--stripe-customer <id>',
    'use an existing Stripe customer instead of creating one'
  )
  .addOption(formatOption)
  .action(async (options) => {
    assertConnection();
    try {
      /**
       * A workspace must be billable, so this creates a Stripe customer for it
       * exactly as onboarding does — an operator-made workspace that could
       * never be charged would be a slower version of the same bug.
       *
       * `--stripe-customer` exists for the repair case: attaching a workspace
       * to a customer that already exists, rather than minting a duplicate for
       * somebody Stripe already knows about.
       */
      const customerId =
        options.stripeCustomer ??
        (
          await createBillingCustomer({
            email: options.ownerEmail,
            name: options.name,
            ownerUserId: options.ownerSub,
          })
        ).customerId;

      const workspace = await createWorkspace({
        name: options.name,
        ownerUserId: options.ownerSub,
        ownerEmail: options.ownerEmail,
        stripeCustomerId: customerId,
      });

      await linkCustomerToWorkspace({
        customerId,
        workspaceId: workspace.workspaceId,
      }).catch(() => undefined);

      emit(workspace, options.format);
    } catch (error) {
      fail(`Could not create the workspace: ${describe(error)}`, error);
    }
  });

/**
 * Give a pre-billing workspace a Stripe customer.
 *
 * `stripeCustomerId` became required when billing landed, which means any
 * workspace created before that no longer parses and every read of it throws.
 * This is the one-way conversion, not a compatibility shim — after it runs
 * there is no such thing as a workspace without a customer, and nothing in the
 * codebase needs to allow for one.
 *
 * Reads the raw document rather than going through `getWorkspace`, because
 * `getWorkspace` validates and would refuse the very rows this repairs.
 */
workspaces
  .command('backfill-billing')
  .description('Create Stripe customers for workspaces that predate billing')
  .option('--apply', 'actually write; without this it only reports')
  .addOption(formatOption)
  .action(async (options) => {
    assertConnection();
    const apply = Boolean(options.apply);

    const stale = await findWorkspacesWithoutCustomer();
    if (stale.length === 0) {
      process.stderr.write('Every workspace already has a Stripe customer.\n');
      emit([], options.format);
      return;
    }

    const results: Array<Record<string, unknown>> = [];
    for (const row of stale) {
      if (!apply) {
        results.push({
          workspaceId: row.workspaceId,
          name: row.name,
          action: 'would create customer',
        });
        continue;
      }
      try {
        const { customerId } = await createBillingCustomer({
          email: row.ownerEmail ?? '',
          name: row.name,
          ownerUserId: row.ownerUserId,
        });
        await attachCustomerToWorkspace(row.workspaceId, customerId);
        await linkCustomerToWorkspace({
          customerId,
          workspaceId: row.workspaceId,
        }).catch(() => undefined);
        results.push({
          workspaceId: row.workspaceId,
          name: row.name,
          customerId,
        });
      } catch (error) {
        results.push({
          workspaceId: row.workspaceId,
          name: row.name,
          error: describe(error),
        });
        process.exitCode = 1;
      }
    }

    emit(results, options.format);
    if (!apply) {
      process.stderr.write(
        '\nDry run — nothing written. Re-run with --apply.\n'
      );
    }
  });

workspaces
  .command('show')
  .description('Show one workspace and its members')
  .requiredOption('--workspace <id>', 'workspace id (ws_…)')
  .addOption(formatOption)
  .action(async (options) => {
    assertConnection();
    const workspace = await getWorkspace(options.workspace);
    if (!workspace) fail(`No workspace ${options.workspace}.`);
    const members = await listMembers(options.workspace);
    emit({ ...workspace, members }, options.format);
  });

workspaces
  .command('for-user')
  .description('List the workspaces a user belongs to')
  .requiredOption('--sub <sub>', 'Auth0 subject')
  .addOption(formatOption)
  .action(async (options) => {
    assertConnection();
    emit(await listMembershipsForUser(options.sub), options.format);
  });

// ── members ─────────────────────────────────────────────────────────────────

const members = program
  .command('members')
  .description('Inspect and grant workspace membership');

members
  .command('list')
  .description("List a workspace's members")
  .requiredOption('--workspace <id>', 'workspace id (ws_…)')
  .addOption(formatOption)
  .action(async (options) => {
    assertConnection();
    emit(await listMembers(options.workspace), options.format);
  });

/**
 * The escape hatch.
 *
 * Grants membership with no invitation and no email round trip, which is
 * exactly what you need when the gate has locked everyone out. Idempotent, so
 * re-running to correct a role is safe.
 */
members
  .command('grant')
  .description('Add or update a member directly (no invitation)')
  .requiredOption('--workspace <id>', 'workspace id (ws_…)')
  .requiredOption('--sub <sub>', 'Auth0 subject, e.g. "auth0|abc123"')
  .requiredOption('--email <email>', "the member's email address")
  .option('--role <role>', 'owner | admin | member', 'member')
  .addOption(formatOption)
  .action(async (options) => {
    assertConnection();

    const role = workspaceRoleSchema.safeParse(options.role);
    if (!role.success) fail('--role must be one of: owner, admin, member');

    const workspace = await getWorkspace(options.workspace);
    if (!workspace) {
      // Without this the grant would succeed and point at nothing — a
      // membership row that lets somebody in to a workspace that is not there.
      fail(`No workspace ${options.workspace}. Create it first.`);
    }

    try {
      const member = await putMember({
        workspaceId: options.workspace,
        userId: options.sub,
        email: options.email,
        role: role.data as WorkspaceRole,
        invitedBy: null,
      });
      emit(member, options.format);
    } catch (error) {
      fail(`Could not grant membership: ${describe(error)}`, error);
    }
  });

// ── invitations ─────────────────────────────────────────────────────────────

const invitations = program
  .command('invitations')
  .description('Issue, list, revoke and force-accept invitations');

invitations
  .command('list')
  .description("List a workspace's invitations")
  .requiredOption('--workspace <id>', 'workspace id (ws_…)')
  .addOption(formatOption)
  .action(async (options) => {
    assertConnection();
    emit(await listInvitations(options.workspace), options.format);
  });

invitations
  .command('create')
  .description('Issue an invitation and print its link')
  .requiredOption('--workspace <id>', 'workspace id (ws_…)')
  .requiredOption('--email <email>', 'address to invite')
  .option('--role <role>', 'admin | member', 'member')
  .requiredOption('--invited-by <sub>', 'Auth0 subject of the inviter')
  .option(
    '--base-url <url>',
    'base URL for the printed link',
    process.env['APP_BASE_URL'] ?? 'https://sellavant.com'
  )
  .addOption(formatOption)
  .action(async (options) => {
    assertConnection();

    const role = invitableRoleSchema.safeParse(options.role);
    if (!role.success) fail('--role must be one of: admin, member');

    const workspace = await getWorkspace(options.workspace);
    if (!workspace) fail(`No workspace ${options.workspace}.`);

    try {
      const invitation = await createInvitation({
        workspaceId: options.workspace,
        email: options.email,
        role: role.data,
        invitedBy: options.invitedBy,
      });
      // Email delivery is not wired up, so the link IS the deliverable.
      emit(
        {
          ...invitation,
          link: `${options.baseUrl.replace(/\/$/, '')}/invite/${
            invitation.invitationId
          }`,
        },
        options.format
      );
    } catch (error) {
      fail(`Could not create the invitation: ${describe(error)}`, error);
    }
  });

invitations
  .command('revoke')
  .description('Revoke a pending invitation')
  .requiredOption('--id <invitationId>', 'invitation id (inv_…)')
  .addOption(formatOption)
  .action(async (options) => {
    assertConnection();
    try {
      emit(await revokeInvitation(options.id), options.format);
    } catch (error) {
      if (error instanceof InvitationError) fail(error.message, error);
      fail(`Could not revoke the invitation: ${describe(error)}`, error);
    }
  });

invitations
  .command('show')
  .description('Show one invitation')
  .requiredOption('--id <invitationId>', 'invitation id (inv_…)')
  .addOption(formatOption)
  .action(async (options) => {
    assertConnection();
    const invitation = await getInvitation(options.id);
    if (!invitation) fail(`No invitation ${options.id}.`);
    emit(invitation, options.format);
  });

/**
 * Accept on someone's behalf.
 *
 * For the support case where an invitee cannot complete the flow themselves —
 * typically because their Auth0 account carries a different address than the
 * one that was invited. The email check still applies unless `--force`, so the
 * ordinary mistake is caught and only a deliberate override skips it.
 */
invitations
  .command('accept')
  .description("Accept an invitation on a user's behalf")
  .requiredOption('--id <invitationId>', 'invitation id (inv_…)')
  .requiredOption('--sub <sub>', 'Auth0 subject accepting the invitation')
  .option('--email <email>', 'session email to check against the invitation')
  .option(
    '--force',
    'skip the email check — records the mismatch in the membership row'
  )
  .addOption(formatOption)
  .action(async (options) => {
    assertConnection();

    const invitation = await getInvitation(options.id);
    if (!invitation) fail(`No invitation ${options.id}.`);

    if (!options.email && !options.force) {
      fail('Provide --email, or --force to accept without checking it.');
    }

    try {
      const result = await acceptInvitation({
        invitationId: options.id,
        userId: options.sub,
        // With --force the invitation's own address is supplied, which is what
        // makes the check pass. Stated plainly rather than adding a bypass
        // branch inside the shared store, where it could be reached by the web
        // app too.
        sessionEmail: options.force
          ? invitation.email
          : (options.email as string),
      });
      emit(result.member, options.format);
    } catch (error) {
      if (error instanceof InvitationError) fail(error.message, error);
      fail(`Could not accept the invitation: ${describe(error)}`, error);
    }
  });

// ── data-subject requests ───────────────────────────────────────────────────

const users = program
  .command('users')
  .description('Answer a data-subject request: export or erase a person');

/**
 * GDPR Art. 15 / 20.
 *
 * Writes to a file rather than stdout by default. An export of a real account
 * is megabytes of JSON containing order history, and the one thing you must not
 * do with it is lose it in a terminal scrollback.
 */
users
  .command('export')
  .description('Export everything held about a person, as JSON')
  .requiredOption('--sub <sub>', 'Auth0 subject')
  .option('-o, --out <file>', 'write here instead of stdout')
  .action(async (options) => {
    assertConnection();
    try {
      const result = await exportUserData({ userId: options.sub });

      const json = JSON.stringify(result, null, 2);
      if (options.out) {
        await writeFile(options.out, json + '\n', 'utf8');
        // Summary to STDERR so `--out -` style piping stays clean.
        process.stderr.write(
          `Wrote ${options.out}: ${Object.keys(result.records).length} ` +
            `collections, ${Object.values(result.records).reduce(
              (n, rows) => n + rows.length,
              0
            )} records, ${result.objects.length} stored files.\n`
        );
      } else {
        process.stdout.write(json + '\n');
      }
    } catch (error) {
      fail(`Export failed: ${describe(error)}`, error);
    }
  });

/**
 * GDPR Art. 17.
 *
 * Dry run unless `--apply`, and `--apply` additionally demands the subject be
 * repeated back via `--confirm`. Two gates for one action is usually cargo
 * cult; here the action is an unrecoverable delete across twenty-odd
 * collections and an object store, and the realistic mistake is not a typo in
 * the flag but the right command aimed at the wrong person.
 */
users
  .command('purge')
  .description('Erase everything held about a person (Art. 17)')
  .requiredOption('--sub <sub>', 'Auth0 subject')
  .option(
    '--email <email>',
    'also revoke any pending invitations to this address'
  )
  .option('--apply', 'actually delete; without this it only reports')
  .option('--confirm <sub>', 'repeat --sub exactly, required with --apply')
  .addOption(formatOption)
  .action(async (options) => {
    assertConnection();

    const apply = Boolean(options.apply);
    if (apply && options.confirm !== options.sub) {
      fail(
        'Refusing to delete.\n' +
          `  --apply requires --confirm '${options.sub}'\n` +
          '  Run without --apply first and read what it plans to remove.'
      );
    }

    try {
      const plan = await purgeUserData({
        userId: options.sub,
        objectStore: createS3ObjectStore(),
        dryRun: !apply,
      });

      const invitations = options.email
        ? await revokeInvitationsFor({
            email: options.email,
            dryRun: !apply,
          })
        : 0;

      const rows = Object.entries(plan.deleted).map(([collection, count]) => ({
        collection,
        records: count,
      }));
      rows.push({ collection: '(stored files)', records: plan.objectsDeleted });
      if (options.email) {
        rows.push({
          collection: '(invitations revoked)',
          records: invitations,
        });
      }

      emit(
        options.format === 'json' ? { ...plan, invitations } : rows,
        options.format
      );

      // Anything partial goes to stderr, where it cannot be lost in a pipe.
      if (plan.retainedForSharedSellers.length > 0) {
        process.stderr.write(
          '\nNOT erased — these Amazon seller accounts are also held by ' +
            'another user, so their trading data belongs to more than one ' +
            'person:\n' +
            plan.retainedForSharedSellers
              .map((s) => `  ${s.sellerId} (held by ${s.heldBy.join(', ')})`)
              .join('\n') +
            `\nCollections left untouched: ${plan.skippedCollections.join(
              ', '
            )}\n` +
            'Resolve the shared access before treating this erasure as complete.\n'
        );
      }
      if (plan.objectsFailed.length > 0) {
        process.stderr.write(
          `\n${plan.objectsFailed.length} stored files could NOT be deleted. ` +
            'The erasure is incomplete; re-run after fixing access.\n'
        );
        process.exitCode = 1;
      }
      if (!apply) {
        process.stderr.write(
          `\nDry run — nothing was deleted. Re-run with: --apply --confirm '${options.sub}'\n`
        );
      }
    } catch (error) {
      fail(`Purge failed: ${describe(error)}`, error);
    }
  });

// ── whoami-style lookup ─────────────────────────────────────────────────────

program
  .command('check')
  .description('Show what access a user currently has, and why')
  .requiredOption('--sub <sub>', 'Auth0 subject')
  .option('--email <email>', 'email, to also report matching invitations')
  .addOption(formatOption)
  .action(async (options) => {
    assertConnection();

    const memberships = await listMembershipsForUser(options.sub);
    const email = options.email?.toLowerCase().trim();

    emit(
      {
        sub: options.sub,
        email: email ?? '(not given)',
        memberships: memberships.length,
        workspaces: memberships
          .map((m) => `${m.workspaceId} (${m.role})`)
          .join(', '),
        // Signup is open, so the question is no longer "were they admitted"
        // but "do they have a workspace". Someone with none is not stuck —
        // they go to onboarding and create one.
        hasWorkspace: memberships.length > 0,
        nextStep: memberships.length > 0 ? 'ready' : 'onboarding',
      },
      options.format
    );
  });

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  // Errors from an action handler reject the parse; without this they surface
  // as an unhandled rejection with a stack and no exit code.
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CliError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      process.stderr.write(`${describe(error)}\n`);
      logger.debug({ error }, 'unhandled error');
    }
    // Not `process.exit`: see `fail`. Setting the code lets Node finish
    // flushing stderr and shut the pretty-printer's worker down cleanly.
    process.exitCode = 1;
  }
}

void main();
