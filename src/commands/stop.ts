import { SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { playerManager } from "../audio/PlayerManager";
import type { Command } from "./Command";

const command: Command = {
  data: new SlashCommandBuilder().setName("stop").setDescription("หยุดเล่นแล้ว, ล้างคิวแล้ว, และออกจากช่องเสียงแล้วฮะ"),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = playerManager.get(interaction.guildId!);

    if (!player) {
      await interaction.reply({ content: "ไม่ได้เล่นอะไรฮะ", ephemeral: true });
      return;
    }

    await playerManager.remove(interaction.guildId!);
    await interaction.reply("หยุดเล่นแล้ว, ล้างคิวแล้ว, และออกจากช่องเสียงแล้วฮะ");
  },
};

export default command;
