# GitHub Actions Workflows

This directory contains automated CI/CD workflows for avpull.

## Workflows

### 🔨 `build.yml` — Build and Release

**Triggers:**
- Push to `main`/`master` branch
- New version tags (`v*`)
- Pull requests
- Manual dispatch

**Jobs:**

1. **build** — Builds Windows binary
   - Runs on: `windows-latest`
   - Uses Bun to compile binary
   - Copies ffmpeg to `dist/`
   - Uploads artifacts (30 day retention)
   - Creates GitHub Release (on version tags)

2. **deploy-pages** — Deploys landing page
   - Runs on: `ubuntu-latest`
   - Only on `main`/`master` push
   - Deploys `./landing` to GitHub Pages
   - Requires Pages to be enabled in repo settings

**Artifacts:**
- `avpull.exe` — Windows executable
- `ffmpeg.exe` — Bundled FFmpeg binary
- Retained for 30 days

**Release Files:**
- `dist/avpull.exe`
- `dist/ffmpeg.exe`
- `scripts/install.ps1`

---

### ✅ `ci.yml` — Continuous Integration

**Triggers:**
- Push to `main`/`master` branch
- Pull requests

**Jobs:**

1. **lint** — Lint & Type Check
   - Runs on: `ubuntu-latest`
   - Verifies build succeeds

2. **build-artifacts** — Build Verification
   - Runs on: `windows-latest`
   - Builds binary
   - Verifies `avpull.exe` and `ffmpeg.exe` exist

---

## Setup Requirements

### GitHub Pages Deployment

1. Go to **Settings** → **Pages**
2. Set **Source** to "GitHub Actions"
3. Workflow will auto-deploy `./landing` on push to `main`

### Release Creation

- Push a version tag to trigger release:
  ```powershell
  git tag v1.0.0
  git push origin v1.0.0
  ```
- Release will include binaries + install script
- Draft and prerelease flags are set to `false`

### Secrets

No secrets required — uses `GITHUB_TOKEN` (auto-provided).

---

## Local Testing

Test the build locally before pushing:

```powershell
# Build binary
bun run build

# Verify artifacts
Test-Path dist/avpull.exe
Test-Path dist/ffmpeg.exe

# Run the binary
.\dist\avpull.exe --help
```

---

## Workflow Permissions

The workflows require these permissions:

- **build.yml:**
  - `contents: write` (for releases, inherited)
  - `pages: write` (for Pages deployment)
  - `id-token: write` (for Pages deployment)

- **ci.yml:**
  - `contents: read` (default)
