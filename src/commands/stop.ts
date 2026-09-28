import { SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { playerManager } from "../audio/PlayerManager";
import type { Command } from "./Command";

const command: Command = {
  data: new SlashCommandBuilder().setName("stop").setDescription("Stop playback, clear the queue, and leave the voice channel"),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = playerManager.get(interaction.guildId!);

    if (!player) {
      await interaction.reply({ content: "I'm not playing anything.", ephemeral: true });
      return;
    }

    await playerManager.remove(interaction.guildId!);
    await interaction.reply("Stopped playback, cleared the queue, and left the voice channel.");
  },
};

export default command;
