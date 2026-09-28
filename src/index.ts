import { Client, Collection, Events, GatewayIntentBits } from "discord.js";
import { config } from "./config";
import { logger } from "./logger";
import { commands } from "./commands";
import type { Command } from "./commands/Command";
import { ensureTempDir } from "./audio/downloader";
import { playerManager } from "./audio/PlayerManager";
import { handlePrefixCommand } from "./handlers/prefixCommands";

declare module "discord.js" {
  interface Client {
    commands: Collection<string, Command>;
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    // Privileged intent — must also be toggled on for this application in
    // the Discord Developer Portal (Bot tab -> "Message Content Intent"),
    // otherwise b!p / b!skip / b!loop / b!leave won't receive message text.
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();
for (const command of commands) {
  client.commands.set(command.data.name, command);
}

client.once(Events.ClientReady, async (readyClient) => {
  await ensureTempDir();
  logger.info({ tag: readyClient.user.tag }, "Bot is online");
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    logger.warn({ commandName: interaction.commandName }, "Received unknown command");
    return;
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    logger.error({ err, commandName: interaction.commandName }, "Command execution failed");

    const errorMessage = "Something went wrong running that command.";
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply(errorMessage).catch(() => {});
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true }).catch(() => {});
    }
  }
});

client.on(Events.MessageCreate, (message) => {
  void handlePrefixCommand(message);
});

// If the bot itself is kicked from, or disconnected from, a voice channel
// (e.g. an admin drags it out), clean up that guild's player so it doesn't
// keep a stale queue and voice connection object around.
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  if (oldState.member?.id !== client.user?.id) return;
  if (oldState.channelId && !newState.channelId) {
    void playerManager.remove(oldState.guild.id);
  }
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutting down gracefully");
  client.destroy();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

client.login(config.discordToken).catch((err) => {
  logger.fatal({ err }, "Failed to log in to Discord");
  process.exit(1);
});
