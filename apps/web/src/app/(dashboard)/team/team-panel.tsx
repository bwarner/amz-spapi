'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, Loader2, Mail, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type InvitableRole = 'admin' | 'member';

export type TeamWorkspace = {
  workspaceId: string;
  name: string;
  role: string;
  canManage: boolean;
  members: Array<{
    userId: string;
    email: string;
    role: string;
    joinedAt: number;
  }>;
  invitations: Array<{
    invitationId: string;
    email: string;
    role: string;
    status: string;
    expiresAt: number;
  }>;
};

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * One workspace's members and pending invitations.
 *
 * `router.refresh()` after a mutation rather than local state surgery: the
 * server component is the only thing that knows the authoritative list, and
 * re-deriving it here would be a second copy of the rules about which
 * invitations are visible.
 */
export function TeamPanel({ workspace }: { workspace: TeamWorkspace }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InvitableRole>('member');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function copyLink(invitationId: string) {
    const url = `${window.location.origin}/invite/${invitationId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(invitationId);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard access can be refused (insecure context, permissions). Show
      // the URL so the invitation is still sendable by hand.
      setError(`Copy this link manually: ${url}`);
    }
  }

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSent(null);

    const response = await fetch(
      `/api/workspaces/${workspace.workspaceId}/invitations`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      }
    );

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? 'Could not send that invitation.');
      return;
    }

    setSent(email);
    setEmail('');
    startTransition(() => router.refresh());
  }

  async function revoke(invitationId: string) {
    setError(null);
    const response = await fetch(
      `/api/workspaces/${workspace.workspaceId}/invitations/${invitationId}`,
      { method: 'DELETE' }
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? 'Could not revoke that invitation.');
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3">
          {workspace.name}
          <Badge variant="outline">{workspace.role}</Badge>
        </CardTitle>
        <CardDescription>
          {workspace.members.length}{' '}
          {workspace.members.length === 1 ? 'member' : 'members'}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <ul className="divide-y rounded-md border">
          {workspace.members.map((member) => (
            <li
              key={member.userId}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{member.email}</p>
                <p className="text-xs text-muted-foreground">
                  Joined {formatDate(member.joinedAt)}
                </p>
              </div>
              <Badge variant="secondary">{member.role}</Badge>
            </li>
          ))}
        </ul>

        {workspace.invitations.length > 0 ? (
          <div>
            <h3 className="text-sm font-medium">Invitations</h3>
            <ul className="mt-2 divide-y rounded-md border">
              {workspace.invitations.map((invitation) => {
                const expired =
                  invitation.status === 'pending' &&
                  invitation.expiresAt <= Date.now();
                return (
                  <li
                    key={invitation.invitationId}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {invitation.email}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {invitation.status === 'revoked'
                          ? 'Revoked'
                          : expired
                          ? 'Expired'
                          : `Invited as ${
                              invitation.role
                            } — expires ${formatDate(invitation.expiresAt)}`}
                      </p>
                    </div>
                    {workspace.canManage &&
                    invitation.status === 'pending' &&
                    !expired ? (
                      <div className="flex shrink-0 items-center gap-1">
                        {/* Email delivery is not wired up yet, so the link has
                            to be copyable or the invitation cannot be sent. */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyLink(invitation.invitationId)}
                          aria-label={`Copy the invitation link for ${invitation.email}`}
                        >
                          {copied === invitation.invitationId ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                          <span className="hidden sm:inline">
                            {copied === invitation.invitationId
                              ? 'Copied'
                              : 'Copy link'}
                          </span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => revoke(invitation.invitationId)}
                          aria-label={`Revoke the invitation for ${invitation.email}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {workspace.canManage ? (
          <form onSubmit={invite} className="space-y-3">
            <h3 className="text-sm font-medium">Invite someone</h3>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@company.com"
                aria-label="Email address to invite"
                className="sm:flex-1"
              />
              <Select
                value={role}
                onValueChange={(value) => setRole(value as InvitableRole)}
              >
                <SelectTrigger className="sm:w-40" aria-label="Role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
              <Button type="submit" disabled={pending}>
                {pending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="h-4 w-4" />
                )}
                Invite
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              They will need to sign in with this exact address — an invitation
              is tied to the address, not to the link.
            </p>
          </form>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {sent ? (
          <p className="text-sm text-muted-foreground">
            Invitation created for {sent}. Email delivery is not wired up yet —
            use <strong>Copy link</strong> in the list above and send it to them
            yourself.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
