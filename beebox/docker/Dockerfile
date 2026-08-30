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
# same way scripts/release.ts does (build:cli + frontend build + pnpm pack).
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
  && cp beebox/dist-release/*.tgz /beebox.tgz

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
# Plus git + git-lfs (per-box LFS filters) and curl/ca for the Claude installer.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       pandoc imagemagick poppler-utils python3-openpyxl xlsx2csv git git-lfs curl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  # Debian ships ImageMagick 6 (`convert`); the agent contract and our scripts
  # call `magick` (IM7). Symlink so both names work (same as setup-server.sh).
  && if ! command -v magick >/dev/null 2>&1 && command -v convert >/dev/null 2>&1; then \
       ln -sf "$(command -v convert)" /usr/local/bin/magick; \
     fi

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

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
  && ln -sf /app/node_modules/beebox/bin/bbx /usr/local/bin/bbx

# Relocate Claude Code's config + credentials off the user's home to a
# dedicated dir the compose file mounts a named volume onto (so `claude auth
# login` persists across container recreation). Honored by the CLI.
ENV CLAUDE_CONFIG_DIR=/app/claude-config
# Pin the box's beebox dependency to the baked-in tarball. `bbx init`
# only defaults to `link:<checkout>` for a SOURCE checkout; an installed
# engine (under node_modules, as here) would fall back to a bare `^version`
# range that 404s (src/core/box/package.ts defaultBeeBoxSpec), so the
# box-local `pnpm install` must be told to use the tarball — same as
# scripts/smoke-external-box.ts does.
ENV BBX_INIT_BEEBOX_SPEC=file:/app/beebox.tgz

USER node
WORKDIR /app

# The engine tarball, installed into /app and ALSO kept on disk so the
# box-local install can resolve file:/app/beebox.tgz.
COPY --from=build --chown=node:node /beebox.tgz /app/beebox.tgz

# Install the Claude Code CLI (native installer) under the node user's home so
# the CLI and its `claude auth login` credentials share one home
# (deploy/setup-server.sh:80-84 pattern). Then wire the per-user git identity,
# git-lfs filters, and the box repo's safe.directory.
RUN curl -fsSL https://claude.ai/install.sh | bash \
  && git lfs install \
  && git config --global user.name "$BBX_GIT_NAME" \
  && git config --global user.email "$BBX_GIT_EMAIL" \
  && git config --global --add safe.directory /data/box

# Install the engine into /app from the baked tarball. --allow-build lets
# better-sqlite3 (event-bus storage) and the other native/generated deps run
# their install scripts — pnpm 10 blocks them by default (and, non-interactive,
# a blocked build is a hard error, not a warning). The flag form is the same
# one scripts/smoke-external-box.ts uses; a package.json `pnpm` field is no
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
