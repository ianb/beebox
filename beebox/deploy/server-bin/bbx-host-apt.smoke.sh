#!/usr/bin/env bash
#
# Smoke test for bbx-host-apt, the root wrapper that installs distro packages
# for a box. Builds a server-like image, then drives the wrapper as the box
# user through sudo and asserts each policy decision.
#
#   deploy/server-bin/bbx-host-apt.smoke.sh [ubuntu|debian]...   (default: both)
#
# ubuntu = ubuntu:24.04 with the setup-server.sh package list (production).
# debian = debian:bookworm-slim with the docker/Dockerfile runtime list.
# Needs Docker and network access; not part of the per-commit suite. Run it
# whenever bbx-host-apt changes.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "the docker daemon is not running" >&2; exit 1; }

build_image() {
  local flavor="$1" base packages ctx
  case "$flavor" in
    ubuntu)
      base=ubuntu:24.04
      # deploy/hetzner/setup-server.sh:33, plus what a real server already has.
      packages="systemd dbus sudo git git-lfs git-annex curl nginx build-essential ca-certificates gnupg poppler-utils pandoc imagemagick python3-openpyxl xlsx2csv qpdf ffmpeg dpkg-dev"
      ;;
    debian)
      base=debian:bookworm-slim
      # docker/Dockerfile runtime stage, including its server-baseline packages.
      packages="sudo systemd dbus procps pandoc imagemagick poppler-utils python3-openpyxl xlsx2csv git git-lfs git-annex curl ca-certificates dpkg-dev"
      ;;
    *) echo "unknown flavor: $flavor" >&2; exit 64 ;;
  esac
  ctx=$(mktemp -d)
  cp "$here/bbx-host-apt" "$ctx/"
  cat > "$ctx/Dockerfile" <<EOF
FROM $base
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends $packages >/dev/null
RUN useradd -m -s /bin/bash beebox \\
  && echo 'beebox ALL=(root) NOPASSWD: /usr/local/sbin/bbx-host-apt' > /etc/sudoers.d/beebox-host-apt \\
  && chmod 0440 /etc/sudoers.d/beebox-host-apt && visudo -cf /etc/sudoers.d/beebox-host-apt
# A third-party source the host's own apt sees and the wrapper must not.
RUN mkdir -p /opt/localrepo/pkg/DEBIAN \\
  && printf 'Package: bbx-smoke-thirdparty\nVersion: 1.0\nArchitecture: all\nMaintainer: smoke <smoke@example.com>\nDescription: smoke\n' > /opt/localrepo/pkg/DEBIAN/control \\
  && dpkg-deb -b /opt/localrepo/pkg /opt/localrepo/bbx-smoke-thirdparty_1.0_all.deb >/dev/null && rm -rf /opt/localrepo/pkg \\
  && cd /opt/localrepo && dpkg-scanpackages . > Packages 2>/dev/null \\
  && echo 'deb [trusted=yes] file:/opt/localrepo ./' > /etc/apt/sources.list.d/smoke-local.list \\
  && apt-get update -qq
# Hold libxml2 at the release version so libxml2-utils (from -updates) needs an upgrade.
# Debian's point releases often carry the same libxml2 as its security suite;
# then no upgrade exists and the case is reported as SKIP.
RUN rel=\$(apt-cache madison libxml2 | awk -F'|' '\$3 !~ /-(updates|security)/ {gsub(/ /,"",\$2); print \$2; exit}') \\
  && cand=\$(apt-cache policy libxml2 | awk '/Candidate:/ {print \$2}') \\
  && if [ "\$rel" = "\$cand" ]; then echo none > /opt/libxml2-release; \\
     else apt-get install -y -qq --allow-downgrades "libxml2=\$rel" >/dev/null && echo "\$rel" > /opt/libxml2-release; fi
COPY bbx-host-apt /usr/local/sbin/bbx-host-apt
RUN chown root:root /usr/local/sbin/bbx-host-apt && chmod 0755 /usr/local/sbin/bbx-host-apt
EOF
  docker build -q -t "bbx-host-apt-smoke:$flavor" "$ctx" >/dev/null
  rm -rf "$ctx"
}

# The cases run inside one container, in order, as root driving the box user.
read -r -d '' CASES <<'EOF' || true
set -uo pipefail
failures=0
as_box() { runuser -u beebox -- sudo -n /usr/local/sbin/bbx-host-apt "$@"; }
installed() { [[ "$(dpkg-query -W -f='${db:Status-Abbrev}' "$1" 2>/dev/null)" == "ii " ]]; }
check() { # check <name> <expected-exit> <stderr-substring> -- command...
  local name="$1" want="$2" needle="$3"; shift 4
  local out code
  out=$("$@" 2>&1); code=$?
  if [[ "$code" == "$want" && "$out" == *"$needle"* ]]; then
    echo "ok   $name"
  else
    echo "FAIL $name: exit $code (want $want), output: $out"
    failures=$((failures + 1))
  fi
}
assert() { # assert <name> command...
  local name="$1"; shift
  if "$@"; then echo "ok   $name"; else echo "FAIL $name"; failures=$((failures + 1)); fi
}

check "glabels installs" 0 "installed glabels" -- as_box install --box smoke -- glabels
check "install output has no apt warnings" 0 "" -- bash -c 'out=$(runuser -u beebox -- sudo -n /usr/local/sbin/bbx-host-apt install --box smoke -- file 2>&1); echo "$out"; ! grep -qE "^(W|E): " <<< "$out"' 
assert "glabels is installed" installed glabels
check "second install is a no-op" 0 "already installed" -- as_box install --box smoke -- glabels
check "daemon package refused" 2 "openssh-server ships" -- as_box install --box smoke -- openssh-server
assert "openssh-server not installed" bash -c '! dpkg-query -W -f="\${db:Status-Abbrev}" openssh-server 2>/dev/null | grep -q "^ii"'
check "setgid package refused" 2 "setuid/setgid" -- as_box install --box smoke -- lockfile-progs
check "regex-like name refused" 2 "not a package" -- as_box install --box smoke -- glabel.
assert "host apt sees the third-party package" bash -c 'apt-cache policy bbx-smoke-thirdparty | grep -q "Candidate: 1.0"'
check "third-party source hidden" 2 "not a package in this host's distro sources" -- as_box install --box smoke -- bbx-smoke-thirdparty
if [[ "$(cat /opt/libxml2-release)" == none ]]; then
  echo "SKIP upgrade refused: this base has no newer libxml2 to upgrade to"
else
  check "upgrade refused" 2 "would upgrade" -- as_box install --box smoke -- libxml2-utils
  assert "libxml2 still at release version" bash -c '[[ "$(dpkg-query -W -f="\${Version}" libxml2)" == "$(cat /opt/libxml2-release)" ]]'
fi
check "apt option refused" 64 "usage" -- as_box install --box smoke -o 'APT::Update::Pre-Invoke::=touch /pwn' -- glabels
check "apt option as package refused" 64 "not a valid package name" -- as_box install --box smoke -- '-oAPT::Update::Pre-Invoke::=touch /pwn'
assert "no Pre-Invoke ran" test ! -e /pwn
check "local .deb refused" 64 "not a valid package name" -- as_box install --box smoke -- ./x.deb
check "bad box slug refused" 64 "usage" -- as_box install --box ../x -- glabels
check "too many packages refused" 64 "at most 10" -- as_box install --box smoke -- a1 a2 a3 a4 a5 a6 a7 a8 a9 b1 b2
check "direct run without sudo refused" 1 "must run as root" -- runuser -u beebox -- /usr/local/sbin/bbx-host-apt install --box smoke -- glabels

# Environment cleaning without sudo's env_reset in the way.
printf 'APT::Update::Pre-Invoke { "touch /pwn-aptconfig"; };\n' > /tmp/evil.conf
printf 'touch /pwn-bashenv\n' > /tmp/evil.sh
check "root run with hostile env" 0 "already installed" -- env APT_CONFIG=/tmp/evil.conf BASH_ENV=/tmp/evil.sh /usr/local/sbin/bbx-host-apt install --box smoke -- glabels
assert "APT_CONFIG ignored" test ! -e /pwn-aptconfig
assert "BASH_ENV ignored" test ! -e /pwn-bashenv

assert "every log line is JSON" python3 -c 'import json,sys; [json.loads(l) for l in open("/var/log/beebox/host-apt.log")]'
assert "log records the install" grep -q '"outcome":"installed"' /var/log/beebox/host-apt.log
assert "log records the refusals" grep -q '"outcome":"refused"' /var/log/beebox/host-apt.log
assert "host sources untouched" test -e /etc/apt/sources.list.d/smoke-local.list

echo "failures: $failures"
exit $(( failures > 0 ))
EOF

flavors=("$@")
[[ ${#flavors[@]} -gt 0 ]] || flavors=(ubuntu debian)
status=0
for flavor in "${flavors[@]}"; do
  echo "== $flavor"
  build_image "$flavor"
  docker run --rm "bbx-host-apt-smoke:$flavor" bash -c "$CASES" || status=1
done
exit "$status"
