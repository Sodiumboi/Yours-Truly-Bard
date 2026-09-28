import { SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { playerManager } from "../audio/PlayerManager";
import { formatDuration } from "../utils/voice";
import type { Command } from "./Command";

const MAX_LISTED = 15;

const command: Command = {
  data: new SlashCommandBuilder().setName("list").setDescription("Show the current queue"),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = playerManager.get(interaction.guildId!);

    if (!player || (!player.getStatus().current && player.getStatus().queue.length === 0)) {
      await interaction.reply({ content: "The queue is empty.", ephemeral: true });
      return;
    }

    const { current, queue, loop } = player.getStatus();

    const lines: string[] = [];
    if (current) {
      lines.push(`**Now Playing:** ${current.title} \`[${formatDuration(current.durationSeconds)}]\` — requested by ${current.requestedBy}`);
    }

    if (queue.length > 0) {
      lines.push("", "**Up Next:**");
      queue.slice(0, MAX_LISTED).forEach((track, index) => {
        lines.push(`${index + 1}. ${track.title} \`[${formatDuration(track.durationSeconds)}]\` — ${track.requestedBy}`);
      });
      if (queue.length > MAX_LISTED) {
        lines.push(`...and ${queue.length - MAX_LISTED} more.`);
      }
    }

    lines.push("", `Loop mode: **${loop}**`);

    await interaction.reply(lines.join("\n"));
  },
};

export default command;
