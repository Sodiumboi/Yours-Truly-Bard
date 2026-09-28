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
      new ButtonBuilder().setCustomId(FIRST_SONG_ID).setLabel("Play first song only").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(ENTIRE_PLAYLIST_ID).setLabel("Load entire playlist").setStyle(ButtonStyle.Secondary),
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
    await editResult("Playlist prompt timed out.");
    return;
  }

  const player = playerManager.getOrCreate(guildId);

  try {
    await choice.deferUpdate();

    if (choice.customId === FIRST_SONG_ID) {
      const track = await fetchSingleVideoMetadata(url, requestedBy);
      await player.connect(channel);
      await player.enqueue([track]);
      await editResult(`Queued **${track.title}** (playlist link, first song only).`);
      return;
    }

    // Entire playlist: metadata only, no downloads here.
    const entries = await fetchPlaylistEntries(url);
    if (entries.length === 0) {
      await editResult("Couldn't find any videos in that playlist.");
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

    await editResult(
      `Queued **${tracks.length}** songs from the playlist. Downloads happen one track ahead as playback progresses.`,
    );
  } catch (err) {
    logger.error({ err, url }, "Failed to handle playlist button choice");
    await editResult("Something went wrong loading that playlist.").catch(() => {});
  }
}

/** Slash-command entry point (`/play`). */
export async function handlePlaylistUrl(
  interaction: ChatInputCommandInteraction,
  url: string,
  channel: VoiceBasedChannel,
): Promise<void> {
  const promptMessage = await interaction.reply({
    content: "This URL is a playlist. How would you like to queue it?",
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
    content: "This URL is a playlist. How would you like to queue it?",
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
