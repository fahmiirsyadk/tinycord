/**
 * Shared TypeScript types for the Discord TUI client
 */

export type FocusedPanel = "guilds" | "messages" | "input";

export interface SelectedGuild {
  id: string;
  name: string;
}

export interface SelectedChannel {
  id: string;
  name: string;
  guildId: string;
}
