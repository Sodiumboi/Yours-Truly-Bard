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
    await message.reply("เห้ย มีอะไรพังฮะ ลองใหม่อีกทีนะ").catch(() => {});
  }
}

async function runPlay(message: Message, url: string): Promise<void> {
  if (!url) {
    await message.reply(`ใช้แบบนี้ฮะ: \`${config.commandPrefix}p <youtube url>\``);
    return;
  }

  const channel = await requireVoiceChannelFromMessage(message);
  if (!channel) return;

  if (isPlaylistUrl(url)) {
    await handlePlaylistUrlMessage(message, url, channel);
    return;
  }

  const statusMessage = await message.reply("กำลังหาข้อมูลเพลงฮะ...");

  try {
    const track = await fetchSingleVideoMetadata(url, message.author.toString());
    const player = playerManager.getOrCreate(message.guildId!);

    if (message.channel.isSendable()) {
      player.setNotifyChannel(message.channel);
    }

    await player.connect(channel);
    await player.enqueue([track]);

    await statusMessage.edit(`คิว **${track.title}** ไว้แล้วฮะ`);
  } catch (err) {
    logger.error({ err, url }, "Failed to queue track");
    await statusMessage.edit("เจ๊งฮะ เปิดลิงค์ไม่ได้ฮะ เหมือนจะเป็นลิงค์ส่วนตัวหรือไม่สามารถเข้าถึงได้ฮะ");
  }
}

async function runSkip(message: Message): Promise<void> {
  const player = playerManager.get(message.guildId!);

  if (!player || !player.skip()) {
    await message.reply("ไม่มีอะไรให้ข้ามแล้วฮะ หมดคิวแล้ว");
    return;
  }

  await message.reply("ข้ามแล้วฮะ");
}

async function runLoop(message: Message, arg: string): Promise<void> {
  const key = arg.toLowerCase();
  const mode = LOOP_ALIASES[key];

  if (!mode) {
    await message.reply(`ใช้แบบนี้ฮะ: \`${config.commandPrefix}loop <off|song|queue>\``);
    return;
  }

  const player = playerManager.getOrCreate(message.guildId!);
  player.setLoop(mode);

  const labels: Record<LoopMode, string> = {
    none: "ปิดฮะ",
    song: "แค่เพลงปัจจุบันฮะ",
    queue: "เล่นซ้ำคิวทั้งหมดฮะ",
  };

  await message.reply(`ตอนนี้ Loop mode คือ **${labels[mode]}**.`);
}

async function runLeave(message: Message): Promise<void> {
  const player = playerManager.get(message.guildId!);

  if (!player) {
    await message.reply("ไม่ได้เล่นอะไรฮะ");
    return;
  }

  await playerManager.remove(message.guildId!);
  await message.reply("หยุดเล่นแล้ว, ล้างคิวแล้ว, และออกจากช่องเสียงแล้วฮะ");
}

async function runList(message: Message): Promise<void> {
  const player = playerManager.get(message.guildId!);

  if (!player || (!player.getStatus().current && player.getStatus().queue.length === 0)) {
    await message.reply("คิวว่าง ฮะ");
    return;
  }

  const { current, queue, loop } = player.getStatus();

  const lines: string[] = [];
  if (current) {
    lines.push(`**ตอนนี้กำลังเล่น:** ${current.title} \`[${formatDuration(current.durationSeconds)}]\` — คนขอ: ${current.requestedBy}`);
  }

  if (queue.length > 0) {
    lines.push("", "**อ่ะต่อไป:**");
    queue.slice(0, 15).forEach((track, index) => {
      lines.push(`${index + 1}. ${track.title} \`[${formatDuration(track.durationSeconds)}]\` — ${track.requestedBy}`);
    });
    if (queue.length > 15) {
      lines.push(`...อีก ${queue.length - 15} คิว`);
    }
  }

  const loopLabels: Record<string, string> = {
    none: "ปิดฮะ",
    song: "แค่เพลงปัจจุบันฮะ",
    queue: "เล่นซ้ำคิวทั้งหมดฮะ",
  };
  lines.push("", `Loop mode ตอนนี้: **${loopLabels[loop] ?? loop}**`);

  await message.reply(lines.join("\n"));
}
