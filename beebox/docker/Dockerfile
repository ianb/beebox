# beebox container image.
#
# Build context is the MONOREPO ROOT (the release tarball is built from the
# whole pnpm workspace). Build from the repo root:
#
#   docker build -f beebox/docker/Dockerfile -t beebox .
#
# or via beebox/docker/compose.yaml, which sets the context for you.
#
# Node 24: the repo pins ">=24.11 <25" with engine-strict, so the base image
# major must match. Debian (glibc) is mandatory, not Alpine: the Agent SDK's
# launcher resolves a glibc binary first (src/core/sdk-binary-path.ts, SDK
# issue #296) and musl breaks it.

# ─────────────────────────────────────────────────────────────────────────
# Build stage — install the workspace and produce the release tarball the
# same way src/scripts/release.ts does (build:cli + frontend build + pnpm pack).
# ─────────────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS build

# Native modules (better-sqlite3, etc.) may compile if no prebuilt binary is
# available for this arch — give the throwaway build stage the toolchain.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# husky's `prepare` script has no .git in the build context; skip it (avoids a
# noisy "can't find .git" line on every install).
ENV HUSKY=0
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /src
COPY . .

# Frozen install of the whole workspace (the lockfile is committed), then the
# release build. `pnpm pack` respects beebox's `files` allowlist; the
# resulting dist-release/*.tgz is the only artifact the runtime stage needs.
RUN pnpm install --frozen-lockfile \
  && pnpm --dir beebox release \
  && cp beebox/dist-release/*.tgz /beebox.tgz \
  && sed -n 's/^export const DOCLING_VERSION = "\([^"]*\)";$/\1/p' beebox/src/services/docling/version.ts > /docling-version \
  && test -s /docling-version

# ─────────────────────────────────────────────────────────────────────────
# Runtime stage — the box host: system binaries the agent is promised, the
# native Claude Code CLI, the installed engine, and a non-root user that owns
# everything and carries the git/LFS/auth state.
# ─────────────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim

# Git identity baked in as defaults; the entrypoint overrides from
# BBX_GIT_NAME / BBX_GIT_EMAIL at runtime if they are set.
ARG BBX_GIT_NAME="Bee Box"
ARG BBX_GIT_EMAIL="beebox@box.example.com"

# System binaries the agent is promised as "always available on the box host"
# (src/core/agent-guide/chat.ts): pandoc, imagemagick (magick), poppler-utils
# (pdftotext/pdfimages), and the Excel reader python3-openpyxl + xlsx2csv (.xlsx).
# Plus git, git-annex, and curl/ca for the Claude installer. git-annex is a HARD
# requirement: every box holds its assets in the annex from its first commit, and
# the per-box pre-commit hook runs `git annex pre-commit`, so without the binary
# every commit on every box fails. git-lfs is retired for assets but still
# installed for repos that carry legacy filters.
#
# sudo + systemd/dbus/procps: box package installs (`bbx host install`, below).
# systemd/dbus/procps match a server's base, so the wrapper's service rule
# judges only what a box adds; without them gLabels (which depends on dbus
# and systemd) would be refused here and accepted on a server. Nothing runs
# systemd in the container; the packages are inert.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       pandoc imagemagick poppler-utils python3-openpyxl xlsx2csv qpdf ffmpeg git git-lfs git-annex curl ca-certificates \
       sudo systemd dbus procps \
  && rm -rf /var/lib/apt/lists/* \
  # Debian ships ImageMagick 6 (`convert`); the agent contract and our scripts
  # call `magick` (IM7). Symlink so both names work (same as setup-server.sh).
  && if ! command -v magick >/dev/null 2>&1 && command -v convert >/dev/null 2>&1; then \
       ln -sf "$(command -v convert)" /usr/local/bin/magick; \
     fi

# uv runs Docling (`uvx docling`, scan-import's document mode), as on the
# server. Installed system-wide; its cache and Docling's model weights live in
# the persistent home volume (see the entrypoint's first-start prefetch).
RUN curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh

# fclones (duplicate-file finder, same promise as setup-server.sh). Upstream
# ships an amd64 .deb only; on other architectures the image simply lacks it.
ARG FCLONES_VERSION=0.35.0
RUN if [ "$(dpkg --print-architecture)" = "amd64" ]; then \
      curl -fsSL -o /tmp/fclones.deb "https://github.com/pkolaczk/fclones/releases/download/v${FCLONES_VERSION}/fclones_${FCLONES_VERSION}-1_amd64.deb" \
      && dpkg -i /tmp/fclones.deb && rm -f /tmp/fclones.deb; \
    fi

# The runtime user's home (/home/node) is a persistent volume in compose: it
# holds what beebox keeps per machine (accounts, the session key, the secret
# store, the Codex login, uv and Docling caches). A mounted volume hides
# whatever the image put there, so nothing the image needs lives in home:
# corepack's pnpm, the Claude CLI, and git settings are all outside it.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV COREPACK_HOME=/opt/corepack
RUN mkdir -p /opt/corepack /opt/claude && chown node:node /opt/corepack /opt/claude && corepack enable

# One runtime user for everything (the CLI and its credentials must share one
# home). The base image's `node` user is UID 1000 — reuse it. It owns /app
# (the engine) and /data (the box volume).
# A system-path `bbx` (resolvable even in a login shell) — same as
# deploy/setup-server.sh. The target is populated by the engine install below;
# a dangling symlink until then is fine. claude-config/ is Claude's relocated
# state dir (see CLAUDE_CONFIG_DIR below); pre-created and node-owned so the
# named volume mounted there inherits the right ownership.
RUN mkdir -p /app/claude-config /data/box \
  && chown -R node:node /app /data \
  && ln -sf /app/node_modules/beebox/bin/bbx /usr/local/bin/bbx \
  && ln -sf /opt/claude/.local/bin/claude /usr/local/bin/claude

# `codex` on PATH runs beebox's own pinned Codex (src/services/codex-binary.ts
# resolves the same package), for the operator's `codex login --device-auth`.
# pnpm keeps beebox's dependencies beside its real path, not under the
# node_modules/beebox symlink, so resolution starts from the realpath.
COPY beebox/docker/codex-wrapper.sh /usr/local/bin/codex
RUN chmod 0755 /usr/local/bin/codex

# Git settings for every user, in the system config (home is a volume):
# git-lfs filters for legacy boxes, the box's safe.directory, and a default
# identity the entrypoint overrides from BBX_GIT_NAME / BBX_GIT_EMAIL.
RUN git lfs install --system \
  && git config --system --add safe.directory /data/box \
  && git config --system user.name "$BBX_GIT_NAME" \
  && git config --system user.email "$BBX_GIT_EMAIL"

# Box package installs: the same root wrapper and sudoers entry that deploy.sh
# puts on a server, for the runtime user. The entrypoint's `bbx host sync`
# reinstalls recorded packages, since a recreated container starts without them.
COPY beebox/deploy/server-bin/bbx-host-apt /usr/local/sbin/bbx-host-apt
RUN chown root:root /usr/local/sbin/bbx-host-apt && chmod 0755 /usr/local/sbin/bbx-host-apt \
  && echo 'node ALL=(root) NOPASSWD: /usr/local/sbin/bbx-host-apt' > /etc/sudoers.d/beebox-host-apt \
  && chmod 0440 /etc/sudoers.d/beebox-host-apt && visudo -cqf /etc/sudoers.d/beebox-host-apt

# Relocate Claude Code's config + credentials off the user's home to a
# dedicated dir the compose file mounts a named volume onto (so `claude auth
# login` persists across container recreation). Honored by the CLI.
ENV CLAUDE_CONFIG_DIR=/app/claude-config
# Claude writes chat transcripts under CLAUDE_CONFIG_DIR; beebox's transcript
# discovery (src/core/chat/session/transcript-paths.ts) defaults to
# ~/.claude/projects, so point it at the relocated directory.
ENV BBX_CLAUDE_PROJECTS_DIR=/app/claude-config/projects
# The CLI ships with the image; a self-update would land in /opt/claude and
# drift from what the image was tested with.
ENV DISABLE_AUTOUPDATER=1
# Docling's PyTorch: the CPU build. A container has no GPU, and the default
# CUDA build makes the uv cache 5.9 GB instead of 1.4 GB.
ENV UV_TORCH_BACKEND=cpu
# Pin the box's beebox dependency to the baked-in tarball. `bbx init`
# only defaults to `link:<checkout>` for a SOURCE checkout; an installed
# engine (under node_modules, as here) would fall back to a bare `^version`
# range that 404s (src/core/box/package.ts defaultBeeBoxSpec), so the
# box-local `pnpm install` must be told to use the tarball — same as
# src/scripts/smoke-external-box.ts does.
ENV BBX_INIT_BEEBOX_SPEC=file:/app/beebox.tgz

USER node
WORKDIR /app

# The engine tarball, installed into /app and ALSO kept on disk so the
# box-local install can resolve file:/app/beebox.tgz.
COPY --from=build --chown=node:node /beebox.tgz /app/beebox.tgz
COPY --from=build --chown=node:node /docling-version /app/docling-version

# Install the Claude Code CLI (native installer) into /opt/claude, outside the
# home volume; /usr/local/bin/claude points at it. Its login lives in
# CLAUDE_CONFIG_DIR (the claude-auth volume).
RUN HOME=/opt/claude bash -c 'curl -fsSL https://claude.ai/install.sh | bash' \
  && /usr/local/bin/claude --version

# Install the engine into /app from the baked tarball. --allow-build lets
# better-sqlite3 (event-bus storage) and the other native/generated deps run
# their install scripts — pnpm 10 blocks them by default (and, non-interactive,
# a blocked build is a hard error, not a warning). The flag form is the same
# one src/scripts/smoke-external-box.ts uses; a package.json `pnpm` field is no
# longer read by pnpm 10.26.
RUN printf '%s\n' \
      '{' \
      '  "name": "beebox-runtime",' \
      '  "private": true,' \
      '  "type": "module"' \
      '}' > /app/package.json \
  && pnpm add \
       --allow-build=better-sqlite3 \
       --allow-build=esbuild \
       --allow-build=@google/genai \
       --allow-build=protobufjs \
       --allow-build=@googleworkspace/cli \
       /app/beebox.tgz

COPY --chown=node:node beebox/docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENV BBX_CLI_PREBUILT=1
EXPOSE 3210
ENTRYPOINT ["/app/entrypoint.sh"]
