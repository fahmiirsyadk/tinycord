import { EventEmitter } from "events";
import { isDebug } from "./debug-flag";
import { DiscordGateway } from "./gateway";
import { notifyMessage } from "./notify";

/**
 * Discord state layer: REST API + WebSocket gateway.
 */
export interface DiscordEmbed {
  type: string;
  url: string;
  description?: string;
  color?: number;
  timestamp?: string;
  author?: {
    name: string;
    url?: string;
  };
  image?: {
    url: string;
    proxy_url?: string;
    width?: number;
    height?: number;
  };
  footer?: {
    text: string;
    icon_url?: string;
  };
}

export interface DiscordAttachment {
  id: string;
  url: string;
  filename: string;
  content_type?: string;
}

export interface DiscordMessage {
  id: string;
  content: string;
  author: {
    id: string;
    username: string;
    displayName: string;
  };
  timestamp: Date;
  channelId: string;
  referencedMessage?: {
    authorId: string;
    author: string;
    content: string;
  };
  embeds?: DiscordEmbed[];
  attachments?: DiscordAttachment[];
}

export interface DiscordChannel {
  id: string;
  name: string;
  type: number;
}

export interface DiscordGuild {
  id: string;
  name: string;
}

export interface DiscordMember {
  id: string;
  username: string;
  displayName: string;
}

const API_BASE = "https://discord.com/api/v9";
const USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36`;
const SUPER_PROPS = Buffer.from(JSON.stringify({
  os: "Windows",
  browser: "Chrome",
  device: "",
  system_locale: "en-US",
  browser_version: "143.0.0.0",
  os_version: "10",
  client_build_number: 482285,
  release_channel: "stable",
})).toString("base64");

class DiscordState extends EventEmitter {
  private logFile: string | null = null;
  private initLogFile() {
    if (!isDebug) return;
    try {
      const fs = require("fs");
      const path = require("path");
      const logDir = path.join(process.cwd(), "logs");
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      this.logFile = path.join(logDir, "discord.log");
    } catch {}
  }
  private writeLog(msg: string) {
    if (this.logFile) {
      try {
        const fs = require("fs");
        fs.appendFileSync(this.logFile, `${new Date().toISOString()} ${msg}\n`);
      } catch {}
    }
  }

  private gateway: DiscordGateway | null = null;
  private token: string = "";
  private activeChannelId: string | null = null;
  private ready = false;
  private unreadCounts: Map<string, number> = new Map();
  private mentionCounts: Map<string, number> = new Map();
  private readStates: Map<string, string> = new Map();

  private lastRequestTime: Map<string, number> = new Map();
  private rateLimitDelay = 500;

  private guildsCache: Map<string, any> = new Map();
  private channelsCache: Map<string, any> = new Map();
  private userInfo: any = null;
  private guildMembersCache: Map<string, DiscordMember[]> = new Map();
  private connectStartTime: number = 0;

  private setupGatewayHandlers() {
    if (!this.gateway) return;

    this.gateway.on("connected", () => {
      this.writeLog("Gateway: connected, waiting for HELLO");
      this.emit("log", "Gateway: connected, waiting for HELLO");
    });

    this.gateway.on("hello", () => {
      this.writeLog("Gateway: HELLO received, sending IDENTIFY");
      this.emit("log", "Gateway: HELLO received, sending IDENTIFY");
    });

    this.gateway.on("identifying", () => {
      this.writeLog("Gateway: identifying...");
      this.emit("log", "Gateway: identifying...");
    });

    this.gateway.on("gatewayLog", (msg: string) => {
      this.writeLog(msg);
      this.emit("log", msg);
    });

    this.gateway.on("ready", (data: any) => {
      this.userInfo = data.user;

      this.writeLog(`[READY] Keys in payload: ${Object.keys(data).join(", ")}`);
      this.emit("log", `[READY] Keys in payload: ${Object.keys(data).join(", ")}`);

      if (data.guilds) {
        for (const guild of data.guilds) {
          this.guildsCache.set(guild.id, guild);
        }
      }

      if (data.private_channels) {
        for (const channel of data.private_channels) {
          this.channelsCache.set(channel.id, channel);
        }
      }

      if (data.read_state) {
        for (const state of data.read_state) {
          if (state.id) {
            if (state.last_message_id) {
              this.readStates.set(state.id, state.last_message_id);
            }
            if (state.mention_count > 0) {
              this.mentionCounts.set(state.id, state.mention_count);
            }
          }
        }
      }

      this.ready = true;
      const tag = `${data.user.username}#${data.user.discriminator || "0"}`;
      this.emit("log", `Gateway: READY -- logged in as ${tag}`);
      this.emit("ready", {
        username: data.user.username,
        tag,
      });

      this.loadGuilds().catch(console.error);
    });

    this.gateway.on("messageCreate", (data: any) => {
      const logLine = `[GATEWAY] id=${data.id} content="${(data.content || "").slice(0, 30)}" embeds=${!!data.embeds} attachments=${!!data.attachments}`;
      this.emit("log", logLine);
      const message = this.formatMessageFromGateway(data);

      if (data.channel_id === this.activeChannelId) {
        this.emit("message", message);
      } else {
        const unread = this.unreadCounts.get(data.channel_id) ?? 0;
        this.unreadCounts.set(data.channel_id, unread + 1);

        const isDm = !data.guild_id;

        if (isDm) {
          const dmChannel = this.channelsCache.get(data.channel_id);
          const channelName = dmChannel?.name || dmChannel?.recipients?.[0]?.username || "DM";

          notifyMessage(message, { name: channelName }, undefined, true, data.mentions);
        } else {
          const isMentioned = data.mentions?.some((mention: any) =>
            mention.id === this.userInfo?.id
          );

          if (isMentioned) {
            const mentions = this.mentionCounts.get(data.channel_id) ?? 0;
            this.mentionCounts.set(data.channel_id, mentions + 1);

            const guild = this.guildsCache.get(data.guild_id);
            const channelName = guild?.channels?.find((c: any) => c.id === data.channel_id)?.name || "unknown";
            const guildName = guild?.name;

            notifyMessage(message, { name: channelName }, guildName, false, data.mentions);
          }
        }

        this.emit("unreadUpdate");
      }
    });

    this.gateway.on("guildCreate", (data: any) => {
      this.guildsCache.set(data.id, data);

      this.emit("guildsUpdate");
    });

    this.gateway.on("channelCreate", (data: any) => {
      this.channelsCache.set(data.id, data);
    });

    this.gateway.on("guildMembersChunk", (data: any) => {
      const guildId = data.guild_id;
      if (!this.guildMembersCache.has(guildId)) {
        this.guildMembersCache.set(guildId, []);
      }
      const members = this.guildMembersCache.get(guildId)!;
      for (const member of data.members || []) {
        const user = member.user || {};
        members.push({
          id: user.id,
          username: user.username || "Unknown",
          displayName: member.nick || user.global_name || user.username || "Unknown",
        });
      }
      this.emit("guildMembersUpdate", guildId);
    });

    this.gateway.on("error", (error: any) => {
      console.error("Gateway error:", error);
      this.emit("error", error);
    });
  }

  private formatMessageFromGateway(data: any): DiscordMessage {
    if (data.content === undefined || data.content === null) {
      console.log(`[DEBUG] Message ${data.id} has no content:`, JSON.stringify(data).slice(0, 500));
    }
    const msg: DiscordMessage = {
      id: data.id,
      content: data.content || "",
      author: {
        id: data.author.id,
        username: data.author.username,
        displayName: data.author.global_name || data.author.username,
      },
      timestamp: new Date(data.timestamp),
      channelId: data.channel_id,
    };

    if (data.referenced_message && !data.referenced_message.system) {
      msg.referencedMessage = {
        authorId: data.referenced_message.author.id,
        author: data.referenced_message.author.global_name || data.referenced_message.author.username,
        content: data.referenced_message.content,
      };
    }

    if (data.embeds && data.embeds.length > 0) {
      msg.embeds = data.embeds;
    }

    if (data.attachments && data.attachments.length > 0) {
      msg.attachments = data.attachments.map((a: any) => ({
        id: a.id,
        url: a.url,
        filename: a.filename || "",
        content_type: a.content_type,
      }));
    }

    return msg;
  }

  private async enforceRateLimit(endpoint: string): Promise<void> {
    const now = Date.now();
    const lastTime = this.lastRequestTime.get(endpoint) || 0;
    const timeSinceLastRequest = now - lastTime;

    if (timeSinceLastRequest < this.rateLimitDelay) {
      const waitTime = this.rateLimitDelay - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime.set(endpoint, Date.now());
  }

  private async apiRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
    const cleanEndpoint = endpoint.split("?")[0] || endpoint;
    await this.enforceRateLimit(cleanEndpoint);

    const headers = {
      Authorization: this.token,
      "User-Agent": USER_AGENT,
      "X-Super-Properties": SUPER_PROPS,
      "Content-Type": "application/json",
      Origin: "https://discord.com",
      Referer: "https://discord.com/channels/@me",
      "Accept-Language": "en-US,en;q=0.9",
      ...options.headers,
    };

    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async connect(token: string): Promise<void> {
    this.initLogFile();
    const startTime = Date.now();
    this.token = token;
    this.writeLog("Gateway: connecting to wss://gateway.discord.gg");
    this.emit("log", "Gateway: connecting to wss://gateway.discord.gg");
    this.gateway = new DiscordGateway(token);
    this.setupGatewayHandlers();
    await this.gateway.connect();
    this.connectStartTime = startTime;
  }

  private async loadGuilds(): Promise<void> {
    try {
      const guildIds = Array.from(this.guildsCache.keys());
      const totalGuilds = guildIds.length;
      this.emit("log", `Guilds: loading ${totalGuilds} servers...`);

      const batchSize = 5;
      const totalBatches = Math.ceil(totalGuilds / batchSize);

      for (let i = 0; i < guildIds.length; i += batchSize) {
        const batch = guildIds.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;

        await Promise.all(
          batch.map(async (guildId) => {
            try {
              const [guildData, channels] = await Promise.all([
                this.apiRequest(`/guilds/${guildId}?with_counts=false`),
                this.apiRequest(`/guilds/${guildId}/channels`),
              ]);

              guildData.channels = channels;
              this.guildsCache.set(guildId, guildData);

              for (const channel of channels) {
                if (channel.type === 0 && channel.last_message_id) {
                  const readLastId = this.readStates.get(channel.id) || "0";
                  if (
                    channel.last_message_id !== readLastId &&
                    (channel.last_message_id.length > readLastId.length ||
                      (channel.last_message_id.length === readLastId.length && channel.last_message_id > readLastId))
                  ) {
                    if (!this.unreadCounts.has(channel.id)) {
                      this.unreadCounts.set(channel.id, 1);
                    }
                  }
                }
              }
            } catch {
            }
          })
        );

        const loadedCount = Math.min(i + batchSize, totalGuilds);
        this.emit("log", `Guilds: batch ${batchNum}/${totalBatches} loaded (${loadedCount} servers)`);
        this.emit("guildsUpdate");

        if (i + batchSize < guildIds.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      this.emit("log", `Guilds: all ${totalGuilds} servers loaded`);

      const totalTime = Date.now() - this.connectStartTime;
      this.emit("log", `Status: connected (${totalTime}ms)`);
    } catch (error) {
      console.error("Failed to load guilds:", error);
      this.emit("log", "Status: error loading guilds");
    }
  }

  async disconnect(): Promise<void> {
    this.gateway?.disconnect();
    this.gateway = null;
    this.ready = false;
    this.guildsCache.clear();
    this.channelsCache.clear();
    this.unreadCounts.clear();
    this.mentionCounts.clear();
    this.readStates.clear();
  }

  isReady(): boolean {
    return this.ready;
  }

  getGuilds(): DiscordGuild[] {
    if (!this.ready) return [];

    return Array.from(this.guildsCache.values())
      .filter((guild) => guild.id)
      .map((guild) => ({
        id: guild.id,
        name: guild.name || "Unknown Server",
      }));
  }

  getChannels(guildId: string): DiscordChannel[] {
    const guild = this.guildsCache.get(guildId);
    if (!guild || !guild.channels) return [];

    return guild.channels
      .filter((channel: any) => channel.type === 0)
      .map((channel: any) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
      }));
  }

  private async apiRequestWithRetry(endpoint: string, options: RequestInit = {}, retries = 3): Promise<any> {
    for (let i = 0; i < retries; i++) {
      try {
        return await this.apiRequest(endpoint, options);
      } catch (error: any) {
        if (error.message?.includes("429") && i < retries - 1) {
          const delay = Math.pow(2, i) * 1000;
          this.emit("rateLimitRetry", { retry: i + 1, maxRetries: retries, delay });
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }
    throw new Error("Max retries exceeded");
  }

  async getMessages(channelId: string, limit = 50): Promise<DiscordMessage[]> {
    try {
      const msgs = await this.apiRequestWithRetry(`/channels/${channelId}/messages?limit=${limit}`);
      return msgs
        .reverse()
        .map((msg: any) => this.formatMessageFromGateway(msg));
    } catch (error) {
      console.error("Failed to fetch messages:", error);
      return [];
    }
  }

  async loadOlderMessages(channelId: string, beforeId: string, limit = 50): Promise<DiscordMessage[]> {
    try {
      const msgs = await this.apiRequest(`/channels/${channelId}/messages?limit=${limit}&before=${beforeId}`);
      const formatted = msgs
        .reverse()
        .map((msg: any) => this.formatMessageFromGateway(msg));

      this.emit("messagesLoaded", channelId);
      return formatted;
    } catch (error) {
      console.error("Failed to fetch older messages:", error);
      return [];
    }
  }

  async sendMessage(channelId: string, content: string, replyToId?: string): Promise<void> {
    try {
      const payload: any = { content };
      if (replyToId) {
        payload.message_reference = { message_id: replyToId };
      }

      await this.apiRequest(`/channels/${channelId}/messages`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.error("Failed to send message:", error);
      throw error;
    }
  }

  setActiveChannel(channelId: string | null) {
    this.activeChannelId = channelId;
    if (channelId) {
      this.unreadCounts.set(channelId, 0);
      this.mentionCounts.set(channelId, 0);
      this.emit("unreadUpdate");
    }
  }

  getUnreadCount(channelId: string): number {
    return this.unreadCounts.get(channelId) ?? 0;
  }

  getMentionCount(channelId: string): number {
    return this.mentionCounts.get(channelId) ?? 0;
  }

  hasUnread(channelId: string): boolean {
    return this.getUnreadCount(channelId) > 0;
  }

  hasMention(channelId: string): boolean {
    return this.getMentionCount(channelId) > 0;
  }

  getCurrentUserTag(): string | null {
    if (!this.userInfo) return null;
    const discrim = this.userInfo.discriminator || "0";
    return `${this.userInfo.username}#${discrim}`;
  }

  getCurrentUserId(): string | null {
    return this.userInfo?.id ?? null;
  }

  getCurrentUserDisplayName(): string | null {
    if (!this.userInfo) return null;
    return this.userInfo.global_name || this.userInfo.username || null;
  }

  getChannelName(channelId: string): string | null {
    const channel = this.channelsCache.get(channelId);
    return channel?.name || null;
  }

  getGuildName(guildId: string): string | null {
    const guild = this.guildsCache.get(guildId);
    return guild?.name || null;
  }

  getPrivateChannels(): { id: string; name: string; type: number; recipients?: { id: string; username: string; displayName: string }[] }[] {
    if (!this.ready) return [];

    return Array.from(this.channelsCache.values())
      .filter((ch: any) => ch.type === 1 || ch.type === 3)
      .map((ch: any) => ({
        id: ch.id,
        name: ch.name || ch.recipients?.map((r: any) => r.username).join(", ") || "Unknown",
        type: ch.type,
        recipients: ch.recipients?.map((r: any) => ({
          id: r.id,
          username: r.username,
          displayName: r.global_name || r.username,
        })),
      }));
  }

  async searchGuildMembers(guildId: string, query: string, limit = 25): Promise<DiscordMember[]> {
    if (!query.trim()) return [];
    try {
      const encodedQuery = encodeURIComponent(query);
      const members = await this.apiRequest(
        `/guilds/${guildId}/members/search?query=${encodedQuery}&limit=${limit}`
      );
      return (members as any[]).map((m) => ({
        id: m.user.id,
        username: m.user.username,
        displayName: m.nick || m.user.global_name || m.user.username,
      }));
    } catch (error) {
      console.error("Failed to search guild members:", error);
      return [];
    }
  }

  private userProfileCache: Map<string, {
    globalName: string | null;
    username: string;
    mutualGuilds: { id: string; nick: string | null }[];
  }> = new Map();

  async getUserProfile(userId: string): Promise<{
    globalName: string | null;
    username: string;
    mutualGuilds: { id: string; nick: string | null }[];
  } | null> {
    const cached = this.userProfileCache.get(userId);
    if (cached) return cached;

    try {
      const data = await this.apiRequest(
        `/users/${userId}/profile?type=popout&with_mutual_guilds=true`
      );
      const result = {
        globalName: data.user?.global_name ?? null,
        username: data.user?.username ?? "Unknown",
        mutualGuilds: data.mutual_guilds ?? [],
      };
      this.userProfileCache.set(userId, result);
      return result;
    } catch (error) {
      console.error("Failed to fetch user profile:", error);
      return null;
    }
  }

  requestGuildMembers(guildId: string, userIds?: string[], query?: string) {
    if (this.gateway) {
      this.gateway.requestGuildMembers(guildId, userIds, query);
    }
  }

  fetchAllGuildMembers(guildId: string) {
    this.requestGuildMembers(guildId, undefined, "");
  }

  getGuildMembers(guildId: string): DiscordMember[] {
    return this.guildMembersCache.get(guildId) || [];
  }

  async getMemberDisplayName(guildId: string, userId: string): Promise<string> {
    const cached = this.guildMembersCache.get(guildId);
    const member = cached?.find(m => m.id === userId);

    if (member) {
      return member.displayName;
    }

    this.requestGuildMembers(guildId, [userId]);

    return "";
  }

  async getMembersForMessages(guildId: string, userIds: string[]): Promise<DiscordMember[]> {
    const cached = this.guildMembersCache.get(guildId) || [];

    if (userIds.length === 0) {
      return cached;
    }

    const knownIds = new Set(cached.map(m => m.id));
    const missingIds = userIds.filter(id => !knownIds.has(id));

    if (missingIds.length > 0) {
      this.requestGuildMembers(guildId, missingIds);
    }

    const results: DiscordMember[] = [];
    await Promise.all(userIds.map(async (userId) => {
      const cachedMember = cached.find(m => m.id === userId);
      if (cachedMember) {
        results.push(cachedMember);
        return;
      }

      const profile = await this.getUserProfile(userId);
      if (profile) {
        const guildMember = profile.mutualGuilds.find(g => g.id === guildId);
        const member: DiscordMember = {
          id: userId,
          username: profile.username,
          displayName: guildMember?.nick ?? profile.globalName ?? profile.username,
        };
        if (!this.guildMembersCache.has(guildId)) {
          this.guildMembersCache.set(guildId, []);
        }
        this.guildMembersCache.get(guildId)!.push(member);
        results.push(member);
      }
    }));
    return results;
  }
}

export const discordState = new DiscordState();
