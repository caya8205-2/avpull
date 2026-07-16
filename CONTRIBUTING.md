# Contributing to avpull

Thanks for considering contributing to avpull! This document outlines the development workflow and guidelines.

---

## 🛠️ Development Setup

### Prerequisites

- **Node.js** 18+ or **Bun** 1.0+
- **Git**
- **PowerShell** (for Windows-specific scripts)

### Local Setup

```powershell
# Clone the repository
git clone https://github.com/caya8205-2/avpull.git
cd avpull

# Install dependencies
bun install

# Link for local development
npm link

# Test the CLI
avpull --help
```

---

## 📦 Project Structure

```
avpull/
├── bin/              # CLI entry point
│   └── avpull.js
├── src/              # Source code
│   ├── cli.js        # Main CLI logic
│   ├── lib.js        # Core download/convert logic
│   └── ui.js         # Terminal UI helpers
├── scripts/          # Build & release scripts
│   ├── copy-ffmpeg.js
│   ├── install.ps1   # Windows installer
│   └── release.ps1   # Release helper
├── landing/          # Landing page (deployed to GitHub Pages)
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── tokens.css
├── dist/             # Build output (gitignored, CI-generated)
└── .github/          # GitHub Actions workflows
    └── workflows/
        ├── build.yml  # Build & deploy
        └── ci.yml     # Continuous integration
```

---

## 🔨 Build & Test

### Build Binary

```powershell
# Build only
bun run build

# Build + copy ffmpeg
bun run release

# Verify output
Test-Path dist/avpull.exe
Test-Path dist/ffmpeg.exe

# Test the binary
.\dist\avpull.exe --help
```

### Local Testing

```powershell
# Run from source (no build)
node bin/avpull.js "https://youtu.be/VIDEO_ID"

# Or via npm link
avpull "https://youtu.be/VIDEO_ID"
```

---

## 🚀 Release Process

### Using the Release Helper

```powershell
# Run the helper script
.\scripts\release.ps1 -Version "1.0.0"

# This will:
# 1. Update package.json version
# 2. Build the binary
# 3. Copy ffmpeg
# 4. Verify artifacts
# 5. Optionally commit & tag
```

### Manual Release

```powershell
# 1. Update version in package.json
# 2. Build
bun run release

# 3. Commit changes
git add .
git commit -m "chore: release v1.0.0"

# 4. Create tag
git tag v1.0.0

# 5. Push (triggers GitHub Actions)
git push origin main --tags
```

### What Happens on Push

1. **CI Workflow** runs:
   - Lints and builds on Ubuntu
   - Builds and verifies on Windows

2. **Build Workflow** runs:
   - Builds Windows binary
   - Copies ffmpeg
   - Uploads artifacts (30 day retention)
   - Deploys landing page to GitHub Pages

3. **On Tag Push** (`v*`):
   - Creates GitHub Release
   - Attaches `avpull.exe`, `ffmpeg.exe`, `install.ps1`

---

## 📝 Commit Convention

Use conventional commits for clear history:

- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation changes
- `chore:` — Maintenance tasks
- `refactor:` — Code refactoring
- `test:` — Test additions/changes
- `ci:` — CI/CD changes

**Examples:**
```
feat: add support for playlist downloads
fix: handle invalid URL format gracefully
docs: update README with new examples
chore: release v1.0.0
```

---

## 🐛 Reporting Issues

Before opening an issue:

1. Check if it's already reported
2. Provide reproduction steps
3. Include system info:
   - OS version
   - Node.js/Bun version
   - avpull version (`avpull --version`)
   - Error output

**Issue Template:**
```
**Description:**
Brief description of the issue.

**Reproduction:**
1. Step one
2. Step two
3. ...

**Expected:**
What you expected to happen.

**Actual:**
What actually happened.

**Environment:**
- OS: Windows 11
- Node.js: v20.10.0
- avpull: v1.0.0

**Error Output:**
```
Paste error messages here
```
```

---

## 🎨 Landing Page Development

The landing page lives in `./landing` and is auto-deployed to GitHub Pages.

### Local Preview

```powershell
# Serve with any static server
npx serve landing

# Or open directly
start landing/index.html
```

### Design System

The landing page uses **Hallmark design system**:
- Tokens: `landing/tokens.css`
- Theme: Terminal (monospace, phosphor-green accent)
- Responsive: mobile-first, 320px+
- No JavaScript dependencies (vanilla)

---

## 🔒 Security

- **No secrets in commits** — use environment variables
- **No credentials** — YouTube API is accessed via `youtubei.js` (no keys required)
- **Dependency updates** — keep dependencies up-to-date

---

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

## 🤝 Questions?

- Open an issue for questions
- Check existing issues/PRs first
- Be respectful and constructive

**Happy coding!** 🎉
