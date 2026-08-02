'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  onDelete,
  onNewChat,
}: {
  conversations: ConversationSummary[];
  activeChatId: string | null;
  /** A new chat mid-stream would abandon the response being written. */
  isStreaming: boolean;
  onSelect: (chatId: string) => void;
  onDelete: (chatId: string) => void;
  onNewChat: () => void;
}) {
  const { isMobile, setOpenMobile } = useSidebar();

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
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <SidebarMenuButton
                          isActive={chat.chatId === activeChatId}
                          className="h-auto flex-col items-start gap-0 py-1.5"
                          onClick={() => {
                            onSelect(chat.chatId);
                            dismissOnMobile();
                          }}
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
                        Deliberately not SidebarMenuButton's own `tooltip` prop:
                        that one is `hidden` unless the sidebar is collapsed to
                        icons, because it exists to name an icon. This has to
                        show at full width, where the title is truncated and the
                        clipped part is usually what distinguishes one
                        conversation from another.
                      */}
                      <TooltipContent
                        side="right"
                        className="max-w-xs whitespace-normal break-words"
                      >
                        {chat.title}
                      </TooltipContent>
                    </Tooltip>
                    <SidebarMenuAction
                      showOnHover
                      aria-label={`Delete ${chat.title}`}
                      title="Delete conversation"
                      onClick={() => onDelete(chat.chatId)}
                      className="hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </SidebarMenuAction>
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
