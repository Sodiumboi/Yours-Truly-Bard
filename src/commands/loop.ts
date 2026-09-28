import { SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { playerManager } from "../audio/PlayerManager";
import type { LoopMode } from "../types";
import type { Command } from "./Command";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Set the loop mode")
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription("Loop mode")
        .setRequired(true)
        .addChoices(
          { name: "Off", value: "none" },
          { name: "Song (repeat current track)", value: "song" },
          { name: "Queue (requeue tracks after they finish)", value: "queue" },
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const mode = interaction.options.getString("mode", true) as LoopMode;
    const player = playerManager.getOrCreate(interaction.guildId!);

    player.setLoop(mode);

    const labels: Record<LoopMode, string> = {
      none: "off",
      song: "current song",
      queue: "whole queue",
    };

    await interaction.reply(`Loop mode set to **${labels[mode]}**.`);
  },
};

export default command;
