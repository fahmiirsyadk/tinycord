import { $ } from "bun";
import type { DiscordMessage } from "./discord";

function parseMentions(content: string, mentions?: { id: string; username: string; global_name?: string }[]): string {
  if (!mentions) return content;
  
  let result = content;
  for (const mention of mentions) {
    const displayName = mention.global_name || mention.username;
    result = result.replace(new RegExp(`<@!?${mention.id}>`, "g"), `@${displayName}`);
  }
  return result;
}

export async function notifyMessage(
  message: DiscordMessage,
  channel: { name: string } | null,
  guildName?: string,
  isDm: boolean = false,
  rawMentions?: { id: string; username: string; global_name?: string }[]
): Promise<void> {
  try {
    let title = message.author.displayName || message.author.username;
    
    if (isDm) {
      title += " (DM)";
    } else if (channel?.name) {
      title += ` (#${channel.name}${guildName ? `, ${guildName}` : ""})`;
    }

    let content = parseMentions(message.content, rawMentions);
    content = content.length > 100
      ? content.substring(0, 97) + "..."
      : content;

    await $`notify-send -a tinycord -u normal --hint=int:transient:1 ${title} ${content}`.quiet();
  } catch (error) {
    // Silent fail - notifications are nice-to-have
  }
  
  try {
    $`paplay /usr/share/sounds/freedesktop/stereo/message.oga`.quiet();
  } catch {
    // Silent fail for sound
  }
}
