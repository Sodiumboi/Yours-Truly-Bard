# Discord Music Bot — Download → Play → Delete

A stability-first Discord music bot. Instead of streaming audio directly
from YouTube (which is prone to mid-song connection drops), it downloads
each track to disk with `yt-dlp` (via `youtube-dl-exec`), plays the local
file through `@discordjs/voice`, and deletes it once finished. The *next*
track is pre-fetched in the background while the current one plays, so
there's never more than ~2 files on disk per guild.

## Architecture

```
src/
  config.ts              Env var loading/validation
  logger.ts               pino logger
  types/index.ts           Shared types (TrackMetadata, DownloadedTrack, LoopMode, ...)
  audio/
    downloader.ts          Thin wrapper around youtube-dl-exec (yt-dlp):
                            metadata-only fetch, flat-playlist expansion,
                            single-track download, file deletion
    GuildMusicPlayer.ts     One per guild. Owns the voice connection,
                            AudioPlayer, metadata queue, and the
                            download -> play -> delete + pre-fetch state
                            machine (including loop modes)
    PlayerManager.ts        Map<guildId, GuildMusicPlayer> registry
  commands/                 One file per slash command (play, skip, loop,
                             list, stop), aggregated in index.ts
  handlers/
    playlistButtons.ts      "Play first song only" vs "Load entire
                             playlist" button UX, scoped to the command's
                             own reply message
  utils/voice.ts            Voice-channel membership/permission checks
  index.ts                  Discord client bootstrap + interaction routing
  deployCommands.ts         One-off script to register slash commands
```

Playback pipeline, in order:

1. `/play <url>` — if the URL has a `list=` param, the user is prompted
   with two buttons (see below). Otherwise the video's metadata is fetched
   (`--dump-single-json --no-playlist`, no download yet) and queued.
2. `GuildMusicPlayer.advance()` downloads the head of the queue to
   `temp/<uuid>.mp3` and starts playback, then immediately kicks off a
   **pre-fetch** of the *next* queued track in the background.
3. When the `AudioPlayer` goes `Idle` (track ended or was skipped):
   - `loop: song` → replay the same file, skip deletion.
   - `loop: queue` → push the finished track's metadata to the end of the
     queue before deleting its file.
   - otherwise → delete the finished file with `fs.unlink`.
   - Then play the already-downloaded pre-fetched track (or download it on
     the spot if the pre-fetch hadn't finished yet) and schedule the next
     pre-fetch.

### Playlist URL buttons

`/play` detects `list=` in the URL and replies with **Play first song
only** / **Load entire playlist** buttons (a `MessageComponentCollector`
scoped to that one reply — no global customId routing needed):

- **First song only** → `yt-dlp --no-playlist` downloads just the initial
  video.
- **Entire playlist** → `yt-dlp --dump-single-json --flat-playlist`
  extracts titles/URLs for every video and pushes them into the in-memory
  queue as metadata only. No media is downloaded at this step — the
  pre-fetch logic above downloads each one in turn as playback reaches it.

## Commands

| Command | Description |
| --- | --- |
| `/play url:<url>` | Queue a video, or prompt for playlist handling |
| `/skip` | Stop the current track; the idle handler advances the queue |
| `/loop mode:<none\|song\|queue>` | Set loop behavior |
| `/list` | Show now playing + upcoming queue |
| `/stop` | Clear the queue, delete any files on disk, leave the channel |

## Setup

```bash
npm install
cp .env.example .env   # fill in DISCORD_TOKEN / DISCORD_CLIENT_ID
npm run deploy-commands:dev   # registers slash commands (guild-scoped if DISCORD_GUILD_ID is set)
npm run dev             # or: npm run build && npm start
```

Requirements on the host (or see Docker below, which handles this for
you):

- **ffmpeg** on `PATH` — used both by `yt-dlp` for audio extraction and by
  `@discordjs/voice`/prism-media to transcode the downloaded mp3 into Opus.
- **Node.js** on `PATH` — yt-dlp now needs an external JS runtime to solve
  YouTube's player-JS challenges reliably (`--js-runtimes node
  --remote-components ejs:github`, already set as the default
  `YT_DLP_EXTRA_ARGS` in `.env.example`). `node` itself satisfies this.

### Environment variables

See `.env.example` for the full, commented list — `DISCORD_TOKEN`,
`DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID` (optional, for instant dev command
updates), `YOUTUBE_DL_BINARY_PATH` (optional custom binary), `YT_DLP_EXTRA_ARGS`,
`TEMP_DIR`, `PREFETCH_AHEAD`, `LOG_LEVEL`.

## Docker (Proxmox VE)

```bash
cp .env.example .env   # fill in your bot credentials
docker compose up -d --build
```

- The image is built in two stages: a `builder` stage with build tools
  (for `@discordjs/opus`'s optional native compile fallback) compiles
  TypeScript and prunes dev dependencies; the `runtime` stage is a slim
  `node:22-bookworm-slim` image with just `ffmpeg` + the compiled `dist/` +
  production `node_modules`, running as a non-root user.
- `temp/` is declared as a Docker `VOLUME` in the image and bind-mounted
  via `docker-compose.yml` (`./temp:/app/temp`) — so downloaded-then-deleted
  audio files never touch the image or a container's writable layer, and
  you can watch the directory on the Proxmox host stay near-empty at
  steady state (current track + one pre-fetched track).
- `restart: unless-stopped` keeps it running across host reboots inside
  your Proxmox VE VM/LXC; adjust `security_opt` / add resource limits as
  needed for your environment.

To register slash commands from inside the container once:

```bash
docker compose exec music-bot node dist/deployCommands.js
```
