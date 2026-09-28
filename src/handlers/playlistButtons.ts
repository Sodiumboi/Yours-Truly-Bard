import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type ChatInputCommandInteraction,
  type Message,
  type VoiceBasedChannel,
} from "discord.js";
import { fetchPlaylistEntries, fetchSingleVideoMetadata } from "../audio/downloader";
import { playerManager } from "../audio/PlayerManager";
import { logger } from "../logger";
import type { TrackMetadata } from "../types";

const FIRST_SONG_ID = "playlist-first-song";
const ENTIRE_PLAYLIST_ID = "playlist-entire";
const PROMPT_TIMEOUT_MS = 60_000;

function buildPromptComponents() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(FIRST_SONG_ID).setLabel("เล่นแค่เพลงแรกฮะ").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(ENTIRE_PLAYLIST_ID).setLabel("โหลดทั้ง Playlist เลยฮะ").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

/**
 * Shared core of the "this URL contains a playlist" UX: waits for the user
 * to press one of the two buttons on `promptMessage`, then either downloads
 * just the first video (`--no-playlist`) or expands the whole playlist into
 * metadata-only queue entries (`--flat-playlist`, no downloads) for the
 * pre-fetch pipeline to pick up one at a time.
 *
 * The choice is scoped to `promptMessage` via a message component collector
 * (not a global customId dispatch table), so playlist URLs never need to be
 * round-tripped through a button's customId. `editResult` is called once
 * with the final text and no components, however the flow resolves.
 */
async function runPlaylistFlow(
  promptMessage: Message,
  userId: string,
  requestedBy: string,
  guildId: string,
  url: string,
  channel: VoiceBasedChannel,
  editResult: (content: string) => Promise<void>,
): Promise<void> {
  let choice;
  try {
    choice = await promptMessage.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: PROMPT_TIMEOUT_MS,
      filter: (btn) => btn.user.id === userId,
    });
  } catch {
    await editResult("หมดเวลาเลือกแล้วฮะ ลองใหม่อีกทีนะ");
    return;
  }

  const player = playerManager.getOrCreate(guildId);
  if (promptMessage.channel.isSendable()) {
    player.setNotifyChannel(promptMessage.channel);
  }

  try {
    await choice.deferUpdate();

    if (choice.customId === FIRST_SONG_ID) {
      const track = await fetchSingleVideoMetadata(url, requestedBy);
      await player.connect(channel);
      await player.enqueue([track]);
      await editResult(`คิว **${track.title}** ไว้แล้วฮะ (จากลิงค์ playlist เอาแค่เพลงแรก)`);
      return;
    }

    // Entire playlist: metadata only, no downloads here.
    const entries = await fetchPlaylistEntries(url);
    if (entries.length === 0) {
      await editResult("หาวิดีโอใน playlist นั้นไม่เจอเลยฮะ");
      return;
    }

    const tracks: TrackMetadata[] = entries.map((entry) => ({
      url: entry.url,
      title: entry.title,
      durationSeconds: entry.durationSeconds,
      requestedBy,
    }));

    await player.connect(channel);
    await player.enqueue(tracks);

    await editResult(`คิวเพลงจาก playlist ไว้ **${tracks.length}** เพลงแล้วฮะ ระบบจะโหลดทีละเพลงล่วงหน้านะฮะ`);
  } catch (err) {
    logger.error({ err, url }, "Failed to handle playlist button choice");
    await editResult("เจ๊งฮะ โหลด playlist ไม่ได้").catch(() => {});
  }
}

/** Slash-command entry point (`/play`). */
export async function handlePlaylistUrl(
  interaction: ChatInputCommandInteraction,
  url: string,
  channel: VoiceBasedChannel,
): Promise<void> {
  const promptMessage = await interaction.reply({
    content: "ลิงค์นี้เป็น Playlist ฮะ อยากให้คิวแบบไหนดี?",
    components: buildPromptComponents(),
    fetchReply: true,
  });

  await runPlaylistFlow(
    promptMessage,
    interaction.user.id,
    interaction.user.toString(),
    interaction.guildId!,
    url,
    channel,
    async (content) => {
      await interaction.editReply({ content, components: [] });
    },
  );
}

/** Prefix-command entry point (`b!p <playlist url>`). */
export async function handlePlaylistUrlMessage(message: Message, url: string, channel: VoiceBasedChannel): Promise<void> {
  const promptMessage = await message.reply({
    content: "ลิงค์นี้เป็น Playlist ฮะ อยากให้คิวแบบไหนดี?",
    components: buildPromptComponents(),
  });

  await runPlaylistFlow(
    promptMessage,
    message.author.id,
    message.author.toString(),
    message.guildId!,
    url,
    channel,
    async (content) => {
      await promptMessage.edit({ content, components: [] });
    },
  );
}
