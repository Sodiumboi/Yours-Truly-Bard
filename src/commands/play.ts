import { SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { fetchSingleVideoMetadata, isPlaylistUrl } from "../audio/downloader";
import { playerManager } from "../audio/PlayerManager";
import { handlePlaylistUrl } from "../handlers/playlistButtons";
import { logger } from "../logger";
import { requireVoiceChannel } from "../utils/voice";
import type { Command } from "./Command";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song or queue a playlist from a URL")
    .addStringOption((option) =>
      option.setName("url").setDescription("YouTube video or playlist URL").setRequired(true),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const url = interaction.options.getString("url", true).trim();

    const channel = await requireVoiceChannel(interaction);
    if (!channel) return;

    if (isPlaylistUrl(url)) {
      await handlePlaylistUrl(interaction, url, channel);
      return;
    }

    await interaction.deferReply();

    try {
      const track = await fetchSingleVideoMetadata(url, interaction.user.toString());
      const player = playerManager.getOrCreate(interaction.guildId!);

      await player.connect(channel);
      await player.enqueue([track]);

      await interaction.editReply(`Queued **${track.title}**.`);
    } catch (err) {
      logger.error({ err, url }, "Failed to queue track");
      await interaction.editReply("Couldn't fetch that URL. Double-check it's a valid, public video link.");
    }
  },
};

export default command;
