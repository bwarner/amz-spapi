'use client';

import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export type ConversationSummary = {
  chatId: string;
  title: string;
  updatedAt: number;
};

/** Matches the server's clamp (`normalizeChatTitle`), so the field cannot
 *  accept more than will survive the round trip. */
const TITLE_MAX = 60;

function relativeTime(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * The conversation list, on shadcn's Sidebar.
 *
 * Its own component for two reasons. `useSidebar()` only works inside the
 * provider, so the code that dismisses the mobile sheet after a selection has
 * to live below it — and the chat page was already long enough that adding a
 * second concern to it was not an improvement.
 *
 * What the primitive replaces: a hand-rolled `<aside>` that positioned itself
 * `fixed` under the header, a hand-rolled backdrop, and a `sidebarOpen` boolean
 * threaded through the page. The primitive brings a real Sheet on mobile
 * (focus trap, escape, scroll lock — none of which the backdrop had), the
 * Cmd/Ctrl+B shortcut, and a cookie that remembers the desktop state.
 */
export function ConversationSidebar({
  conversations,
  activeChatId,
  isStreaming,
  onSelect,
  onRename,
  onDelete,
  onNewChat,
}: {
  conversations: ConversationSummary[];
  activeChatId: string | null;
  /** A new chat mid-stream would abandon the response being written. */
  isStreaming: boolean;
  onSelect: (chatId: string) => void;
  onRename: (chatId: string, title: string) => void;
  onDelete: (chatId: string) => void;
  onNewChat: () => void;
}) {
  const { isMobile, setOpenMobile } = useSidebar();

  // Which row is in edit mode, and what has been typed into it. Renaming in
  // place rather than in a dialog: the list is the only context that matters
  // for the decision — you are naming this one so you can tell it from the
  // ones directly above and below it.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Autofocus with the existing title selected: renaming usually means
  // replacing an auto-derived title outright, and typing over a selection is
  // one keystroke instead of a select-all.
  useEffect(() => {
    if (!renamingId) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [renamingId]);

  // A conversation deleted from under an open editor (or a list that refreshed
  // without it) leaves an input bound to nothing.
  useEffect(() => {
    if (renamingId && !conversations.some((c) => c.chatId === renamingId)) {
      setRenamingId(null);
    }
  }, [conversations, renamingId]);

  function startRename(chat: ConversationSummary) {
    setRenamingId(chat.chatId);
    setDraft(chat.title);
  }

  function commitRename(chat: ConversationSummary) {
    const title = draft.trim();
    setRenamingId(null);
    // Empty is a cancel, not a request for a blank title — the server would
    // reject it anyway, and the row would be left unlabelled in the meantime.
    if (!title || title === chat.title) return;
    onRename(chat.chatId, title);
  }

  // On mobile the sidebar covers the conversation, so acting on it and leaving
  // it open hides the thing the seller just asked to see. On desktop it is a
  // permanent column and closing it would be a surprise.
  function dismissOnMobile() {
    if (isMobile) setOpenMobile(false);
  }

  return (
    // The dashboard header is h-14, and the primitive assumes it owns the
    // viewport (`inset-y-0 h-svh`). Without this the column slides under the
    // header and its scroll runs the wrong length. `className` lands on the
    // fixed container, so tailwind-merge lets these win.
    <Sidebar collapsible="offcanvas" className="top-14 h-[calc(100svh-3.5rem)]">
      <SidebarHeader>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          disabled={isStreaming}
          onClick={() => {
            onNewChat();
            dismissOnMobile();
          }}
        >
          <Plus className="h-4 w-4" />
          New chat
        </Button>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            {conversations.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                No saved conversations yet.
              </p>
            ) : (
              <SidebarMenu>
                {conversations.map((chat) => (
                  <SidebarMenuItem key={chat.chatId}>
                    {renamingId === chat.chatId ? (
                      <form
                        className="px-1 py-0.5"
                        onSubmit={(event) => {
                          event.preventDefault();
                          commitRename(chat);
                        }}
                      >
                        <Input
                          ref={inputRef}
                          value={draft}
                          maxLength={TITLE_MAX}
                          aria-label={`Rename ${chat.title}`}
                          className="h-7 text-sm"
                          onChange={(event) => setDraft(event.target.value)}
                          // Clicking away is a commit, the same as Enter —
                          // there is no Save button to miss.
                          onBlur={() => commitRename(chat)}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              // Stop here: the mobile sheet also listens for
                              // Escape, and abandoning a rename should not
                              // also close the list.
                              event.preventDefault();
                              event.stopPropagation();
                              setRenamingId(null);
                            }
                          }}
                        />
                      </form>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <SidebarMenuButton
                            isActive={chat.chatId === activeChatId}
                            className="h-auto flex-col items-start gap-0 py-1.5"
                            onClick={() => {
                              onSelect(chat.chatId);
                              dismissOnMobile();
                            }}
                            // The shortcut for anyone who already expects it
                            // from a file list; the menu is the discoverable
                            // path.
                            onDoubleClick={() => startRename(chat)}
                          >
                            <span className="w-full truncate text-sm">
                              {chat.title}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {relativeTime(chat.updatedAt)}
                            </span>
                          </SidebarMenuButton>
                        </TooltipTrigger>
                        {/*
                          Deliberately not SidebarMenuButton's own `tooltip`
                          prop: that one is `hidden` unless the sidebar is
                          collapsed to icons, because it exists to name an icon.
                          This has to show at full width, where the title is
                          truncated and the clipped part is usually what
                          distinguishes one conversation from another.
                        */}
                        <TooltipContent
                          side="right"
                          className="max-w-xs whitespace-normal break-words"
                        >
                          {chat.title}
                        </TooltipContent>
                      </Tooltip>
                    )}

                    {renamingId === chat.chatId ? null : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <SidebarMenuAction
                            showOnHover
                            aria-label={`Actions for ${chat.title}`}
                            title="Conversation actions"
                          >
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </SidebarMenuAction>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="right" align="start">
                          <DropdownMenuItem
                            // The menu returns focus to its trigger as it
                            // closes, which would steal it straight back from
                            // the input the effect above just focused.
                            onSelect={(event) => {
                              event.preventDefault();
                              startRename(chat);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => onDelete(chat.chatId)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
