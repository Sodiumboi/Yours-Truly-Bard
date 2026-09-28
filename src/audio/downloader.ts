import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
// youtube-dl-exec ships its own type defs but they're loose (mostly `any`);
// we wrap everything behind narrow, well-typed helpers below so the rest of
// the codebase never touches the raw library surface.
// eslint-disable-next-line @typescript-eslint/no-var-requires
import youtubeDl, { create as createYoutubeDl } from "youtube-dl-exec";
import { config } from "../config";
import { logger } from "../logger";
import type { PlaylistEntry, TrackMetadata } from "../types";

const ytdl = config.youtubeDlBinaryPath ? createYoutubeDl(config.youtubeDlBinaryPath) : youtubeDl;

/** Raw shape we care about from yt-dlp's --dump-single-json output. */
interface RawVideoInfo {
  id?: string;
  title?: string;
  webpage_url?: string;
  original_url?: string;
  duration?: number;
}

interface RawFlatPlaylistInfo {
  _type?: string;
  entries?: RawVideoInfo[];
  title?: string;
}

/** Ensures the temp directory used by the download/play/delete cycle exists. */
export async function ensureTempDir(): Promise<void> {
  await fs.mkdir(config.tempDir, { recursive: true });
}

/** True if the given URL points at a YouTube playlist (has a `list=` param). */
export function isPlaylistUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.searchParams.has("list");
  } catch {
    return false;
  }
}

function toWatchUrl(info: RawVideoInfo): string {
  if (info.webpage_url) return info.webpage_url;
  if (info.original_url) return info.original_url;
  if (info.id) return `https://www.youtube.com/watch?v=${info.id}`;
  throw new Error("yt-dlp returned a video entry with no usable URL");
}

/**
 * Fetches metadata for a single video without downloading it and without
 * expanding playlists (`--no-playlist`), regardless of whether the URL
 * carries a `list=` parameter.
 */
export async function fetchSingleVideoMetadata(url: string, requestedBy: string): Promise<TrackMetadata> {
  logger.debug({ url }, "Fetching single-video metadata");

  const raw = (await ytdl(url, {
    dumpSingleJson: true,
    noPlaylist: true,
    noWarnings: true,
    ...extraFlags(),
  })) as unknown as RawVideoInfo;

  return {
    url: toWatchUrl(raw),
    title: raw.title ?? "Unknown title",
    durationSeconds: raw.duration,
    requestedBy,
  };
}

/**
 * Expands a playlist URL into its member videos WITHOUT downloading any
 * media (`--flat-playlist`). Used for the "Load entire playlist" button flow
 * so the queue can be populated cheaply, letting the pre-fetch logic handle
 * actual downloads one at a time.
 */
export async function fetchPlaylistEntries(url: string): Promise<PlaylistEntry[]> {
  logger.debug({ url }, "Fetching flat playlist entries");

  const raw = (await ytdl(url, {
    dumpSingleJson: true,
    flatPlaylist: true,
    noWarnings: true,
    yesPlaylist: true,
    ...extraFlags(),
  })) as unknown as RawFlatPlaylistInfo;

  const entries = raw.entries ?? [];
  return entries
    .filter((entry) => Boolean(entry.id || entry.webpage_url || entry.original_url))
    .map((entry) => ({
      url: toWatchUrl(entry),
      title: entry.title ?? "Unknown title",
      durationSeconds: entry.duration,
    }));
}

/**
 * Downloads a single track's audio into the temp directory as an mp3 and
 * returns the absolute file path. Each call gets a unique filename (even for
 * the same URL queued twice via loop mode) so concurrent pre-fetch/playback
 * never collide.
 */
export async function downloadTrackAudio(url: string): Promise<string> {
  await ensureTempDir();

  const uniqueId = crypto.randomUUID();
  const outputTemplate = path.join(config.tempDir, `${uniqueId}.%(ext)s`);
  const finalPath = path.join(config.tempDir, `${uniqueId}.mp3`);

  logger.info({ url, finalPath }, "Downloading track audio");

  await ytdl(url, {
    extractAudio: true,
    audioFormat: "mp3",
    audioQuality: 0,
    noPlaylist: true,
    output: outputTemplate,
    noWarnings: true,
    ...extraFlags(),
  });

  await fs.access(finalPath);
  return finalPath;
}

/** Deletes a downloaded track's file from disk, swallowing "already gone" errors. */
export async function deleteTrackFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
    logger.debug({ filePath }, "Deleted finished track file");
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code !== "ENOENT") {
      logger.warn({ err, filePath }, "Failed to delete track file");
    }
  }
}

function extraFlags(): Record<string, boolean | string> {
  if (config.ytDlpExtraArgs.length === 0) return {};
  // youtube-dl-exec accepts a flat flags object; pass raw extractor args
  // through untouched via the library's support for arbitrary "--flag value"
  // pairs by folding them into a single addendum executed via `execArgv`-like
  // passthrough is not supported, so we encode them as boolean/string flags
  // youtube-dl-exec understands (kebab-case without leading dashes).
  const flags: Record<string, boolean | string> = {};
  for (let i = 0; i < config.ytDlpExtraArgs.length; i++) {
    const token = config.ytDlpExtraArgs[i];
    if (!token) continue;
    if (token.startsWith("--")) {
      const key = camelCase(token.slice(2));
      const next = config.ytDlpExtraArgs[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

function camelCase(kebab: string): string {
  return kebab.replace(/-([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}
