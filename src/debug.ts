/**
 * Debug CLI — bypasses OpenTUI, outputs plain text.
 *
 * Usage:
 *   bun run src/debug.ts                              → list servers
 *   bun run src/debug.ts SBS                           → list channels in "SBS"
 *   bun run src/debug.ts SBS general                   → fetch messages from #general
 *   bun run src/debug.ts SBS general --raw             → show raw JSON for first message
 */
import { discordState } from "./discord";
import { getToken } from "./config";

const args = process.argv.slice(2);
const flagArgs = args.filter(a => a.startsWith("--"));
const posArgs = args.filter(a => !a.startsWith("--"));
const serverName = posArgs[0];
const channelName = posArgs[1];
const showRaw = flagArgs.includes("--raw");

const token = getToken();
if (!token) {
    console.error("No token found. Set DISCORD_TOKEN env var or run the TUI to login.");
    process.exit(1);
}

console.log("[debug] Connecting to Discord gateway...");

discordState.on("log", (msg: string) => {
    console.log(`  [log] ${msg}`);
});

discordState.on("error", (err: any) => {
    console.error(`  [error]`, err);
});

discordState.on("ready", () => {
    console.log("[debug] Gateway READY received, waiting for guilds...");
});

let handled = false;

discordState.on("guildsUpdate", async () => {
    if (handled) return;
    handled = true;

    const guilds = discordState.getGuilds();

    if (!serverName) {
        console.log(`\n=== Servers (${guilds.length}) ===`);
        for (const g of guilds) console.log(`  ${g.name} (${g.id})`);
        console.log("\nUsage: bun run src/debug.ts <Server> [channel]");
        await discordState.disconnect();
        process.exit(0);
    }

    const guild = guilds.find(g => g.name.toLowerCase() === serverName.toLowerCase());
    if (!guild) {
        console.error(`\n[error] Server "${serverName}" not found.`);
        for (const g of guilds) console.log(`  ${g.name}`);
        await discordState.disconnect();
        process.exit(1);
    }

    const channels = discordState.getChannels(guild.id);

    if (!channelName) {
        console.log(`\n=== Channels in "${guild.name}" (${channels.length}) ===`);
        for (const c of channels) {
            const t = c.type === 0 ? "text" : c.type === 2 ? "voice" : `type=${c.type}`;
            console.log(`  #${c.name} (${t}, ${c.id})`);
        }
        await discordState.disconnect();
        process.exit(0);
    }

    const cleanName = channelName.replace(/^#/, "");
    const channel = channels.find(c => c.name.toLowerCase() === cleanName.toLowerCase());
    if (!channel) {
        console.error(`\n[error] Channel "#${cleanName}" not found.`);
        for (const c of channels) console.log(`  #${c.name}`);
        await discordState.disconnect();
        process.exit(1);
    }

    console.log(`\n[debug] Fetching messages from #${channel.name}...`);
    try {
        const messages = await discordState.getMessages(channel.id, 20);
        console.log(`\n=== Messages in #${channel.name} (${messages.length}) ===\n`);

        if (showRaw && messages.length > 0) {
            console.log("[raw]", JSON.stringify(messages[0], null, 2));
            console.log("");
        }

        for (const msg of messages) {
            const time = msg.timestamp.toLocaleTimeString();
            const reply = msg.referencedMessage ? ` ↩ @${msg.referencedMessage.author}` : "";
            console.log(`[${time}] ${msg.author.displayName}: ${msg.content}${reply}`);
        }

        if (messages.length === 0) {
            console.log("  (no messages or failed to load)");
        }
    } catch (err) {
        console.error("[error]", err);
    }

    await discordState.disconnect();
    process.exit(0);
});

await discordState.connect(token);

setTimeout(async () => {
    if (!handled) {
        console.error("[debug] Timed out (15s).");
        await discordState.disconnect();
        process.exit(1);
    }
}, 15000);
