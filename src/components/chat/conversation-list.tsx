'use client';

import { CircleAlert, MessageSquarePlus, PanelLeftClose, Trash2 } from 'lucide-react';
import type { CharacterPreset } from '@/lib/characters';
import type { ConversationDTO, CompanionDTO } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n-client';

/** 会话列表项：会话 + 冗余的恋人展示信息（API 扁平返回） */
export type ConversationWithCompanion = Omit<ConversationDTO, 'visitor_id'> & {
  companion_name: string;
  companion_avatar: string | null;
  companion_character_key: string | null;
  companion_appearance_style: 'chibi' | 'normal';
  companion_theme_id: string | null;
};

interface ConversationListProps {
  conversations: ConversationWithCompanion[];
  activeId: string | null;
  character: CharacterPreset | null;
  companion: CompanionDTO;
  disableNew?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /** 桌面端侧栏是否已收起；收起时本组件不渲染 toggle（它由聊天头部接管，保证 DOM 里恰好一个） */
  sidebarCollapsed?: boolean;
  /** 桌面端收起侧栏；未传时头部不渲染收起按钮 */
  onToggleSidebar?: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

function formatListTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 会话列表侧栏（ChatGPT 式） */
export function ConversationList({
  conversations,
  activeId,
  character,
  companion,
  disableNew = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  sidebarCollapsed = false,
  onToggleSidebar,
  onSelect,
  onNew,
  onDelete,
}: ConversationListProps) {
  const t = useT();
  return (
    <div className="flex h-full flex-col">
      {/* 恋人信息头；data-testid 是 e2e 的落位锚点（收起按钮必须落在它内部） */}
      <div
        className="flex items-center gap-3 border-b border-sidebar-border px-4 py-4"
        data-testid="conversation-list-header"
      >
        <div className="relative">
          {character ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={character.avatar}
              alt={companion.name}
              className="h-11 w-11 rounded-full object-cover object-top"
            />
          ) : (
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
              <CircleAlert className="h-5 w-5" />
            </span>
          )}
          <span
            className="absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-sidebar"
            style={{ backgroundColor: character?.theme.accent ?? 'var(--muted-foreground)' }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{companion.name}</p>
          <p className="truncate text-xs text-muted-foreground">{t('chat.status.online')}</p>
        </div>
        {/*
          桌面端收起入口：头部的第 3 个 flex 子元素（非绝对定位，与头像同一套居中基线）。
          收起态本组件返回 null —— 同一个 data-testid 由聊天头部接管，任意时刻 DOM 里只有一个，
          否则 Playwright 严格模式会解析到 2 个元素。窄屏（<768px）由 hidden 隐藏。
        */}
        {!sidebarCollapsed && (
          <button
            type="button"
            onClick={onToggleSidebar}
            className="hidden shrink-0 rounded-full p-1.5 text-foreground/60 transition-colors hover:bg-foreground/10 md:inline-flex"
            aria-label={t('chat.header.collapse')}
            aria-expanded={true}
            aria-controls="chat-sidebar"
            title={t('chat.header.collapse')}
            data-testid="sidebar-toggle"
          >
            <PanelLeftClose className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* 新聊天 */}
      <div className="px-3 pt-3">
        <button
          onClick={onNew}
          disabled={disableNew}
          className="flex w-full items-center gap-2 rounded-xl border border-dashed border-sidebar-border px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          <MessageSquarePlus className="h-4 w-4" />
          {t('chat.conversation.new')}
        </button>
      </div>

      {/* 会话列表 */}
      <div className="mt-2 flex-1 overflow-y-auto px-2 pb-3">
        {conversations.length === 0 && (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">
            {t('chat.conversation.empty')}
          </p>
        )}
        {conversations.map((c) => (
          <div
            key={c.id}
            data-companion-id={c.companion_id}
            className={cn(
              'group mt-1 flex w-full items-center rounded-xl transition-colors',
              activeId === c.id ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/60',
            )}
          >
            <button
              type="button"
              data-testid={`conversation-${c.id}`}
              onClick={() => onSelect(c.id)}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              aria-label={t('chat.conversation.open_aria', { title: c.title || t('chat.conversation.untitled') })}
            >
              {c.companion_avatar && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.companion_avatar} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover object-top" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{c.title || t('chat.conversation.untitled')}</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {formatListTime(c.updated_at)}
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                onDelete(c.id);
              }}
              className="mr-2 rounded-full p-1.5 text-muted-foreground opacity-0 transition-all group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-destructive/15 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-destructive"
              aria-label={t('chat.conversation.delete_aria', { title: c.title || t('chat.conversation.untitled') })}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {hasMore && <button type="button" onClick={onLoadMore} disabled={loadingMore}
          className="mt-3 w-full rounded-xl px-3 py-2 text-sm text-muted-foreground disabled:opacity-50">
          {loadingMore ? t('chat.conversation.loading') : t('chat.conversation.earlier')}
        </button>}
      </div>
    </div>
  );
}
