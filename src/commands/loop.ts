import { SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { playerManager } from "../audio/PlayerManager";
import type { LoopMode } from "../types";
import type { Command } from "./Command";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("loop")
    .setDescription("ตั้ง Loop mode ฮะ")
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription("จะให้ loop แบบไหนฮะ")
        .setRequired(true)
        .addChoices(
          { name: "ปิดฮะ", value: "none" },
          { name: "Song (เล่นซ้ำแค่เพลงปัจจุบันฮะ)", value: "song" },
          { name: "Queue (เล่นซ้ำคิวทั้งหมดฮะ)", value: "queue" },
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const mode = interaction.options.getString("mode", true) as LoopMode;
    const player = playerManager.getOrCreate(interaction.guildId!);

    player.setLoop(mode);

    const labels: Record<LoopMode, string> = {
      none: "ปิดฮะ",
      song: "แค่เพลงปัจจุบันฮะ",
      queue: "เล่นซ้ำคิวทั้งหมดฮะ",
    };

    await interaction.reply(`ตอนนี้ Loop mode คือ **${labels[mode]}**.`);
  },
};

export default command;
