import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { InputRenderable } from "@opentui/core";

const MAX_OPTIONS = 50;

export type AutocompleteMode = "@";

export type Member = { id: string; username: string; displayName: string };

export interface ChatInputWithAutocompleteHandle {
  applyMention: (member: Member) => void;
  clearMention: () => void;
}

interface MentionState {
  open: boolean;
  query: string;
  members: Member[];
}

interface ChatInputWithAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void | Promise<void>;
  placeholder?: string;
  focused: boolean;
  disabled?: boolean;
  cachedMembers: Member[];
  onAutocompleteOpenChange?: (open: boolean) => void;
  onMentionStateChange?: (state: MentionState) => void;
  replyingToMessage?: any; // DiscordMessage
}
type Option = { type: "mention"; member: Member };

function getQueryAndMode(value: string): { mode: AutocompleteMode | null; query: string } {
  const atMatch = /@([^\s@]*)$/.exec(value);
  if (atMatch) {
    const beforeAt = value.slice(0, atMatch.index);
    if (beforeAt === "" || /\s$/.test(beforeAt)) {
      const query = atMatch[1] ?? "";
      return { mode: "@", query };
    }
  }
  return { mode: null, query: "" };
}

export const ChatInputWithAutocomplete = forwardRef<
  ChatInputWithAutocompleteHandle,
  ChatInputWithAutocompleteProps
>(function ChatInputWithAutocomplete({
  value,
  onChange,
  onSubmit,
  placeholder = "Write a message... (@ mention)",
  focused,
  disabled = false,
  cachedMembers,
  onAutocompleteOpenChange,
  onMentionStateChange,
  replyingToMessage,
}, ref) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const justSelectedRef = useRef(false);
  const inputRef = useRef<InputRenderable | null>(null);
  const hasAutocompleteRef = useRef(false);
  const optionsLenRef = useRef(0);
  const valueRef = useRef(value);
  valueRef.current = value;

  const { mode, query } = useMemo(() => getQueryAndMode(value), [value]);

  const filteredMembers = useMemo(() => {
    if (mode !== "@") return [];
    if (!query) {
      return cachedMembers.slice(0, MAX_OPTIONS);
    }
    const q = query.toLowerCase();
    const matches = cachedMembers
      .filter((m) => m.username.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q))
      .sort((a, b) => {
        const aUser = a.username.toLowerCase();
        const bUser = b.username.toLowerCase();
        const aDisplay = a.displayName.toLowerCase();
        const bDisplay = b.displayName.toLowerCase();

        if (aUser === q || aDisplay === q) return -1;
        if (bUser === q || bDisplay === q) return 1;

        if (aUser.startsWith(q) || aDisplay.startsWith(q)) return -1;
        if (bUser.startsWith(q) || bDisplay.startsWith(q)) return 1;

        return 0;
      });
    return matches.slice(0, MAX_OPTIONS);
  }, [mode, query, cachedMembers]);

  const options: Option[] = useMemo(() => {
    if (mode === "@") {
      return filteredMembers.map((member) => ({ type: "mention" as const, member }));
    }
    return [];
  }, [mode, filteredMembers]);

  const hasAutocomplete = mode !== null;

  hasAutocompleteRef.current = hasAutocomplete;
  optionsLenRef.current = options.length;

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const original = input.handleKeyPress.bind(input);
    input.handleKeyPress = (key) => {
      if (hasAutocompleteRef.current) {
        const name = key.name?.toLowerCase();
        if (
          name === "up" ||
          name === "down" ||
          name === "tab" ||
          name === "escape" ||
          name === "j" ||
          name === "k"
        ) {
          return false;
        }
        if (name === "enter" || name === "return") {
          return false;
        }
      }
      return original(key);
    };

    return () => {
      input.handleKeyPress = original;
    };
  }, []);

  useEffect(() => {
    if (!hasAutocomplete || options.length === 0) {
      setSelectedIndex(0);
      return;
    }
    setSelectedIndex((i) => Math.min(i, Math.max(0, options.length - 1)));
  }, [options.length, hasAutocomplete]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    onAutocompleteOpenChange?.(focused && hasAutocomplete);
  }, [focused, hasAutocomplete, onAutocompleteOpenChange]);

  useEffect(() => {
    if (focused && hasAutocomplete) {
      onMentionStateChange?.({
        open: true,
        query,
        members: filteredMembers,
      });
    } else {
      onMentionStateChange?.({ open: false, query: "", members: [] });
    }
  }, [focused, hasAutocomplete, query, filteredMembers, onMentionStateChange]);

  const applyMention = useCallback(
    (member: Member) => {
      const v = valueRef.current;
      const replacement = `<@${member.id}>`;
      const newValue = v.replace(/@([^\s@]*)$/, replacement + " ");
      onChange(newValue);
      justSelectedRef.current = true;
      setTimeout(() => {
        justSelectedRef.current = false;
      }, 50);
    },
    [onChange]
  );

  const clearMention = useCallback(() => {
    const v = valueRef.current;
    onChange(v.replace(/@[^\s@]*$/, ""));
  }, [onChange]);

  useImperativeHandle(ref, () => ({
    applyMention,
    clearMention,
  }), [applyMention, clearMention]);

  const selectCurrent = useCallback(() => {
    if (!hasAutocomplete || options.length === 0) return;
    const opt = options[selectedIndex];
    if (!opt) return;

    justSelectedRef.current = true;
    setTimeout(() => {
      justSelectedRef.current = false;
    }, 50);

    applyMention(opt.member);
  }, [hasAutocomplete, options, selectedIndex, applyMention]);

  const handleSubmit = useCallback(
    async (submittedValue?: string) => {
      if (justSelectedRef.current) {
        return;
      }

      const toSend = (submittedValue ?? value).trim();
      if (!toSend || disabled) return;

      if (hasAutocomplete && options.length > 0) {
        selectCurrent();
        return;
      }

      await onSubmit(toSend);
      onChange("");
    },
    [value, disabled, hasAutocomplete, options.length, selectCurrent, onSubmit, onChange]
  );

  const inputElement = (
    <input
      ref={(r: InputRenderable) => { inputRef.current = r; }}
      value={value}
      onInput={(next) => {
        onChange(next ?? "");
      }}
      onSubmit={(submittedValue) => {
        if (typeof submittedValue === "string") {
          void handleSubmit(submittedValue);
        }
      }}
      placeholder={placeholder}
      focused={focused}
      width="100%"
    />
  );

  return (
    <box marginTop={1} flexDirection="column">
      {replyingToMessage && (() => {
        const snip = replyingToMessage.content.length > 50
          ? replyingToMessage.content.slice(0, 47) + "..."
          : replyingToMessage.content;
        return (
          <box flexDirection="column" marginBottom={0}>
            <text fg="gray">{`┌── Replying to @${replyingToMessage.author.displayName}:`}</text>
            <text fg="gray">{`│ > ${snip}`}</text>
            <text fg="gray">└──────────────</text>
          </box>
        );
      })()}
      {inputElement}
    </box>
  );
});
