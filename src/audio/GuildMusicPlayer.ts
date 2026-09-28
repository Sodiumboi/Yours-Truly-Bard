import {
  AudioPlayer,
  AudioPlayerStatus,
  AudioResource,
  createAudioPlayer,
  createAudioResource,
  joinVoiceChannel,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnection,
  VoiceConnectionStatus,
  entersState,
} from "@discordjs/voice";
import type { SendableChannels, VoiceBasedChannel } from "discord.js";
import { deleteTrackFile, downloadTrackAudio } from "./downloader";
import { logger } from "../logger";
import { config } from "../config";
import type { DownloadedTrack, LoopMode, TrackMetadata } from "../types";

/**
 * Owns one guild's entire playback lifecycle: the voice connection, the
 * AudioPlayer, the in-memory metadata queue, and the download -> play ->
 * delete pipeline (including the one-track-ahead pre-fetch).
 *
 * Only ONE track is ever on disk ahead of the currently playing one — this
 * mirrors the architecture spec ("Song B while Song A plays"), not a bulk
 * cache, so disk usage stays bounded regardless of queue length.
 */
export class GuildMusicPlayer {
  public readonly guildId: string;

  private connection: VoiceConnection | null = null;
  private readonly audioPlayer: AudioPlayer;

  /** Metadata-only queue. The head of this array plays after `current`. */
  private queue: TrackMetadata[] = [];

  /** The track currently loaded into the AudioPlayer (on disk, playing). */
  private current: DownloadedTrack | null = null;

  /** The next track, already downloaded to disk by the pre-fetcher. */
  private prefetched: DownloadedTrack | null = null;
  /** Guards against starting two pre-fetches for the same slot concurrently. */
  private prefetchInFlight: Promise<void> | null = null;

  private loopMode: LoopMode = "none";

  /** Channel to post housekeeping notices (e.g. auto-leave) into. Updated on each command. */
  private notifyChannel: SendableChannels | null = null;

  /** Set while intentionally tearing down, so the idle handler doesn't try to advance the queue. */
  private stopping = false;

  private disconnectTimer: NodeJS.Timeout | null = null;

  constructor(guildId: string) {
    this.guildId = guildId;
    this.audioPlayer = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });
    this.audioPlayer.on(AudioPlayerStatus.Idle, () => {
      void this.handleTrackFinished();
    });
    this.audioPlayer.on("error", (error) => {
      logger.error({ err: error, guildId: this.guildId }, "AudioPlayer error");
      void this.handleTrackFinished();
    });
  }

  // ---------------------------------------------------------------------
  // Connection management
  // ---------------------------------------------------------------------

  async connect(channel: VoiceBasedChannel): Promise<void> {
    this.clearDisconnectTimer();

    if (this.connection && this.connection.joinConfig.channelId === channel.id) {
      return;
    }

    this.connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });

    this.connection.subscribe(this.audioPlayer);

    await entersState(this.connection, VoiceConnectionStatus.Ready, 15_000).catch((err) => {
      logger.error({ err, guildId: this.guildId }, "Voice connection failed to become ready");
      throw new Error("Could not join the voice channel in time.");
    });

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(this.connection!, VoiceConnectionStatus.Signalling, 5_000),
          entersState(this.connection!, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        this.destroyConnection();
      }
    });
  }

  private destroyConnection(): void {
    this.connection?.destroy();
    this.connection = null;
  }

  // ---------------------------------------------------------------------
  // Queue mutation / public API used by commands
  // ---------------------------------------------------------------------

  /** Adds tracks to the end of the queue and kicks off playback/pre-fetch as needed. */
  async enqueue(tracks: TrackMetadata[]): Promise<void> {
    this.queue.push(...tracks);

    if (!this.current) {
      await this.advance();
    } else {
      this.schedulePrefetch();
    }
  }

  get loop(): LoopMode {
    return this.loopMode;
  }

  /** Records where to post housekeeping notices (e.g. auto-leave on inactivity). */
  setNotifyChannel(channel: SendableChannels | null): void {
    this.notifyChannel = channel;
  }

  setLoop(mode: LoopMode): void {
    this.loopMode = mode;
    // Entering "song" loop while a different track is pre-fetched would waste
    // that download; entering/leaving loop modes doesn't change what's
    // already on disk, only what happens at the next idle transition.
  }

  /** Stops the current track; the Idle handler naturally advances the queue. */
  skip(): boolean {
    if (!this.current) return false;
    this.audioPlayer.stop(true);
    return true;
  }

  /** Fully stops playback, clears the queue, deletes files, and leaves the channel. */
  async stop(): Promise<void> {
    this.stopping = true;
    this.queue = [];
    this.audioPlayer.stop(true);

    if (this.current) {
      await deleteTrackFile(this.current.filePath);
      this.current = null;
    }
    if (this.prefetched) {
      await deleteTrackFile(this.prefetched.filePath);
      this.prefetched = null;
    }

    this.destroyConnection();
    this.stopping = false;
  }

  getStatus(): { current: DownloadedTrack | null; queue: TrackMetadata[]; loop: LoopMode } {
    return { current: this.current, queue: [...this.queue], loop: this.loopMode };
  }

  hasActivity(): boolean {
    return Boolean(this.current) || this.queue.length > 0;
  }

  // ---------------------------------------------------------------------
  // Core pipeline: download -> play -> delete, with pre-fetch
  // ---------------------------------------------------------------------

  /** Pulls the next track off the queue, ensures it's downloaded, and plays it. */
  private async advance(): Promise<void> {
    const next = this.queue.shift();
    if (!next) {
      this.current = null;
      this.scheduleIdleDisconnect();
      return;
    }

    try {
      const downloaded = await this.resolveDownload(next);
      this.current = downloaded;
      this.play(downloaded);
      this.schedulePrefetch();
    } catch (err) {
      logger.error({ err, url: next.url, guildId: this.guildId }, "Failed to download track, skipping it");
      await this.advance();
    }
  }

  /** Returns a downloaded copy of `track`, reusing the pre-fetched file if it matches. */
  private async resolveDownload(track: TrackMetadata): Promise<DownloadedTrack> {
    if (this.prefetched && this.prefetched.url === track.url) {
      const downloaded = this.prefetched;
      this.prefetched = null;
      return downloaded;
    }

    const filePath = await downloadTrackAudio(track.url);
    return { ...track, filePath };
  }

  private play(track: DownloadedTrack): void {
    logger.info({ title: track.title, guildId: this.guildId }, "Playing track");
    const resource: AudioResource = createAudioResource(track.filePath, {
      inputType: StreamType.Arbitrary,
    });
    this.audioPlayer.play(resource);
  }

  /**
   * Called whenever the AudioPlayer goes Idle (track finished, was skipped,
   * or errored). Implements: delete finished file -> honor loop mode ->
   * play the pre-fetched next track -> trigger the next pre-fetch.
   */
  private async handleTrackFinished(): Promise<void> {
    if (this.stopping) return;

    const finished = this.current;
    this.current = null;
    if (!finished) return;

    if (this.loopMode === "song") {
      // Replay the same file in place; do NOT delete it.
      this.current = finished;
      this.play(finished);
      this.schedulePrefetch();
      return;
    }

    if (this.loopMode === "queue") {
      // Push the metadata back to the end of the queue, then delete the
      // now-finished file (it will be re-downloaded on its next turn).
      this.queue.push({
        url: finished.url,
        title: finished.title,
        durationSeconds: finished.durationSeconds,
        requestedBy: finished.requestedBy,
      });
    }

    await deleteTrackFile(finished.filePath);
    await this.advance();
  }

  /** Downloads the next queued track in the background, ahead of when it's needed. */
  private schedulePrefetch(): void {
    if (this.prefetchInFlight) return;
    if (this.prefetched) return;

    const upcoming = this.queue[0];
    if (!upcoming) return;

    this.prefetchInFlight = this.runPrefetch(upcoming).finally(() => {
      this.prefetchInFlight = null;
    });
  }

  private async runPrefetch(track: TrackMetadata): Promise<void> {
    try {
      logger.debug({ title: track.title, guildId: this.guildId }, "Pre-fetching next track");
      const filePath = await downloadTrackAudio(track.url);
      // The queue could have changed (skip/stop) while this download ran;
      // only keep the result if it's still the upcoming track.
      if (this.queue[0]?.url === track.url) {
        this.prefetched = { ...track, filePath };
      } else {
        await deleteTrackFile(filePath);
      }
    } catch (err) {
      logger.warn({ err, url: track.url, guildId: this.guildId }, "Pre-fetch failed; will retry at play time");
    }
  }

  private scheduleIdleDisconnect(): void {
    this.clearDisconnectTimer();
    this.disconnectTimer = setTimeout(() => {
      if (!this.hasActivity()) {
        logger.info({ guildId: this.guildId }, "Idle timeout reached, leaving voice channel");
        this.notifyChannel
          ?.send("Bard ขอตัวก่อน ไม่มีเพลงให้เล่นมา 5 นาที แล้วเจอกัน~")
          .catch((err) => {
            logger.warn({ err, guildId: this.guildId }, "Failed to send auto-leave notice");
          });
        void this.stop();
      }
    }, 5 * 60_000);
  }

  private clearDisconnectTimer(): void {
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
  }
}
