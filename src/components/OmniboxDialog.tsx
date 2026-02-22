import type { DiscordGuild, DiscordChannel } from "../discord";

export type OmniboxItem = 
  | { type: "channel"; guild: DiscordGuild; channel: DiscordChannel }
  | { type: "dm"; id: string; name: string; recipients?: { id: string; username: string; displayName: string }[] };

interface OmniboxDialogProps {
  open: boolean;
  searchQuery: string;
  items: OmniboxItem[];
  cursor: number;
}

const LIST_HEIGHT = 14;

function fuzzyMatch(text: string, query: string): boolean {
  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();
  
  if (textLower.includes(queryLower)) return true;
  
  let queryIdx = 0;
  for (let i = 0; i < textLower.length && queryIdx < queryLower.length; i++) {
    if (textLower[i] === queryLower[queryIdx]) {
      queryIdx++;
    }
  }
  return queryIdx === queryLower.length;
}

export function OmniboxDialog({
  open,
  searchQuery,
  items,
  cursor,
}: OmniboxDialogProps) {
  if (!open) return null;

  const filteredItems = searchQuery.trim()
    ? items.filter(item => {
        if (item.type === "channel") {
          return fuzzyMatch(item.guild.name, searchQuery) || 
                 fuzzyMatch(item.channel.name, searchQuery);
        } else {
          return fuzzyMatch(item.name, searchQuery);
        }
      })
    : items;

  const finalItems = searchQuery.trim() ? filteredItems : items;
  const finalCursor = searchQuery.trim() 
    ? Math.min(cursor, Math.max(0, finalItems.length - 1))
    : cursor;

  const finalStartIndex = Math.max(
    0,
    Math.min(finalCursor - Math.floor(LIST_HEIGHT / 2), Math.max(0, finalItems.length - LIST_HEIGHT))
  );
  const finalEndIndex = Math.min(finalStartIndex + LIST_HEIGHT, finalItems.length);
  const displayItems = finalItems.slice(finalStartIndex, finalEndIndex);

  return (
    <box
      position="absolute"
      left={2}
      top={3}
      right={2}
      zIndex={100}
      border
      borderStyle="rounded"
      borderColor="gray"
      backgroundColor="#1a1a1a"
      paddingX={1}
      paddingY={1}
    >
      <box marginBottom={1} flexDirection="row">
        <text fg="white">Quick Switcher</text>
        <text fg="gray">  j/k or arrows, Enter select, Esc close</text>
      </box>
      <box marginBottom={1} flexDirection="row">
        <text fg="gray">Search: </text>
        <text fg={searchQuery ? "white" : "gray"}>
          {searchQuery || "type to search servers, channels, or DMs..."}
        </text>
      </box>
      {finalItems.length === 0 ? (
        <box>
          <text fg="gray">
            {searchQuery.trim() ? "No results." : "No items."}
          </text>
        </box>
      ) : (
        <box flexDirection="column">
          {displayItems.map((item, i) => {
            const absoluteIndex = finalStartIndex + i;
            const isSelected = absoluteIndex === finalCursor;

            if (item.type === "dm") {
              return (
                <box
                  key={item.id}
                  backgroundColor={isSelected ? "#2d3748" : undefined}
                  flexDirection="row"
                >
                  <text fg={isSelected ? "white" : "gray"}>
                    {isSelected ? "> " : "  "}
                  </text>
                  <text fg={isSelected ? "white" : "#a0aec0"}>
                    {item.name}
                  </text>
                  <text fg="gray"> [DM]</text>
                </box>
              );
            }

            const label = `#${item.channel.name}`;
            const channelType = item.channel.type === 2 ? " [voice]" : item.channel.type === 13 ? " [stage]" : "";
            return (
              <box
                key={`${item.guild.id}-${item.channel.id}`}
                backgroundColor={isSelected ? "#2d3748" : undefined}
                flexDirection="row"
              >
                <text fg={isSelected ? "white" : "gray"}>
                  {isSelected ? "> " : "  "}
                </text>
                <text fg={isSelected ? "white" : "#a0aec0"}>
                  {label}{channelType}
                </text>
              </box>
            );
          })}
        </box>
      )}
    </box>
  );
}
