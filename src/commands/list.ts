import { SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { playerManager } from "../audio/PlayerManager";
import { formatDuration } from "../utils/voice";
import type { Command } from "./Command";

const MAX_LISTED = 15;

const command: Command = {
  data: new SlashCommandBuilder().setName("list").setDescription("แสกนคิวเพลงที่กำลังเล่นอยู่ฮะ"),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = playerManager.get(interaction.guildId!);

    if (!player || (!player.getStatus().current && player.getStatus().queue.length === 0)) {
      await interaction.reply({ content: "คิวว่าง ฮะ", ephemeral: true });
      return;
    }

    const { current, queue, loop } = player.getStatus();

    const lines: string[] = [];
    if (current) {
      lines.push(`**ตอนนี้กำลังเล่น:** ${current.title} \`[${formatDuration(current.durationSeconds)}]\` — คนขอ: ${current.requestedBy}`);
    }

    if (queue.length > 0) {
      lines.push("", "**อ่ะต่อไป:**");
      queue.slice(0, MAX_LISTED).forEach((track, index) => {
        lines.push(`${index + 1}. ${track.title} \`[${formatDuration(track.durationSeconds)}]\` — ${track.requestedBy}`);
      });
      if (queue.length > MAX_LISTED) {
        lines.push(`...อีก ${queue.length - MAX_LISTED} คิว`);
      }
    }

    const loopLabels: Record<string, string> = {
      none: "ปิดฮะ",
      song: "แค่เพลงปัจจุบันฮะ",
      queue: "เล่นซ้ำคิวทั้งหมดฮะ",
    };
    lines.push("", `Loop mode ตอนนี้: **${loopLabels[loop] ?? loop}**`);

    await interaction.reply(lines.join("\n"));
  },
};

export default command;
