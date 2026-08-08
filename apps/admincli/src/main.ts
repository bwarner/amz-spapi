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
import { renderTable } from './format.js';

/**
 * Sellavant admin CLI.
 *
 * Administration of the PRODUCT — workspaces, membership, invitations. Distinct
 * from `spcli` and `adscli`, which talk to Amazon on a seller's behalf and know
 * nothing about who our users are.
 *
 * ## Why this exists rather than a page in the app
 *
 * The web UI can only be used by somebody who is already inside a workspace,
 * and the gate that enforces that has exactly one bootstrap route: the
 * `PLATFORM_OWNER_EMAILS` environment variable. That is fine until it is wrong.
 * A typo, an Auth0 account under a different address, or an environment where
 * restarting the process is slow, and the result is nobody can get in and the
 * repair itself requires getting in.
 *
 * This talks to Couchbase directly, so it works when nothing else does. It is
 * the escape hatch, and secondarily the batch tool — inviting twenty pilot
 * sellers is a loop here and twenty form submissions there.
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
  .addOption(formatOption)
  .action(async (options) => {
    assertConnection();
    try {
      const workspace = await createWorkspace({
        name: options.name,
        ownerUserId: options.ownerSub,
        ownerEmail: options.ownerEmail,
      });
      emit(workspace, options.format);
    } catch (error) {
      fail(`Could not create the workspace: ${describe(error)}`, error);
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
    const owners = (process.env['PLATFORM_OWNER_EMAILS'] ?? '')
      .split(',')
      .map((value) => value.toLowerCase().trim())
      .filter(Boolean);
    const email = options.email?.toLowerCase().trim();

    emit(
      {
        sub: options.sub,
        email: email ?? '(not given)',
        memberships: memberships.length,
        workspaces: memberships
          .map((m) => `${m.workspaceId} (${m.role})`)
          .join(', '),
        // The two fields that explain a lockout. An empty owner list usually
        // means the process predates the variable rather than that the address
        // is wrong, and the symptoms are identical.
        ownerListConfigured: owners.length > 0,
        matchesOwnerList: email ? owners.includes(email) : false,
        wouldBeAllowed:
          memberships.length > 0 || (!!email && owners.includes(email)),
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
