# shellcheck shell=bash
# Classify how a deploy run ended. Sourced by deploy.sh; tested by
# test/deploy/deploy-outcome.doctest.md.
#
# An interrupt is known from the signal trap, never from the exit code: a child
# process can exit 128 or higher without this script having been signalled.
# `ssh` exits 255 on its own failures (host unreachable, connection dropped),
# which the old `rc >= 128` test read as "signal 127" and reported as a
# deliberate stop — see
# issues/bugs/2026-09-18-deploy-reads-ssh-failure-as-a-signal.md.
#
# deploy_outcome <exit code> <signal name the trap recorded, or "">
# Prints one of: ok, interrupted, unreachable, failed.
deploy_outcome() {
  local rc="$1" signal="$2"
  if [ -n "$signal" ]; then
    echo interrupted
  elif [ "$rc" -eq 0 ]; then
    echo ok
  elif [ "$rc" -eq 255 ]; then
    echo unreachable
  else
    echo failed
  fi
}
