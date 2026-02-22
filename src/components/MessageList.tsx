import type { DiscordMessage, DiscordEmbed } from "../discord";
import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { useKeyboard } from "@opentui/react";

interface MessageListProps {
  messages: DiscordMessage[];
  focused: boolean;
  loading: boolean;
  hideTimestamps: boolean;
  currentUserId: string | null;
  memberById: Map<string, { displayName: string }>;
  cursorIndex: number;
  loadingOlder?: boolean;
}

type ContentSegment = { type: "text"; value: string } | { type: "mention"; id: string; displayName: string };

function renderContentSegments(
  segments: ContentSegment[],
  currentUserId: string | null
) {
  return segments.map((seg, i) =>
    seg.type === "text" ? (
      <text key={i}>{seg.value}</text>
    ) : (
      <text
        key={i}
        fg={seg.id === "me" || seg.id === currentUserId ? MENTION_ME_FG : MENTION_OTHER_FG}
      >
        @{seg.displayName}
      </text>
    )
  );
}

function parseContentWithMentions(
  content: string,
  memberById: Map<string, { displayName: string }>
): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const re = /<@(\d+)>/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > lastIndex) {
      segments.push({ type: "text", value: content.slice(lastIndex, m.index) });
    }
    const id = m[1]!;
    const displayName = memberById.get(id)?.displayName ?? id;
    segments.push({ type: "mention", id, displayName });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < content.length) {
    segments.push({ type: "text", value: content.slice(lastIndex) });
  }
  return segments.length > 0 ? segments : [{ type: "text", value: content }];
}

const AUTHOR_ME_FG = "#5b9bd5";
const AUTHOR_OTHER_FG = "#57a657";
const MENTION_ME_FG = "#5b9bd5";
const MENTION_OTHER_FG = "#57a657";

function renderEmbed(
  embed: DiscordEmbed,
  isSelected: boolean,
  focused: boolean
) {
  const fg = isSelected ? (focused ? "white" : "gray") : "gray";
  const lines: any[] = [];

  if (embed.author?.name) {
    lines.push(<text key="author" fg="#1d9bf0">{embed.author.name}</text>);
  }

  if (embed.description) {
    const desc = embed.description.length > 80 ? embed.description.slice(0, 77) + "..." : embed.description;
    lines.push(<text key="desc" fg={fg}>{desc}</text>);
  }

  if (embed.image?.url) {
    lines.push(<text key="img" fg="gray">[Press U to view image {embed.image.width}x{embed.image.height}]</text>);
  }

  if (embed.footer?.text) {
    lines.push(<text key="footer" fg="gray"> via {embed.footer.text}</text>);
  }

  return lines;
}

/**
 * Scrollable message history - auto-scrolls to bottom (latest messages)
 * Author: me = blue, others = green. Mentions: tag me = blue, tag others = green.
 */
export function MessageList({
  messages,
  focused,
  loading,
  hideTimestamps,
  currentUserId,
  memberById,
  cursorIndex,
  loadingOlder,
}: MessageListProps) {
  const listRef = useRef<any>(null);

  useEffect(() => {
    const scrollbox = listRef.current;
    if (!scrollbox || cursorIndex < -1) return;

    if (cursorIndex === -1) {
      scrollbox.scrollTo(0);
      return;
    }

    const children = scrollbox.getChildren ? scrollbox.getChildren() : [];
    const targetIdx = cursorIndex + 1;
    const targetChild = children[targetIdx];

    if (targetChild && scrollbox.content && scrollbox.viewport) {
      const top = (targetChild.y ?? 0) - (scrollbox.content.y ?? 0);
      const bottom = top + (targetChild.height ?? 0);
      const viewportHeight = scrollbox.viewport.height ?? 0;
      const currentScroll = scrollbox.scrollTop;
      if (bottom > currentScroll + viewportHeight) {
        scrollbox.scrollTo(bottom - viewportHeight);
      } else if (top < currentScroll) {
        scrollbox.scrollTo(top);
      }
    }
  }, [cursorIndex, loadingOlder]);

  useKeyboard(
    useCallback((key) => {
      if (!focused) return true;

      const name = key.name?.toLowerCase();

      if (name === "u" && cursorIndex >= 0 && cursorIndex < messages.length) {
        const msg = messages[cursorIndex];
        if (!msg) return true;
        if (msg.embeds && msg.embeds.length > 0) {
          const embed = msg.embeds[0];
          if (embed?.image?.url) {
            Bun.spawn(["xdg-open", embed.image.url], { stdout: "ignore", stderr: "ignore" });
          } else if (embed?.url) {
            Bun.spawn(["xdg-open", embed.url], { stdout: "ignore", stderr: "ignore" });
          }
        }
        return false;
      }

      return true;
    }, [focused, cursorIndex, messages])
  );

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  const parsedMessages = useMemo(() => {
    return messages.map((msg) => {
      const isCurrentUser = msg.author.id === "me" || msg.author.id === currentUserId;
      const authorFg = isCurrentUser ? AUTHOR_ME_FG : AUTHOR_OTHER_FG;
      const contentSegments = parseContentWithMentions(msg.content, memberById);
      const authorName = memberById.get(msg.author.id)?.displayName ?? msg.author.displayName;
      return { msg, authorFg, contentSegments, authorName };
    });
  }, [messages, currentUserId, memberById]);

  if (loading) {
    return (
      <scrollbox ref={listRef} flexGrow={1} focused={focused} stickyScroll stickyStart="bottom">
        <text>Loading conversation...</text>
      </scrollbox>
    );
  }

  if (messages.length === 0) {
    return (
      <scrollbox ref={listRef} flexGrow={1} focused={focused} stickyScroll stickyStart="bottom">
        <text>{" "}</text>
      </scrollbox>
    );
  }

  return (
    <scrollbox
      ref={listRef}
      flexGrow={1}
      focused={focused}
      stickyScroll
      stickyStart="bottom"
    >
      {loadingOlder ? (
        <box justifyContent="center">
          <text fg="gray">Loading older messages...</text>
        </box>
      ) : (
        <box
          flexDirection="column"
          backgroundColor={cursorIndex === -1 && focused ? "#2d3748" : undefined}
        >
          <text fg={cursorIndex === -1 ? (focused ? "white" : "gray") : "gray"}>
            {cursorIndex === -1 ? "> ┌──────────────[ press enter to load message ]────────────────┐" : "  ┌──────────────[ press enter to load message ]────────────────┐"}
          </text>
        </box>
      )}
      {parsedMessages.map(({ msg, authorFg, contentSegments, authorName }, idx) => {
        const isSelected = idx === cursorIndex;

        return (
          <box key={msg.id} flexDirection="column" backgroundColor={isSelected ? "#2d3748" : undefined}>
            {msg.referencedMessage && (
              <box flexDirection="row" paddingLeft={!hideTimestamps ? 9 : 2}>
                <text fg="gray">
                  {` ┌── @${memberById.get(msg.referencedMessage.authorId)?.displayName ?? msg.referencedMessage.author}: ${msg.referencedMessage.content.length > 50
                    ? msg.referencedMessage.content.slice(0, 47) + "..."
                    : msg.referencedMessage.content
                    }`}
                </text>
              </box>
            )}
            <box flexDirection="row">
              <text fg={isSelected ? (focused ? "white" : "gray") : "gray"}>{isSelected ? "> " : "  "}</text>
              {!hideTimestamps && <text>{formatTime(msg.timestamp)} </text>}
              <text fg={authorFg}>{authorName}:</text>
              {msg.content ? <text> </text> : null}
              {msg.content
                ? renderContentSegments(contentSegments, currentUserId)
                : null}
              {msg.attachments?.length
                ? <text fg="gray"> [{msg.attachments.map(a => `${a.filename || "file"} attachment`).join(", ")}]</text>
                : null}
            </box>
            {msg.embeds && msg.embeds.length > 0 && (
              <box flexDirection="column" paddingLeft={isSelected ? 2 : 4} marginTop={1}>
                {msg.embeds.map((embed, embedIdx) => (
                  <box key={embedIdx} flexDirection="column">
                    {renderEmbed(embed, isSelected, focused)}
                  </box>
                ))}
              </box>
            )}
          </box>
        );
      })}
    </scrollbox>
  );
}
