import { EventEmitter } from "events";

/**
 * Raw Discord Gateway WebSocket client
 * Mirrors Discordo's gateway implementation with browser fingerprint spoofing
 */

const OS = "Windows";
const BROWSER = "Chrome";

// Gateway opcodes
const OP_DISPATCH = 0;
const OP_HEARTBEAT = 1;
const OP_IDENTIFY = 2;
const OP_RESUME = 6;
const OP_RECONNECT = 7;
const OP_REQUEST_GUILD_MEMBERS = 8;
const OP_INVALID_SESSION = 9;
const OP_HELLO = 10;
const OP_HEARTBEAT_ACK = 11;

interface GatewayPayload {
  op: number;
  d: any;
  s: number | null;
  t: string | null;
}

export class DiscordGateway extends EventEmitter {
  private ws: WebSocket | null = null;
  private token: string;
  private heartbeatInterval: Timer | null = null;
  private lastSequence: number | null = null;
  private sessionId: string | null = null;
  private resumeUrl: string | null = null;
  private reconnecting = false;

  constructor(token: string) {
    super();
    this.token = token;
  }

  private log(msg: string) {
    const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
    this.emit("gatewayLog", `[${timestamp}] Gateway: ${msg}`);
  }

  async connect(): Promise<void> {
    const gatewayUrl = this.resumeUrl || "wss://gateway.discord.gg/?v=9&encoding=json";
    this.log(`Connecting to ${gatewayUrl}...`);

    this.ws = new WebSocket(gatewayUrl);

    this.ws.onopen = () => {
      this.log("WebSocket connected, waiting for HELLO...");
      this.emit("connected");
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(JSON.parse(event.data));
    };

    this.ws.onerror = (error) => {
      this.log(`WebSocket error: ${error}`);
      this.emit("error", error);
    };

    this.ws.onclose = (event) => {
      this.log(`WebSocket closed (code: ${event.code}, reason: ${event.reason || 'none'})`);
      this.stopHeartbeat();

      if (event.code === 1000) {
        this.log("Intentional disconnect");
        return;
      }

      // Attempt to reconnect
      if (!this.reconnecting) {
        this.reconnecting = true;
        this.log("Reconnecting in 5s...");
        setTimeout(() => {
          this.reconnecting = false;
          this.connect();
        }, 5000);
      }
    };
  }

  private handleMessage(payload: GatewayPayload) {
    const { op, d, s, t } = payload;

    if (s !== null) {
      this.lastSequence = s;
    }

    switch (op) {
      case OP_HELLO:
        this.log(`HELLO received (heartbeat: ${d.heartbeat_interval}ms)`);
        this.emit("hello");
        this.startHeartbeat(d.heartbeat_interval);
        if (this.sessionId && this.lastSequence) {
          this.log("Resuming session...");
          this.resume();
        } else {
          this.log("Starting fresh identify...");
          this.identify();
        }
        break;

      case OP_HEARTBEAT_ACK:
        // Heartbeat acknowledged - quiet
        break;

      case OP_RECONNECT:
        this.log("Server requested reconnect");
        this.ws?.close();
        break;

      case OP_INVALID_SESSION:
        this.log("Invalid session, re-identifying in 2s...");
        this.sessionId = null;
        this.lastSequence = null;
        setTimeout(() => this.identify(), 2000);
        break;

      case OP_DISPATCH:
        this.handleDispatch(t!, d);
        break;
    }
  }

  private identify() {
    this.emit("identifying");
    // Gateway intents - GUILDS for server data, GUILD_MEMBERS for member chunks
    const GUILDS = 1 << 0;        // 1
    const GUILD_MEMBERS = 1 << 9; // 512
    const intents = GUILDS | GUILD_MEMBERS;
    
    const identifyPayload = {
      op: OP_IDENTIFY,
      d: {
        token: this.token,
        properties: {
          os: OS,
          browser: BROWSER,
          device: "",
        },
        compress: false,
        large_threshold: 250,
        intents,
      },
    };

    this.send(identifyPayload);
  }

  private resume() {
    const resumePayload = {
      op: OP_RESUME,
      d: {
        token: this.token,
        session_id: this.sessionId,
        seq: this.lastSequence,
      },
    };

    this.send(resumePayload);
  }

  private startHeartbeat(interval: number) {
    this.stopHeartbeat();
    this.log(`Starting heartbeat (interval: ${interval}ms)`);

    this.heartbeatInterval = setInterval(() => {
      this.send({
        op: OP_HEARTBEAT,
        d: this.lastSequence,
      });
    }, interval);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private handleDispatch(eventType: string, data: any) {
    switch (eventType) {
      case "READY":
        this.log(`READY - session: ${data.session_id}, guilds: ${data.guilds?.length || 0}`);
        this.sessionId = data.session_id;
        this.resumeUrl = data.resume_gateway_url;
        this.emit("ready", data);
        break;

      case "MESSAGE_CREATE":
        this.emit("messageCreate", data);
        break;

      case "MESSAGE_UPDATE":
        this.emit("messageUpdate", data);
        break;

      case "MESSAGE_DELETE":
        this.emit("messageDelete", data);
        break;

      case "GUILD_CREATE":
        this.log(`GUILD_CREATE: ${data.name} (${data.id})`);
        this.emit("guildCreate", data);
        break;

      case "CHANNEL_CREATE":
        this.log(`CHANNEL_CREATE: #${data.name} (${data.id})`);
        this.emit("channelCreate", data);
        break;

      case "PRESENCE_UPDATE":
        this.emit("presenceUpdate", data);
        break;
      case "GUILD_MEMBERS_CHUNK":
        this.emit("guildMembersChunk", data);
        break;
    }
  }

  private send(payload: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  requestGuildMembers(guildId: string, userIds?: string[], query?: string, limit = 100) {
    const payload = {
      op: OP_REQUEST_GUILD_MEMBERS,
      d: {
        guild_id: guildId,
        user_ids: userIds,
        query: query || "",
        limit,
      },
    };
    this.send(payload);
  }

  disconnect() {
    this.stopHeartbeat();
    this.ws?.close(1000);
    this.ws = null;
    this.sessionId = null;
    this.lastSequence = null;
  }
}
