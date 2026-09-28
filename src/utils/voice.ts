import type { ChatInputCommandInteraction, GuildMember, Message, VoiceBasedChannel } from "discord.js";

/**
 * Resolves the voice channel the invoking member is currently in, replying
 * with an error and returning null if they aren't in one.
 */
export async function requireVoiceChannel(
  interaction: ChatInputCommandInteraction,
): Promise<VoiceBasedChannel | null> {
  const member = interaction.member as GuildMember | null;
  const channel = member?.voice.channel ?? null;

  if (!channel) {
    await interaction.reply({
      content: "You need to be in a voice channel to use this command.",
      ephemeral: true,
    });
    return null;
  }

  const permissions = channel.permissionsFor(interaction.client.user);
  if (!permissions?.has(["Connect", "Speak"])) {
    await interaction.reply({
      content: `I don't have permission to join or speak in ${channel.name}.`,
      ephemeral: true,
    });
    return null;
  }

  return channel;
}

/**
 * Message-command equivalent of requireVoiceChannel: resolves the invoking
 * member's voice channel, replying in-channel with an error and returning
 * null if they aren't in one or the bot lacks permission there.
 */
export async function requireVoiceChannelFromMessage(message: Message): Promise<VoiceBasedChannel | null> {
  const member = message.member as GuildMember | null;
  const channel = member?.voice.channel ?? null;

  if (!channel) {
    await message.reply("You need to be in a voice channel to use this command.");
    return null;
  }

  const permissions = channel.permissionsFor(message.client.user);
  if (!permissions?.has(["Connect", "Speak"])) {
    await message.reply(`I don't have permission to join or speak in ${channel.name}.`);
    return null;
  }

  return channel;
}

export function formatDuration(seconds?: number): string {
  if (!seconds || Number.isNaN(seconds)) return "??:??";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
