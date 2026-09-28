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
    .setDescription("เล่นเพลง หรือคิว playlist จาก URL ฮะ")
    .addStringOption((option) =>
      option.setName("url").setDescription("YouTube video หรือ playlist URL ฮะ").setRequired(true),
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

      if (interaction.channel?.isSendable()) {
        player.setNotifyChannel(interaction.channel);
      }

      await player.connect(channel);
      await player.enqueue([track]);

      await interaction.editReply(`ตอนนี้กำลังเล่น **${track.title}** ฮะ`);
    } catch (err) {
      logger.error({ err, url }, "Failed to queue track");
      await interaction.editReply("เจ๊งฮะ เปิดลิงค์ไม่ได้ฮะ เหมือนจะเป็นลิงค์ส่วนตัวหรือไม่สามารถเข้าถึงได้ฮะ");
    }
  },
};

export default command;
