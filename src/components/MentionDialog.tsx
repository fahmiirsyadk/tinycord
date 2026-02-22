type Member = { id: string; username: string; displayName: string };

interface MentionDialogProps {
  open: boolean;
  searchQuery: string;
  items: Member[];
  cursor: number;
}

const LIST_HEIGHT = 10;

/**
 * Dialog overlay for @ mention picker. Type to filter, j/k or arrows, Enter select, Esc close.
 */
export function MentionDialog({
  open,
  searchQuery,
  items,
  cursor,
}: MentionDialogProps) {
  if (!open) return null;

  const startIndex = Math.max(
    0,
    Math.min(cursor - Math.floor(LIST_HEIGHT / 2), items.length - LIST_HEIGHT)
  );
  const endIndex = Math.min(startIndex + LIST_HEIGHT, items.length);
  const visibleItems = items.slice(startIndex, endIndex);

  return (
    <box
      position="absolute"
      left={2}
      top={4}
      right={2}
      zIndex={100}
      border
      borderStyle="rounded"
      borderColor="gray"
      backgroundColor="#1a1a1a"
      paddingX={1}
      paddingY={1}
    >
      <box marginBottom={1}>
        <text fg="white">@ Mention</text>
        <text fg="gray">  j/k or arrows, Enter select, Esc close</text>
      </box>
      <box marginBottom={1} flexDirection="row">
        <text fg="gray">Filter: </text>
        <text fg={searchQuery ? "white" : "gray"}>
          {searchQuery || "type to search members..."}
        </text>
      </box>
      {items.length === 0 ? (
        <box>
          <text fg="gray">
            {searchQuery.trim() ? "No matching members." : "No members in this channel yet."}
          </text>
        </box>
      ) : (
        <box flexDirection="column">
          {visibleItems.map((member, i) => {
            const absoluteIndex = startIndex + i;
            const isSelected = absoluteIndex === cursor;
            const label = `${member.displayName} (@${member.username})`;
            return (
              <box
                key={member.id}
                backgroundColor={isSelected ? "#2d3748" : undefined}
              >
                <text fg={isSelected ? "white" : undefined}>
                  {isSelected ? "> " : "  "}
                  {label}
                </text>
              </box>
            );
          })}
        </box>
      )}
    </box>
  );
}
