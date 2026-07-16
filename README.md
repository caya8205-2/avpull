# 
```
 █████╗  ██╗   ██╗ ██████╗  ██╗   ██╗ ██╗      ██╗     
██╔══██╗ ██║   ██║ ██╔══██╗ ██║   ██║ ██║      ██║     
███████║ ██║   ██║ ██████╔╝ ██║   ██║ ██║      ██║     
██╔══██║ ╚██╗ ██╔╝ ██╔═══╝  ██║   ██║ ██║      ██║     
██║  ██║  ╚████╔╝  ██║      ╚██████╔╝ ███████╗ ███████╗
╚═╝  ╚═╝   ╚═══╝   ╚═╝       ╚═════╝  ╚══════╝ ╚══════╝
```

[![Node.js](https://img.shields.io/badge/Node.js-18+-43853d?style=flat&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Bun](https://img.shields.io/badge/Bun-1.0+-f472b6?style=flat&logo=bun&logoColor=white)](https://bun.sh/)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-bundled-007808?style=flat&logo=ffmpeg&logoColor=white)](https://ffmpeg.org/)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat)](LICENSE)

> Download audio/video from YouTube and convert directly to your chosen format — mp3, wav, mp4, etc. No sketchy third-party downloader sites, no external binaries (yt-dlp, etc.), just Node.js.

**Perfect for:** soundboards, sound effects, BGM for editing, or saving video clips.

---

## 🚀 Quick Start

```powershell
# Install globally
npm install -g avpull

# Download and convert
avpull "https://youtu.be/VIDEO_ID" -f mp3 -q 320
```

---

## 📦 Installation

### Option 1: One-line Install (Windows)

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://[your-domain]/install.ps1 | iex"
```

Replace `[your-domain]` with your deployment URL (GitHub Pages/Vercel).

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

## 💻 Usage

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

## ⚙️ Options

| Flag | Description |
|---|---|
| `-f, --format <format>` | Output format: `mp3`, `wav`, `m4a`, `opus`, `flac`, `aac`, `ogg` (audio) or `mp4`, `webm`, `mkv` (video). **Default:** `mp3` |
| `-q, --quality <n>` | Audio: bitrate in kbps (`128`, `192`, `320`, etc). Video: resolution (`480`, `720`, `1080`) or `best`. |
| `-o, --output <dir>` | Output folder. **Default:** `avpull` |
| `-n, --name <name>` | Custom filename (without extension). Only applies when using a single URL. |
| `-b, --batch <file>` | Read URL list from a text file (one URL per line). |
| `-h, --help` | Display help information. |

---

## 🔧 Technical Details

### Architecture

- **YouTube API:** Uses [`youtubei.js`](https://github.com/LuanRT/YouTube.js) (not yt-dlp) — pure JavaScript, no external binary dependencies.
- **Media Processing:** FFmpeg bundled via `ffmpeg-static` — no manual installation required.
- **Video Quality:** Uses YouTube's progressive streams (video+audio combined), typically maxing out at **720p-1080p**. For true 4K (requires muxing separate adaptive streams), let me know.
- **Audio Conversion:** Fast remux (`-c copy`) when source codec is compatible; otherwise re-encodes.

### Tech Stack

- **Runtime:** Node.js 18+ / Bun 1.0+
- **CLI Framework:** Commander.js
- **YouTube Client:** youtubei.js
- **Media Processing:** FFmpeg (bundled)
- **Colors:** picocolors

---

## 📝 Development

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
# Builds binary + copies ffmpeg to dist/
```

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 🔗 Links

- **Repository:** [github.com/caya8205-2/avpull](https://github.com/caya8205-2/avpull)
- **Issues:** [Report a bug](https://github.com/caya8205-2/avpull/issues)
- **Landing Page:** [your-domain] (coming soon)

---

<div align="center">
  <sub>Built with ❤️ using Node.js and FFmpeg</sub>
</div>
