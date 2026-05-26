#!/usr/bin/env bash
# Build whisper.cpp's whisper-server on Linux for the ReWrite Obsidian plugin.
#
# Supports Debian/Ubuntu/Mint, Fedora/RHEL/CentOS/Rocky/Alma, Arch/Manjaro/EndeavourOS,
# and openSUSE. Falls back to --skip-deps for anything else.
#
# Usage: bash scripts/build-whisper-linux.sh [options]
#   --cuda             Build with NVIDIA CUDA acceleration (requires CUDA toolkit).
#   --source-dir DIR   Where to clone whisper.cpp. Default: $HOME/.local/share/whisper.cpp
#   --prefix DIR       Where to symlink the binary. Default: $HOME/.local/bin
#   --no-symlink       Skip the symlink step; just print the built binary path.
#   --skip-deps        Do not run the distro package-install step.
#   --jobs N           Parallel build jobs. Default: nproc.
#   -h, --help         Show this help.

set -euo pipefail

REPO_URL="https://github.com/ggml-org/whisper.cpp.git"
SOURCE_DIR="${HOME}/.local/share/whisper.cpp"
PREFIX="${HOME}/.local/bin"
USE_CUDA=0
DO_SYMLINK=1
SKIP_DEPS=0
JOBS=""

log() { printf '\033[1;34m[build-whisper]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[build-whisper]\033[0m %s\n' "$*" >&2; }
err() { printf '\033[1;31m[build-whisper]\033[0m %s\n' "$*" >&2; }

# Normalize a path: expand a leading ~ and resolve to an absolute path.
# We don't require the path to exist yet (it may be the install target).
normalize_path() {
	local p="$1"
	# Expand a leading tilde manually. We avoid `eval` and avoid relying on
	# tilde expansion (which doesn't happen inside double quotes or after
	# assignment from a function argument).
	if [ "$p" = "~" ]; then
		p="$HOME"
	elif [ "${p#\~/}" != "$p" ]; then
		p="${HOME}/${p#\~/}"
	fi
	case "$p" in
		/*) printf '%s\n' "$p" ;;
		*)  printf '%s/%s\n' "$PWD" "$p" ;;
	esac
}

usage() {
	# Try to print the header comment block from the script file. When the script
	# is piped (curl | bash), $0 is "bash" or "-" and reading it won't work, so
	# fall back to an inline help string.
	if [ -f "$0" ] && [ -r "$0" ]; then
		awk 'NR==1{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "$0"
	else
		cat <<'HELP'
Build whisper.cpp's whisper-server on Linux for the ReWrite Obsidian plugin.

Usage: bash build-whisper-linux.sh [options]
  --cuda             Build with NVIDIA CUDA acceleration (requires CUDA toolkit).
  --source-dir DIR   Where to clone whisper.cpp. Default: $HOME/.local/share/whisper.cpp
  --prefix DIR       Where to symlink the binary. Default: $HOME/.local/bin
  --no-symlink       Skip the symlink step; just print the built binary path.
  --skip-deps        Do not run the distro package-install step.
  --jobs N           Parallel build jobs. Default: nproc.
  -h, --help         Show this help.
HELP
	fi
	exit "${1:-0}"
}

while [ $# -gt 0 ]; do
	case "$1" in
		--cuda) USE_CUDA=1; shift ;;
		--source-dir) SOURCE_DIR="${2:?--source-dir needs a path}"; shift 2 ;;
		--prefix) PREFIX="${2:?--prefix needs a path}"; shift 2 ;;
		--no-symlink) DO_SYMLINK=0; shift ;;
		--skip-deps) SKIP_DEPS=1; shift ;;
		--jobs) JOBS="${2:?--jobs needs a number}"; shift 2 ;;
		-h|--help) usage 0 ;;
		*) err "Unknown option: $1"; usage 1 ;;
	esac
done

if [ -z "$JOBS" ]; then
	if command -v nproc >/dev/null 2>&1; then
		JOBS="$(nproc)"
	else
		JOBS=4
	fi
fi

# Normalize user-supplied paths now that argument parsing is done.
# This handles `~`, `~/foo`, and relative paths like `./build`.
SOURCE_DIR="$(normalize_path "$SOURCE_DIR")"
PREFIX="$(normalize_path "$PREFIX")"

# ---------- distro detection ----------

detect_distro() {
	if [ ! -r /etc/os-release ]; then
		echo "unknown"
		return
	fi
	# shellcheck disable=SC1091
	. /etc/os-release
	local id="${ID:-}"
	local id_like="${ID_LIKE:-}"
	local all=" ${id} ${id_like} "
	case "$all" in
		*" debian "*|*" ubuntu "*|*" linuxmint "*|*" pop "*|*" raspbian "*) echo "debian" ;;
		*" fedora "*|*" rhel "*|*" centos "*|*" rocky "*|*" almalinux "*) echo "fedora" ;;
		*" arch "*|*" manjaro "*|*" endeavouros "*|*" cachyos "*) echo "arch" ;;
		*" opensuse "*|*" opensuse-tumbleweed "*|*" opensuse-leap "*|*" suse "*) echo "suse" ;;
		*) echo "unknown" ;;
	esac
}

sudo_cmd() {
	if [ "$(id -u)" -eq 0 ]; then
		"$@"
	elif command -v sudo >/dev/null 2>&1; then
		sudo "$@"
	else
		err "Need root or sudo to install packages. Re-run as root, install sudo, or use --skip-deps."
		exit 1
	fi
}

install_deps() {
	local distro="$1"
	case "$distro" in
		debian)
			log "Installing build deps via apt..."
			sudo_cmd apt-get update
			sudo_cmd apt-get install -y build-essential cmake git
			;;
		fedora)
			log "Installing build deps via dnf..."
			sudo_cmd dnf install -y gcc-c++ make cmake git
			;;
		arch)
			log "Installing build deps via pacman..."
			# -Sy refreshes the package database so install doesn't fail on stale mirror data.
			# We deliberately avoid -Syu (full system upgrade) since partial upgrades are
			# unsupported on Arch and a script shouldn't surprise the user with one.
			sudo_cmd pacman -Sy --needed --noconfirm base-devel cmake git
			;;
		suse)
			log "Installing build deps via zypper..."
			sudo_cmd zypper install -y gcc-c++ make cmake git
			;;
		unknown|*)
			warn "Could not identify distro from /etc/os-release."
			warn "Install these yourself, then rerun with --skip-deps:"
			warn "  a C++17 compiler (g++ 9 or newer), make, cmake (>= 3.10), git"
			exit 1
			;;
	esac
}

check_tools() {
	local missing=()
	for tool in git cmake make; do
		command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
	done
	# Need either g++ or clang++.
	if ! command -v g++ >/dev/null 2>&1 && ! command -v clang++ >/dev/null 2>&1; then
		missing+=("g++ or clang++")
	fi
	if [ "${#missing[@]}" -gt 0 ]; then
		err "Missing required tools: ${missing[*]}"
		err "Rerun without --skip-deps, or install them with your package manager."
		exit 1
	fi
}

# Fail early and clearly if --cuda was passed but no CUDA toolkit is visible.
# We can't install CUDA from a generic script, so the best we can do is bail
# before cmake spends time configuring and then failing with a noisy error.
check_cuda() {
	if command -v nvcc >/dev/null 2>&1; then
		return 0
	fi
	# Common install locations CUDA puts itself in but doesn't always add to PATH.
	for candidate in /usr/local/cuda/bin/nvcc /opt/cuda/bin/nvcc; do
		if [ -x "$candidate" ]; then
			warn "Found nvcc at ${candidate} but it's not on PATH. Add its directory to PATH and rerun."
			exit 1
		fi
	done
	err "--cuda was requested but no CUDA toolkit (nvcc) was found."
	err "Install the NVIDIA CUDA toolkit, ensure nvcc is on PATH, then rerun."
	exit 1
}

# Check g++ is recent enough for whisper.cpp's std::filesystem usage.
# Warn rather than abort, since clang++ may still be picked up by cmake.
check_gcc_version() {
	command -v g++ >/dev/null 2>&1 || return 0
	local ver
	ver="$(g++ -dumpfullversion -dumpversion 2>/dev/null | cut -d. -f1)"
	if [ -n "$ver" ] && [ "$ver" -lt 9 ] 2>/dev/null; then
		warn "g++ ${ver} is older than 9; whisper.cpp needs C++17. If the build fails on"
		warn "std::filesystem or similar, install g++-12 (or newer) and rerun."
	fi
}

# ---------- main flow ----------

DISTRO="$(detect_distro)"
log "Detected distro: ${DISTRO}"

if [ "$SKIP_DEPS" -eq 0 ]; then
	install_deps "$DISTRO"
else
	log "Skipping package install (--skip-deps). Verifying required tools are present..."
	check_tools
fi

check_gcc_version
if [ "$USE_CUDA" -eq 1 ]; then
	check_cuda
fi

# Clone or update whisper.cpp.
mkdir -p "$(dirname "$SOURCE_DIR")"
if [ -d "$SOURCE_DIR/.git" ]; then
	log "Existing clone at ${SOURCE_DIR}; pulling latest..."
	if [ -n "$(git -C "$SOURCE_DIR" status --porcelain)" ]; then
		warn "Local changes detected in ${SOURCE_DIR}; skipping update."
	else
		# Resolve the default branch. symbolic-ref may be unset on some clones;
		# fall back to master, which is what whisper.cpp currently uses.
		DEFAULT_BRANCH="$(git -C "$SOURCE_DIR" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || true)"
		DEFAULT_BRANCH="${DEFAULT_BRANCH:-master}"
		git -C "$SOURCE_DIR" fetch --quiet origin "$DEFAULT_BRANCH"
		# Use FETCH_HEAD so this works regardless of whether the local repo was
		# originally a shallow clone or had its tracking branch set up.
		git -C "$SOURCE_DIR" checkout --quiet "$DEFAULT_BRANCH" 2>/dev/null || \
			git -C "$SOURCE_DIR" checkout --quiet -b "$DEFAULT_BRANCH" FETCH_HEAD
		git -C "$SOURCE_DIR" reset --quiet --hard FETCH_HEAD
	fi
elif [ -d "$SOURCE_DIR" ] && [ -z "$(ls -A "$SOURCE_DIR" 2>/dev/null)" ]; then
	# An empty directory is fine; clone directly into it.
	log "Cloning whisper.cpp into existing empty ${SOURCE_DIR}..."
	git clone "$REPO_URL" "$SOURCE_DIR"
elif [ -e "$SOURCE_DIR" ]; then
	err "${SOURCE_DIR} exists but is not a git clone of whisper.cpp."
	err "Move it aside or pass --source-dir DIR to use a different location."
	exit 1
else
	log "Cloning whisper.cpp into ${SOURCE_DIR}..."
	# Full clone (not --depth 1) so subsequent updates and branch switches work cleanly.
	git clone "$REPO_URL" "$SOURCE_DIR"
fi

# Configure + build.
CMAKE_ARGS=(-B build -DCMAKE_BUILD_TYPE=Release)
if [ "$USE_CUDA" -eq 1 ]; then
	log "CUDA build requested (-DGGML_CUDA=ON). Expect a longer build."
	CMAKE_ARGS+=(-DGGML_CUDA=ON)
fi

log "Configuring (cmake ${CMAKE_ARGS[*]})..."
( cd "$SOURCE_DIR" && cmake "${CMAKE_ARGS[@]}" )

log "Building (jobs=${JOBS})..."
( cd "$SOURCE_DIR" && cmake --build build -j "$JOBS" --config Release )

BINARY="${SOURCE_DIR}/build/bin/whisper-server"
if [ ! -x "$BINARY" ]; then
	err "Build finished but ${BINARY} is missing or not executable."
	# Help the user see whether the binary was renamed upstream rather than just
	# saying "missing" and leaving them to dig through the build tree.
	if [ -d "${SOURCE_DIR}/build/bin" ]; then
		err "Binaries actually present in ${SOURCE_DIR}/build/bin:"
		# Use find rather than ls so this works even if there are no matches.
		find "${SOURCE_DIR}/build/bin" -maxdepth 1 -type f -executable -printf '  %f\n' >&2 || true
		err "If whisper-server was renamed upstream, update this script's BINARY path."
	fi
	err "Check the output above for errors. If you saw std::filesystem errors, install g++-12 or newer and rerun."
	exit 1
fi

log "Built: ${BINARY}"

FINAL_PATH="$BINARY"
if [ "$DO_SYMLINK" -eq 1 ]; then
	mkdir -p "$PREFIX"
	LINK="${PREFIX}/whisper-server"
	# Replace existing symlink, but refuse to overwrite a real file.
	if [ -L "$LINK" ] || [ ! -e "$LINK" ]; then
		ln -sf "$BINARY" "$LINK"
		log "Symlinked ${LINK} -> ${BINARY}"
		FINAL_PATH="$LINK"
	else
		warn "${LINK} exists and is not a symlink; leaving it alone."
		warn "Use the built binary path directly, or remove ${LINK} and rerun."
	fi
fi

cat <<EOF

Done. In Obsidian: Settings, ReWrite, "Local whisper.cpp server (desktop)",
set Binary path to:

  ${FINAL_PATH}

You still need a GGML model file. Grab one from
https://huggingface.co/ggerganov/whisper.cpp/tree/main (e.g. ggml-base.en.bin)
and point the Model path field at it.

Sanity-check outside the plugin first:
  ${FINAL_PATH} -m /path/to/model.bin --port 8080
You should see: whisper server listening at http://127.0.0.1:8080
EOF
