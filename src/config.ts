import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

/**
 * Config: token from DISCORD_TOKEN env or ~/.config/tinycord/config.json (Linux),
 * ~/Library/Application Support/tinycord (macOS), %APPDATA%/tinycord (Windows).
 */
interface Config {
  token?: string;
}

function getConfigDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";

  if (process.platform === "win32") {
    return join(process.env.APPDATA || join(home, "AppData", "Roaming"), "tinycord");
  } else if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "tinycord");
  } else {
    return join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "tinycord");
  }
}

function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

export function loadConfig(): Config {
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error("Failed to load config:", error);
    return {};
  }
}

export function saveConfig(config: Config): void {
  const configDir = getConfigDir();
  const configPath = getConfigPath();

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  } catch (error) {
    console.error("Failed to save config:", error);
  }
}

export function getToken(): string | null {
  const envToken = process.env.DISCORD_TOKEN;
  if (envToken && envToken !== "your_user_token_here") {
    return envToken;
  }

  const config = loadConfig();
  return config.token || null;
}

export function saveToken(token: string): void {
  const existing = loadConfig();
  saveConfig({ ...existing, token });
}
