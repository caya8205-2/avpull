# 
```
 █████╗  ██╗   ██╗ ██████╗  ██╗   ██╗ ██╗      ██╗     
██╔══██╗ ██║   ██║ ██╔══██╗ ██║   ██║ ██║      ██║     
███████║ ██║   ██║ ██████╔╝ ██║   ██║ ██║      ██║     
██╔══██║ ╚██╗ ██╔╝ ██╔═══╝  ██║   ██║ ██║      ██║     
██║  ██║  ╚████╔╝  ██║      ╚██████╔╝ ███████╗ ███████╗
╚═╝  ╚═╝   ╚═══╝   ╚═╝       ╚═════╝  ╚══════╝ ╚══════╝
```

[![npm](https://img.shields.io/npm/v/avpull?style=flat&logo=npm&logoColor=white)](https://www.npmjs.com/package/avpull?activeTab=readme)
[![Node.js](https://img.shields.io/badge/Node.js-18+-43853d?style=flat&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Bun](https://img.shields.io/badge/Bun-1.0+-f472b6?style=flat&logo=bun&logoColor=white)](https://bun.sh/)
[![innertube-rs](https://img.shields.io/badge/innertube--rs-Rust-dea584?style=flat&logo=rust&logoColor=white)](https://github.com/caya8205-2/innertube-rs)
[![yt‑dlp](https://img.shields.io/badge/yt--dlp-bundled-red?style=flat&logo=youtube&logoColor=white)](https://github.com/yt-dlp/yt-dlp)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-bundled-007808?style=flat&logo=ffmpeg&logoColor=white)](https://ffmpeg.org/)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat)](LICENSE)

> Download audio/video from YouTube, Twitter/X, Instagram, Facebook, TikTok, Reddit, and more — convert directly to your chosen format (mp3, wav, mp4, etc.). No sketchy third-party downloader sites.

**Perfect for:** soundboards, sound effects, BGM for editing, or saving video clips.

---

## Quick Start

```powershell
# Install globally
npm install -g avpull

# Download and convert
avpull "https://youtu.be/VIDEO_ID" -f mp3 -q 320
```

---

## Installation

### Option 1: One-line Install (Windows)

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://avpull.caya.web.id/install.ps1 | iex"
```

This downloads and installs from the latest GitHub Release.

### Option 2: npm

```powershell
npm install -g avpull
```

### Option 3: Build from Source

```powershell
git clone https://github.com/caya8205-2/avpull.git
cd avpull
bun install
bun run build
```

**Requirements:** Node.js 18+ • ffmpeg is bundled via `ffmpeg-static`

---

## Usage

### Basic Download

```powershell
# Single URL, default mp3 192kbps, saved to ./avpull/
avpull "https://youtu.be/VIDEO_ID"
```

### Custom Format & Quality

```powershell
# Audio formats
avpull "https://youtu.be/VIDEO_ID" -f wav
avpull "https://youtu.be/VIDEO_ID" -f mp3 -q 320

# Video download
avpull "https://youtu.be/VIDEO_ID" -f mp4 -q 1080
```

### Multi-Platform Download

```powershell
# Twitter/X
avpull "https://x.com/user/status/123" -f mp4

# Instagram (public reels work without cookies)
avpull "https://www.instagram.com/reel/ABC/" -f mp4

# Instagram/Facebook (login-gated content needs cookies)
avpull "https://www.instagram.com/reel/ABC/" -f mp4 --cookies-from-browser chrome

# Facebook
avpull "https://www.facebook.com/watch/?v=123" -f mp4

# TikTok
avpull "https://www.tiktok.com/@user/video/123" -f mp3

# Reddit
avpull "https://reddit.com/r/sub/comments/xyz/" -f mp4
```

### Batch Download

```powershell
# Multiple URLs at once
avpull url1 url2 url3 -f opus

# From a text file (one URL per line)
avpull -b urls.txt -f mp3
```

**urls.txt example:**
```
https://youtu.be/VIDEO_1
https://youtu.be/VIDEO_2
# lines starting with # are ignored
```

### Custom Output

```powershell
# Custom filename & output folder
avpull "https://youtu.be/VIDEO_ID" -n "my-song" -o ./downloads -f wav -q 320
```

### Interactive Mode

```powershell
# No arguments? Interactive prompts will guide you
avpull
```

---

## Options

| Flag | Description |
|---|---|
| `-f, --format <format>` | Output format: `mp3`, `wav`, `m4a`, `opus`, `flac`, `aac`, `ogg` (audio) or `mp4`, `webm`, `mkv` (video). **Default:** `mp3` |
| `-q, --quality <n>` | Audio: bitrate in kbps (`128`, `192`, `320`, etc). Video: resolution (`480`, `720`, `1080`) or `best`. |
| `-o, --output <dir>` | Output folder. **Default:** `avpull` |
| `-n, --name <name>` | Custom filename (without extension). Only applies when using a single URL. |
| `-b, --batch <file>` | Read URL list from a text file (one URL per line). |
| `--cookies-from-browser <browser>` | Use cookies from browser (`chrome`, `firefox`, `edge`, `brave`). Needed for login-gated content on Instagram/Facebook. |
| `--cookies <file>` | Path to cookies.txt file (Netscape format). |
| `-h, --help` | Display help information. |

---

## Technical Details

### Architecture

- **YouTube:** Uses [`innertube-rs`](https://github.com/caya8205-2/innertube-rs) — custom high-performance Rust port of YouTube.js for fast YouTube metadata extraction and stream fetching.
- **Other Platforms:** Uses [yt-dlp](https://github.com/yt-dlp/yt-dlp) (bundled) for Twitter/X, Instagram, Facebook, TikTok, Reddit, and 1000+ other sites.
- **Media Processing:** FFmpeg bundled via `ffmpeg-static` — no manual installation required.
- **Video Quality:** YouTube uses adaptive streams (video+audio muxed with ffmpeg), typically up to **1080p**. Other platforms use best available quality.
- **Audio Conversion:** Fast remux (`-c copy`) when source codec is compatible; otherwise re-encodes.

### Tech Stack

- **Runtime:** Node.js 18+ / Bun 1.0+
- **CLI Framework:** Commander.js
- **YouTube Client:** [innertube-rs](https://github.com/caya8205-2/innertube-rs) (Rust)
- **Multi-Platform Downloader:** yt-dlp (bundled)
- **Media Processing:** FFmpeg (bundled)
- **Colors:** picocolors

---

## Development

### Local Setup (npm link)

```powershell
cd avpull
npm install
npm link
avpull --help
```

### Build Binary

```powershell
bun run build
# Output: dist/avpull.exe (Windows)
```

### Release Build

```powershell
bun run release
# Builds binary + copies ffmpeg & yt-dlp to dist/
```

---

## License

MIT License — see [LICENSE](LICENSE) for details.