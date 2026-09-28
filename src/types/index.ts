/** Loop playback modes, mirroring common music-bot UX. */
export type LoopMode = "none" | "song" | "queue";

/**
 * Metadata-only representation of a track. This is what lives in the
 * in-memory queue. It deliberately does NOT include a file path — the file
 * only exists on disk once the pre-fetch logic has actually downloaded it
 * (see GuildMusicPlayer). This keeps "queued 300 videos from a playlist"
 * cheap: it's just metadata until each track's turn to be downloaded.
 */
export interface TrackMetadata {
  /** Canonical watch URL, e.g. https://www.youtube.com/watch?v=... */
  url: string;
  title: string;
  /** Duration in seconds, if known. */
  durationSeconds?: number;
  /** Display name / mention of whoever queued this track. */
  requestedBy: string;
}

/**
 * A track that has been (or is being) downloaded to disk as part of the
 * download -> play -> delete pipeline.
 */
export interface DownloadedTrack extends TrackMetadata {
  /** Absolute path to the downloaded audio file in the temp directory. */
  filePath: string;
}

/** Result of probing a URL for whether it's a single video or a playlist. */
export interface PlaylistEntry {
  url: string;
  title: string;
  durationSeconds?: number;
}
