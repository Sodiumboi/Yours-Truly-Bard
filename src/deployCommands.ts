import { REST, Routes } from "discord.js";
import { config } from "./config";
import { commands } from "./commands";
import { logger } from "./logger";

async function main(): Promise<void> {
  const body = commands.map((command) => command.data.toJSON());
  const rest = new REST().setToken(config.discordToken);

  const route = config.discordGuildId
    ? Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId)
    : Routes.applicationCommands(config.discordClientId);

  logger.info(
    { scope: config.discordGuildId ? `guild:${config.discordGuildId}` : "global", count: body.length },
    "Registering slash commands",
  );

  await rest.put(route, { body });

  logger.info("Slash commands registered successfully.");
}

main().catch((err) => {
  logger.error({ err }, "Failed to register slash commands");
  process.exit(1);
});
