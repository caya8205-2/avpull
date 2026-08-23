#!/usr/bin/env bash
set -euo pipefail

REPO_OWNER="caya8205-2"
REPO_NAME="avpull"
INSTALL_DIR="${HOME}/.local/bin/avpull"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
DIM='\033[2m'
NC='\033[0m'

checkmark() {
  echo -e "  ${GREEN}>> $1${NC}"
}

warn() {
  echo -e "  ${YELLOW}WARNING: $1${NC}"
}

err() {
  echo -e "  ${RED}ERROR: $1${NC}"
}

# ── Detect OS & arch ──────────────────────────────────────
detect_platform() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Linux*)  PLATFORM="linux" ;;
    Darwin*) PLATFORM="macos" ;;
    *)       err "Unsupported OS: $os"; exit 1 ;;
  esac

  case "$arch" in
    x86_64|amd64) ARCH="x64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *)             err "Unsupported architecture: $arch"; exit 1 ;;
  esac
}

# ── Determine binary names for GitHub Release assets ──────
get_binary_names() {
  AVPULL_BIN="avpull-${PLATFORM}"
  FFMPEG_RELEASE_BIN="ffmpeg-${PLATFORM}"
  YTDLP_RELEASE_BIN="yt-dlp-${PLATFORM}"
  INNERTUBE_RELEASE_BIN="innertube-${PLATFORM}"
}

# ── Download helper ───────────────────────────────────────
dl() {
  local url="$1" dest="$2" name
  name="$(basename "$url")"
  echo -n "  Downloading ${name} ..."
  if command -v curl &>/dev/null; then
    curl -fsSL -o "$dest" "$url"
  elif command -v wget &>/dev/null; then
    wget -qO "$dest" "$url"
  else
    err "Neither curl nor wget found. Cannot download."
    exit 1
  fi
  echo ""
  checkmark "Downloaded ${name}"
}

# ── Add to PATH via shell rc ─────────────────────────────
add_to_path() {
  local line="export PATH=\"${INSTALL_DIR}:\$PATH\""

  for rc in "${HOME}/.bashrc" "${HOME}/.zshrc" "${HOME}/.profile"; do
    if [ -f "$rc" ]; then
      if ! grep -qF "$INSTALL_DIR" "$rc" 2>/dev/null; then
        echo "" >> "$rc"
        echo "# avpull" >> "$rc"
        echo "$line" >> "$rc"
        checkmark "Added to PATH in $(basename "$rc")"
      fi
    fi
  done

  # Also add to current session
  export PATH="${INSTALL_DIR}:$PATH"
}

# ── Remove from PATH via shell rc ─────────────────────────
remove_from_path() {
  for rc in "${HOME}/.bashrc" "${HOME}/.zshrc" "${HOME}/.profile"; do
    if [ -f "$rc" ] && grep -qF "$INSTALL_DIR" "$rc" 2>/dev/null; then
      # Remove the avpull comment and PATH export line
      sed -i.bak "/# avpull/d" "$rc"
      sed -i.bak "\|${INSTALL_DIR}|d" "$rc"
      rm -f "${rc}.bak"
    fi
  done
}

# ── Uninstall ─────────────────────────────────────────────
do_uninstall() {
  echo -e "${YELLOW}Removing avpull ...${NC}"
  if [ -d "$INSTALL_DIR" ]; then
    rm -rf "$INSTALL_DIR"
    checkmark "Removed ${INSTALL_DIR}"
  else
    warn "Install directory not found: ${INSTALL_DIR}"
  fi
  remove_from_path
  echo ""
  checkmark "avpull uninstalled"
}

# ── Main ──────────────────────────────────────────────────
main() {
  detect_platform
  get_binary_names

  # Handle --uninstall flag
  if [ "${1:-}" = "--uninstall" ] || [ "${1:-}" = "-u" ]; then
    do_uninstall
    exit 0
  fi

  echo -e "${CYAN}avpull installer (${PLATFORM}/${ARCH})${NC}"
  echo ""

  # Check if already installed
  if [ -f "${INSTALL_DIR}/avpull" ]; then
    echo -e "${YELLOW}avpull is already installed.${NC}"
    echo "  [U]ninstall   - remove avpull"
    echo "  [R]einstall   - overwrite files"
    echo "  [C]ancel      - do nothing"
    read -rp "Choice: " choice
    choice="$(echo "$choice" | tr '[:lower:]' '[:upper:]')"
    case "$choice" in
      U) do_uninstall; exit 0 ;;
      R) ;; # continue to install
      *) echo -e "${DIM}Cancelled.${NC}"; exit 0 ;;
    esac
  fi

  # Create install dir
  mkdir -p "$INSTALL_DIR"

  # Check for local install (running from dist/ folder)
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd 2>/dev/null || true)"
  LOCAL_BIN="${SCRIPT_DIR}/avpull"

  if [ -n "$SCRIPT_DIR" ] && [ -f "$LOCAL_BIN" ]; then
    echo -e "${CYAN}Installing from local files ...${NC}"
    cp "$LOCAL_BIN" "${INSTALL_DIR}/avpull"
    chmod +x "${INSTALL_DIR}/avpull"
    checkmark "Copied avpull"

    if [ -f "${SCRIPT_DIR}/ffmpeg" ]; then
      cp "${SCRIPT_DIR}/ffmpeg" "${INSTALL_DIR}/ffmpeg"
      chmod +x "${INSTALL_DIR}/ffmpeg"
      checkmark "Copied ffmpeg"
    else
      warn "ffmpeg not found, must be in PATH"
    fi

    if [ -f "${SCRIPT_DIR}/yt-dlp" ]; then
      cp "${SCRIPT_DIR}/yt-dlp" "${INSTALL_DIR}/yt-dlp"
      chmod +x "${INSTALL_DIR}/yt-dlp"
      checkmark "Copied yt-dlp"
    else
      warn "yt-dlp not found, non-YouTube downloads may not work"
    fi

    if [ -f "${SCRIPT_DIR}/innertube" ]; then
      cp "${SCRIPT_DIR}/innertube" "${INSTALL_DIR}/innertube"
      chmod +x "${INSTALL_DIR}/innertube"
      checkmark "Copied innertube"
    else
      warn "innertube not found, YouTube downloads may fail"
    fi
  else
    echo -e "${CYAN}Fetching release info from GitHub ...${NC}"

    # Get release info
    local api_url="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest"
    local release_json
    if command -v curl &>/dev/null; then
      release_json="$(curl -fsSL -H "User-Agent: avpull-installer" "$api_url")"
    else
      release_json="$(wget -qO- --header="User-Agent: avpull-installer" "$api_url")"
    fi

    local tag_name
    tag_name="$(echo "$release_json" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"

    if [ -z "$tag_name" ]; then
      err "Failed to fetch release info from GitHub."
      echo -e "${YELLOW}Make sure the repository has published releases.${NC}"
      echo -e "${CYAN}You can also download manually from:${NC}"
      echo "https://github.com/${REPO_OWNER}/${REPO_NAME}/releases"
      exit 1
    fi

    checkmark "Found release ${tag_name}"
    local base_url="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${tag_name}"

    dl "${base_url}/${AVPULL_BIN}" "${INSTALL_DIR}/avpull"
    chmod +x "${INSTALL_DIR}/avpull"

    dl "${base_url}/${FFMPEG_RELEASE_BIN}" "${INSTALL_DIR}/ffmpeg"
    chmod +x "${INSTALL_DIR}/ffmpeg"

    dl "${base_url}/${YTDLP_RELEASE_BIN}" "${INSTALL_DIR}/yt-dlp"
    chmod +x "${INSTALL_DIR}/yt-dlp"

    dl "${base_url}/${INNERTUBE_RELEASE_BIN}" "${INSTALL_DIR}/innertube"
    chmod +x "${INSTALL_DIR}/innertube"
  fi

  add_to_path

  echo ""
  checkmark "Installation complete"
  echo ""
  echo -e "${CYAN}Installed to:${NC}"
  echo -e "  ${INSTALL_DIR}"
  echo ""
  echo -e "Open a new terminal and run: ${GREEN}avpull --help${NC}"
}

main "$@"
