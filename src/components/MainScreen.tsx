import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useKeyboard, useTerminalDimensions, useRenderer } from "@opentui/react";
import { discordState, type DiscordGuild, type DiscordChannel, type DiscordMessage, type DiscordMember } from "../discord";
import { MessageList } from "./MessageList";
import { ChatInputWithAutocomplete, type ChatInputWithAutocompleteHandle } from "./ChatInputWithAutocomplete";
import { OmniboxDialog, type OmniboxItem } from "./OmniboxDialog";
import { MentionDialog } from "./MentionDialog";

type FocusZone = "messages" | "chat";

interface MainScreenProps {
  serverWhitelist?: string;
}

interface ChatComposerProps {
  selectedChannel: DiscordChannel | null;
  focused: boolean;
  onSendMessage: (channelId: string, content: string, replyToId?: string) => Promise<boolean>;
  cachedMembers: { id: string; username: string; displayName: string }[];
  onAutocompleteOpenChange: (open: boolean) => void;
  onMentionStateChange: (state: { open: boolean; query: string; members: { id: string; username: string; displayName: string }[] }) => void;
  chatInputRef: RefObject<ChatInputWithAutocompleteHandle | null>;
  replyingToMessage: DiscordMessage | null;
  onCancelReply: () => void;
}

function ChatComposer({
  selectedChannel,
  focused,
  onSendMessage,
  cachedMembers,
  onAutocompleteOpenChange,
  onMentionStateChange,
  chatInputRef,
  replyingToMessage,
  onCancelReply,
}: ChatComposerProps) {
  const [chatValue, setChatValue] = useState("");

  if (!selectedChannel) return null;

  return (
    <ChatInputWithAutocomplete
      ref={chatInputRef}
      value={chatValue}
      onChange={setChatValue}
      onSubmit={async (content) => {
        const ok = await onSendMessage(selectedChannel.id, content, replyingToMessage?.id);
        if (ok) {
          setChatValue("");
          onCancelReply();
        }
      }}
      placeholder="> Write a message... (@ mention)"
      focused={focused}
      cachedMembers={cachedMembers}
      onAutocompleteOpenChange={onAutocompleteOpenChange}
      onMentionStateChange={onMentionStateChange}
      replyingToMessage={replyingToMessage}
    />
  );
}

export function MainScreen({ serverWhitelist }: MainScreenProps = {}) {
  const renderer = useRenderer();
  const { width } = useTerminalDimensions();
  const [focus, setFocus] = useState<FocusZone>("messages");

  const [selectedGuild, setSelectedGuild] = useState<DiscordGuild | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<DiscordChannel | null>(null);

  const [messages, setMessages] = useState<DiscordMessage[]>([]);
  const [sendingIds, setSendingIds] = useState<Set<string>>(new Set());
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [chatAutocompleteOpen, setChatAutocompleteOpen] = useState(false);
  const [omniboxOpen, setOmniboxOpen] = useState(false);
  const [omniboxCursor, setOmniboxCursor] = useState(0);
  const [omniboxSearch, setOmniboxSearch] = useState("");
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionMembers, setMentionMembers] = useState<{ id: string; username: string; displayName: string }[]>([]);
  const [mentionCursor, setMentionCursor] = useState(0);
  const [messageCursor, setMessageCursor] = useState(-1);
  const [replyingToMessage, setReplyingToMessage] = useState<DiscordMessage | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [rateLimitStatus, setRateLimitStatus] = useState<string | null>(null);
  const [cachedMembers, setCachedMembers] = useState<DiscordMember[]>([]);
  const chatInputRef = useRef<ChatInputWithAutocompleteHandle | null>(null);

  const [dataVersion, setDataVersion] = useState(0);
  const [unreadVersion, setUnreadVersion] = useState(0);

  const hideTimestamps = width < 60;

  useEffect(() => {
    const onUpdate = () => setDataVersion((v) => v + 1);
    const onUnread = () => setUnreadVersion((v) => v + 1);
    const onMessage = (msg: DiscordMessage) => {
      const currentId = discordState.getCurrentUserId();
      const isCurrentUser = msg.author.id === currentId;
      const now = Date.now();
      
      setMessages((prev) => {
        let filtered = prev;
        if (isCurrentUser) {
          filtered = prev.filter(m => {
            if (!m.id.startsWith("sending-")) return true;
            if (m.author.id !== currentId && m.author.id !== "me") return true;
            if (m.content !== msg.content) return true;
            const msgTime = m.timestamp.getTime();
            if (now - msgTime > 10000) return true;
            return false;
          });
        }
        return [...filtered, msg];
      });
    };
    const onRateLimitRetry = (info: { retry: number; maxRetries: number; delay: number }) => {
      setRateLimitStatus(`Rate limited! Retrying in ${info.delay / 1000}s... (${info.retry}/${info.maxRetries})`);
    };

    const onGuildMembersUpdate = async () => {
      if (!selectedGuild?.id) return;
      const userIds = [...new Set(messages.map(m => m.author.id))];
      const members = await discordState.getMembersForMessages(selectedGuild.id, userIds);
      setCachedMembers(members);
    };

    discordState.on("ready", onUpdate);
    discordState.on("guildsUpdate", onUpdate);
    discordState.on("unreadUpdate", onUnread);
    discordState.on("message", onMessage);
    discordState.on("rateLimitRetry", onRateLimitRetry);
    discordState.on("guildMembersUpdate", onGuildMembersUpdate);

    return () => {
      discordState.off("ready", onUpdate);
      discordState.off("guildsUpdate", onUpdate);
      discordState.off("unreadUpdate", onUnread);
      discordState.off("message", onMessage);
      discordState.off("rateLimitRetry", onRateLimitRetry);
      discordState.off("guildMembersUpdate", onGuildMembersUpdate);
    };
  }, [messages, selectedGuild?.id]);

  const guilds = useMemo(() => {
    const all = discordState.getGuilds();
    if (!serverWhitelist?.trim()) return all;
    const w = serverWhitelist.trim().toLowerCase();
    return all.filter((g) => g.name.toLowerCase() === w);
  }, [dataVersion, serverWhitelist]);

  const omniboxItems: OmniboxItem[] = useMemo(() => {
    const list: OmniboxItem[] = [];
    for (const guild of guilds) {
      const channels = discordState.getChannels(guild.id);
      for (const channel of channels) {
        list.push({
          type: "channel",
          guild,
          channel,
        });
      }
    }
    const dms = discordState.getPrivateChannels();
    for (const dm of dms) {
      list.push({
        type: "dm",
        id: dm.id,
        name: dm.name,
        recipients: dm.recipients,
      });
    }
    return list;
  }, [guilds, dataVersion]);

  const filteredOmniboxItems = useMemo(() => {
    if (!omniboxSearch.trim()) return omniboxItems;
    const q = omniboxSearch.toLowerCase().trim();
    return omniboxItems.filter((item) => {
      if (item.type === "channel") {
        return item.guild.name.toLowerCase().includes(q) ||
               item.channel.name.toLowerCase().includes(q);
      } else {
        return item.name.toLowerCase().includes(q);
      }
    });
  }, [omniboxItems, omniboxSearch]);

  useEffect(() => {
    if (omniboxOpen && filteredOmniboxItems.length > 0) {
      setOmniboxCursor((c) =>
        Math.min(c, filteredOmniboxItems.length - 1)
      );
    }
  }, [omniboxOpen, filteredOmniboxItems.length]);

  useEffect(() => {
    if (mentionOpen && mentionMembers.length > 0) {
      setMentionCursor((c) => Math.min(c, mentionMembers.length - 1));
    }
  }, [mentionOpen, mentionMembers.length]);




  const handleMentionStateChange = useCallback(
    (state: { open: boolean; query: string; members: { id: string; username: string; displayName: string }[] }) => {
      setMentionOpen(state.open);
      setMentionQuery(state.query);
      setMentionMembers(state.members);
      if (state.open) {
        setMentionCursor(0);
      }
    },
    []
  );

  const handleSelectChannel = useCallback(async (guild: DiscordGuild, channel: DiscordChannel) => {
    setSelectedGuild(guild);
    setSelectedChannel(channel);
    setMessages([]);
    setMessagesLoading(true);
    setReplyingToMessage(null);
    setRateLimitStatus(null);
    setCachedMembers([]);
    discordState.setActiveChannel(channel.id);

    discordState.fetchAllGuildMembers(guild.id);

    try {
      const loaded = await discordState.getMessages(channel.id);
      setMessages(loaded);
      setMessageCursor(-1);

      const userIds = [...new Set(loaded.map(m => m.author.id))];
      const members = await discordState.getMembersForMessages(guild.id, userIds);
      setCachedMembers(members);
    } catch {
    } finally {
      setMessagesLoading(false);
      setFocus("chat");
    }
  }, []);

  const handleOpenDm = useCallback(async (channelId: string) => {
    const dm = discordState.getPrivateChannels().find(d => d.id === channelId);
    if (!dm) return;

    const fakeGuild: DiscordGuild = { id: "dm", name: "Direct Messages" };
    const fakeChannel: DiscordChannel = { id: dm.id, name: dm.name, type: dm.type };

    setSelectedGuild(fakeGuild);
    setSelectedChannel(fakeChannel);
    setMessages([]);
    setMessagesLoading(true);
    setReplyingToMessage(null);
    discordState.setActiveChannel(channelId);

    try {
      const loaded = await discordState.getMessages(channelId);
      setMessages(loaded);
      setMessageCursor(-1);
    } catch {
    } finally {
      setMessagesLoading(false);
      setFocus("chat");
    }
  }, []);

  useEffect(() => {
    if (!serverWhitelist?.trim() || guilds.length === 0 || selectedChannel) return;
    const guild = guilds[0]!;
    const channels = discordState.getChannels(guild.id);
    const general =
      channels.find((c) => c.name.toLowerCase() === "general") ?? channels[0];
    if (general) {
      void handleSelectChannel(guild, general);
    }
  }, [serverWhitelist, guilds, selectedChannel, handleSelectChannel]);

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      void discordState.disconnect().then(() => {
        renderer.destroy();
      });
      key.preventDefault();
      return;
    }

    if (mentionOpen) {
      if (key.name === "escape") {
        chatInputRef.current?.clearMention();
        setMentionOpen(false);
        key.preventDefault();
        return;
      }
      if (key.name === "down" || key.name === "j") {
        setMentionCursor((c) =>
          mentionMembers.length === 0 ? 0 : Math.min(c + 1, mentionMembers.length - 1)
        );
        key.preventDefault();
        return;
      }
      if (key.name === "up" || key.name === "k") {
        setMentionCursor((c) => Math.max(0, c - 1));
        key.preventDefault();
        return;
      }
      if (key.name === "enter" || key.name === "return") {
        const member = mentionMembers[mentionCursor];
        if (member) {
          chatInputRef.current?.applyMention(member);
        }
        setMentionOpen(false);
        key.preventDefault();
        return;
      }
      if (key.name === "tab") {
        key.preventDefault();
        return;
      }
      return;
    }

    if (omniboxOpen) {
      if (key.name === "escape") {
        setOmniboxOpen(false);
        key.preventDefault();
        return;
      }
      if (key.name === "backspace") {
        setOmniboxSearch((s) => s.slice(0, -1));
        key.preventDefault();
        return;
      }
      if (key.name === "down" || key.name === "j") {
        setOmniboxCursor((c) =>
          filteredOmniboxItems.length === 0
            ? 0
            : Math.min(c + 1, filteredOmniboxItems.length - 1)
        );
        key.preventDefault();
        return;
      }
      if (key.name === "up" || key.name === "k") {
        setOmniboxCursor((c) => Math.max(0, c - 1));
        key.preventDefault();
        return;
      }
      if (key.name === "enter" || key.name === "return") {
        const item = filteredOmniboxItems[omniboxCursor];
        if (item) {
          if (item.type === "channel") {
            void handleSelectChannel(item.guild, item.channel);
          } else if (item.type === "dm") {
            void handleOpenDm(item.id);
          }
          setOmniboxOpen(false);
        }
        key.preventDefault();
        return;
      }
      if (
        !key.ctrl &&
        !key.meta &&
        (key.name === "space" || (key.name.length === 1 && key.name >= " "))
      ) {
        const char = key.name === "space" ? " " : key.name;
        setOmniboxSearch((s) => s + char);
        setOmniboxCursor(0);
        key.preventDefault();
        return;
      }
      key.preventDefault();
      return;
    }

    if ((key.ctrl || key.meta) && key.name === "k") {
      setOmniboxOpen(true);
      setOmniboxCursor(0);
      setOmniboxSearch("");
      key.preventDefault();
      return;
    }

    if (focus === "chat" && !mentionOpen) {
      if (key.name === "escape" && replyingToMessage) {
        setReplyingToMessage(null);
        key.preventDefault();
        return;
      }
    }

    if (focus === "messages" && !omniboxOpen && !mentionOpen) {
      if (key.name === "down" || key.name === "j") {
        setMessageCursor((c) =>
          messages.length === 0 ? -1 : Math.min(c + 1, messages.length - 1)
        );
        key.preventDefault();
        return;
      }
      if (key.name === "up" || key.name === "k") {
        setMessageCursor((c) => (c <= -1 ? -1 : c - 1));
        key.preventDefault();
        return;
      }
      if (key.name === "escape") {
        setMessageCursor(-1);
        setReplyingToMessage(null);
        key.preventDefault();
        return;
      }
      if (key.name === "enter" || key.name === "return") {
        if (messageCursor === -1) {
          if (!loadingOlder && messages.length > 0 && selectedChannel) {
            setLoadingOlder(true);
            const oldestId = messages[0]!.id;
            discordState.loadOlderMessages(selectedChannel.id, oldestId).then((olderMsgs) => {
              setMessages((prev) => [...olderMsgs, ...prev]);
              setLoadingOlder(false);
              setMessageCursor(olderMsgs.length - 1);
            }).catch(() => {
              setLoadingOlder(false);
            });
          }
        } else if (messageCursor >= 0 && messageCursor < messages.length) {
          setReplyingToMessage(messages[messageCursor]!);
          setMessageCursor(-2);
          setFocus("chat");
        }
        key.preventDefault();
        return;
      }
    }

    if (key.name === "tab") {
      setFocus((prev) => {
        if (prev === "messages") return "chat";
        if (prev === "chat") {
          return "messages";
        }
        return prev;
      });
      if (focus === "chat" && messageCursor === -2 && messages.length > 0) {
        setMessageCursor(messages.length - 1);
      } else if (focus === "chat" && messageCursor === -1) {
        setMessageCursor(messages.length > 0 ? messages.length - 1 : -1);
      }
      key.preventDefault();
      return;
    }
  });

  const memberById = useMemo(() => {
    const m = new Map<string, { displayName: string }>();
    for (const member of cachedMembers) {
      m.set(member.id, { displayName: member.displayName });
    }
    return m;
  }, [cachedMembers]);

  const currentUserId = discordState.getCurrentUserId();
  const userTag = discordState.getCurrentUserTag() || "unknown";
  const currentUserDisplayName = discordState.getCurrentUserDisplayName() || userTag;
  const handleSendMessage = useCallback(
    async (channelId: string, content: string, replyToId?: string): Promise<boolean> => {
      const tempId = `sending-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const resolvingMessage = replyToId ? messages.find(m => m.id === replyToId) : undefined;
      const tempMessage: DiscordMessage = {
        id: tempId,
        content,
        author: {
          id: currentUserId || "me",
          username: userTag,
          displayName: currentUserDisplayName,
        },
        timestamp: new Date(),
        channelId,
        referencedMessage: resolvingMessage ? {
          author: resolvingMessage.author.displayName,
          content: resolvingMessage.content,
        } : undefined,
      };
      setMessages((prev) => [...prev, tempMessage]);
      setSendingIds((prev) => new Set(prev).add(tempId));

      try {
        await discordState.sendMessage(channelId, content, replyToId);
        setSendingIds((prev) => {
          const next = new Set(prev);
          next.delete(tempId);
          return next;
        });
        return true;
      } catch {
        setSendingIds((prev) => {
          const next = new Set(prev);
          next.delete(tempId);
          return next;
        });
        return false;
      }
    },
    [userTag, currentUserDisplayName, currentUserId, messages]
  );
  const statusLine =
    selectedGuild && selectedChannel
      ? `${selectedGuild.name} | #${selectedChannel.name}`
      : selectedGuild
        ? `${selectedGuild.name}`
        : "No server selected";

  return (
    <box flexGrow={1} flexDirection="column" paddingX={2} paddingY={1} position="relative">
      <OmniboxDialog
        open={omniboxOpen}
        searchQuery={omniboxSearch}
        items={filteredOmniboxItems}
        cursor={omniboxCursor}
      />
      <MentionDialog
        open={mentionOpen}
        searchQuery={mentionQuery}
        items={mentionMembers}
        cursor={mentionCursor}
      />

      <ascii-font text="tinycord" font="tiny" />
      <box marginTop={1}><text>Connected as {userTag}</text></box>
      <box><text>{statusLine}</text></box>
      {rateLimitStatus && (
        <box>
          <text fg="yellow">{rateLimitStatus}</text>
        </box>
      )}
      {!selectedChannel && (
        <box marginTop={1}>
          <text fg="gray">Press Ctrl+K to search servers, channels, and DMs</text>
        </box>
      )}
      {selectedChannel && (
        <box flexGrow={1} flexDirection="column" marginTop={1}>
          <MessageList
            messages={messages}
            focused={focus === "messages"}
            loading={messagesLoading}
            hideTimestamps={hideTimestamps}
            currentUserId={currentUserId}
            memberById={memberById}
            cursorIndex={messageCursor}
            loadingOlder={loadingOlder}
          />
        </box>
      )}
      {selectedChannel && (
        <ChatComposer
          selectedChannel={selectedChannel}
          focused={focus === "chat"}
          onSendMessage={handleSendMessage}
          cachedMembers={cachedMembers}
          onAutocompleteOpenChange={setChatAutocompleteOpen}
          onMentionStateChange={handleMentionStateChange}
          chatInputRef={chatInputRef}
          replyingToMessage={replyingToMessage}
          onCancelReply={() => setReplyingToMessage(null)}
        />
      )}

      <box position="absolute" right={2} bottom={0}>
        <text fg="gray">
          Ctrl+K search | {focus === 'chat' ? 'Tab msg history' : 'Tab chat | ↑/↓ reply'}
        </text>
      </box>
    </box>
  );
}

