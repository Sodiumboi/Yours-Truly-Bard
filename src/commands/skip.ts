import { SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { playerManager } from "../audio/PlayerManager";
import type { Command } from "./Command";

const command: Command = {
  data: new SlashCommandBuilder().setName("skip").setDescription("Skip the current song"),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = playerManager.get(interaction.guildId!);

    if (!player || !player.skip()) {
      await interaction.reply({ content: "Nothing is playing right now.", ephemeral: true });
      return;
    }

    await interaction.reply("Skipped.");
  },
};

export default command;
