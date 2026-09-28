import { GuildMusicPlayer } from "./GuildMusicPlayer";

/** Singleton registry of one GuildMusicPlayer per guild the bot is active in. */
class PlayerManager {
  private readonly players = new Map<string, GuildMusicPlayer>();

  getOrCreate(guildId: string): GuildMusicPlayer {
    let player = this.players.get(guildId);
    if (!player) {
      player = new GuildMusicPlayer(guildId);
      this.players.set(guildId, player);
    }
    return player;
  }

  get(guildId: string): GuildMusicPlayer | undefined {
    return this.players.get(guildId);
  }

  async remove(guildId: string): Promise<void> {
    const player = this.players.get(guildId);
    if (player) {
      await player.stop();
      this.players.delete(guildId);
    }
  }
}

export const playerManager = new PlayerManager();
