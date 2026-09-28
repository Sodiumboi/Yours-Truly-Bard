import "dotenv/config";
import path from "node:path";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  discordToken: required("DISCORD_TOKEN"),
  discordClientId: required("DISCORD_CLIENT_ID"),
  discordGuildId: process.env.DISCORD_GUILD_ID?.trim() || undefined,

  /** Prefix for text-based commands, e.g. "b!" for "b!p <url>". */
  commandPrefix: process.env.COMMAND_PREFIX?.trim() || "b!",

  youtubeDlBinaryPath: process.env.YOUTUBE_DL_BINARY_PATH?.trim() || undefined,
  ytDlpExtraArgs: (process.env.YT_DLP_EXTRA_ARGS ?? "")
    .split(" ")
    .map((arg) => arg.trim())
    .filter((arg) => arg.length > 0),

  tempDir: path.resolve(process.cwd(), process.env.TEMP_DIR?.trim() || "./temp"),
  prefetchAhead: Math.max(1, Number(process.env.PREFETCH_AHEAD ?? "1") || 1),

  logLevel: process.env.LOG_LEVEL?.trim() || "info",
} as const;
