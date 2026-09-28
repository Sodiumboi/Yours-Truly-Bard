import type { Message } from "discord.js";
import { config } from "../config";
import { logger } from "../logger";
import { fetchSingleVideoMetadata, isPlaylistUrl } from "../audio/downloader";
import { playerManager } from "../audio/PlayerManager";
import { handlePlaylistUrlMessage } from "./playlistButtons";
import type { LoopMode } from "../types";
import { formatDuration, requireVoiceChannelFromMessage } from "../utils/voice";

const LOOP_ALIASES: Record<string, LoopMode> = {
  none: "none",
  off: "none",
  song: "song",
  track: "song",
  queue: "queue",
  all: "queue",
};

/**
 * Text-command entry point: b!p <url>, b!skip, b!loop <mode>, b!leave.
 * Lives alongside the slash commands in src/commands/ — same
 * GuildMusicPlayer/PlayerManager underneath, just a different way in.
 *
 * Requires the "Message Content" privileged intent to be turned on for the
 * bot application in the Discord Developer Portal, since reading the text
 * of a message the bot wasn't @mentioned in needs it.
 */
export async function handlePrefixCommand(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.guildId) return;
  if (!message.content.startsWith(config.commandPrefix)) return;

  const withoutPrefix = message.content.slice(config.commandPrefix.length).trim();
  const [rawCommand, ...rest] = withoutPrefix.split(/\s+/);
  const command = rawCommand?.toLowerCase();
  if (!command) return;

  const argString = rest.join(" ").trim();

  try {
    switch (command) {
      case "p":
      case "play":
        await runPlay(message, argString);
        break;
      case "skip":
        await runSkip(message);
        break;
      case "loop":
        await runLoop(message, argString);
        break;
      case "leave":
      case "stop":
        await runLeave(message);
        break;
      case "list":
      case "queue":
        await runList(message);
        break;
      default:
        // Not one of ours; ignore silently (could be another bot's prefix).
        break;
    }
  } catch (err) {
    logger.error({ err, command }, "Prefix command failed");
    await message.reply("Something went wrong running that command.").catch(() => {});
  }
}

async function runPlay(message: Message, url: string): Promise<void> {
  if (!url) {
    await message.reply(`Usage: \`${config.commandPrefix}p <youtube url>\``);
    return;
  }

  const channel = await requireVoiceChannelFromMessage(message);
  if (!channel) return;

  if (isPlaylistUrl(url)) {
    await handlePlaylistUrlMessage(message, url, channel);
    return;
  }

  const statusMessage = await message.reply("Fetching track info...");

  try {
    const track = await fetchSingleVideoMetadata(url, message.author.toString());
    const player = playerManager.getOrCreate(message.guildId!);

    await player.connect(channel);
    await player.enqueue([track]);

    await statusMessage.edit(`Queued **${track.title}**.`);
  } catch (err) {
    logger.error({ err, url }, "Failed to queue track");
    await statusMessage.edit("Couldn't fetch that URL. Double-check it's a valid, public video link.");
  }
}

async function runSkip(message: Message): Promise<void> {
  const player = playerManager.get(message.guildId!);

  if (!player || !player.skip()) {
    await message.reply("Nothing is playing right now.");
    return;
  }

  await message.reply("Skipped.");
}

async function runLoop(message: Message, arg: string): Promise<void> {
  const key = arg.toLowerCase();
  const mode = LOOP_ALIASES[key];

  if (!mode) {
    await message.reply(`Usage: \`${config.commandPrefix}loop <off|song|queue>\``);
    return;
  }

  const player = playerManager.getOrCreate(message.guildId!);
  player.setLoop(mode);

  const labels: Record<LoopMode, string> = {
    none: "off",
    song: "current song",
    queue: "whole queue",
  };

  await message.reply(`Loop mode set to **${labels[mode]}**.`);
}

async function runLeave(message: Message): Promise<void> {
  const player = playerManager.get(message.guildId!);

  if (!player) {
    await message.reply("I'm not playing anything.");
    return;
  }

  await playerManager.remove(message.guildId!);
  await message.reply("Stopped playback, cleared the queue, and left the voice channel.");
}

async function runList(message: Message): Promise<void> {
  const player = playerManager.get(message.guildId!);

  if (!player || (!player.getStatus().current && player.getStatus().queue.length === 0)) {
    await message.reply("The queue is empty.");
    return;
  }

  const { current, queue, loop } = player.getStatus();

  const lines: string[] = [];
  if (current) {
    lines.push(`**Now Playing:** ${current.title} \`[${formatDuration(current.durationSeconds)}]\` — requested by ${current.requestedBy}`);
  }

  if (queue.length > 0) {
    lines.push("", "**Up Next:**");
    queue.slice(0, 15).forEach((track, index) => {
      lines.push(`${index + 1}. ${track.title} \`[${formatDuration(track.durationSeconds)}]\` — ${track.requestedBy}`);
    });
    if (queue.length > 15) {
      lines.push(`...and ${queue.length - 15} more.`);
    }
  }

  lines.push("", `Loop mode: **${loop}**`);

  await message.reply(lines.join("\n"));
}
