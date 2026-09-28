import { SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { playerManager } from "../audio/PlayerManager";
import type { Command } from "./Command";

const command: Command = {
  data: new SlashCommandBuilder().setName("skip").setDescription("ข้ามเพลงปัจจุบันฮะ"),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = playerManager.get(interaction.guildId!);

    if (!player || !player.skip()) {
      await interaction.reply({ content: "ไม่มีอะไรให้ข้ามแล้วฮะ หมดคิวแล้ว", ephemeral: true });
      return;
    }

    await interaction.reply("ข้ามแล้วฮะ");
  },
};

export default command;
