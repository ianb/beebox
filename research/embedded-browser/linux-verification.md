# F0: the box browser on Linux under the box sandbox (2026-10-30)

Chunk F0 of [the shared-browser plan](../../beebox/docs/plans/shared-browser.md). A throwaway Hetzner cpx21 (Ubuntu 24.04, kernel 6.8.0-138, `passt` 0.0~git20240220), created with the boxholder's yes and deleted after the run. Two box-like users, `bbx-a` and `bbx-b`, each with a home under `/var/lib/beebox/<slug>`. Every command ran through `systemd-run --uid=bbx-<slug>` with the options of `deploy/systemd/box-sandbox.conf` (`ProtectSystem=strict`, `ProtectHome=yes`, `TemporaryFileSystem=/var/lib/beebox:ro`, `BindPaths` of the box home, `PrivateTmp=yes`, `NoNewPrivileges=yes`, `MemoryHigh=1G`, `MemoryMax=2G`). agent-browser 0.39.2 with Chrome for Testing 156, installed by `agent-browser install --with-deps` under `/opt/beebox-browser`.

## Results

| Check | Result |
|---|---|
| (1) A box user creates a private network namespace | Fails as planned (`pasta ... -- cmd`): Ubuntu's `kernel.apparmor_restrict_unprivileged_userns=1` moves `/usr/bin/pasta.avx2` into the restricted `unprivileged_userns` profile; the packaged `passt` profile covers only `/usr/bin/passt{,.avx2}`. Passes with the launcher below and the AppArmor profiles below. |
| (2) Chrome's own sandbox inside the namespace | Fails with pasta spawning the command: pasta maps the user to root in its namespace, and agent-browser adds `--no-sandbox` when `geteuid() == 0` (`cli/src/native/cdp/chrome.rs:1613`). Passes with the launcher below: `chrome://sandbox` reports "You are adequately sandboxed" (namespace layer 1, PID and network namespaces, seccomp-BPF with TSYNC). |
| (3) Host loopback and the host's public address are unreachable from inside; outbound HTTPS works | Passes with all pasta port forwarding off. With pasta's defaults (`-T auto`, `-U auto`) a control listener on host `127.0.0.1:9001` answered from inside: pasta forwards namespace-loopback ports to host-loopback listeners. With `-t none -u none -T none -U none --no-map-gw`: host loopback 000, host public address 000, `https://example.com` 200, three runs out of three. |
| (4) Another box user cannot reach this box's dashboard, stream or Chrome debugging port | Passes. A control listener of `bbx-a` on host `127.0.0.1:9003` answered `bbx-b` (and root). `bbx-a`'s dashboard (4848), stream (40347) and Chrome debugging port (34517) inside its namespace answered neither `bbx-b` nor root; none of them listens in the host's network namespace (`ss -ltnp`). |
| (5) Memory of the box cgroup | Browser stack only (launcher, pasta, dashboard, daemon, Chrome): 373 MB with one tab (Wikipedia), 688 MB with three (Wikipedia, BBC News, GitHub), peak 745 MB. Largest single process 361 MB (a renderer). |

## The launcher that works

pasta cannot both own the namespaces and leave the command as an ordinary user. It drops its child to `CAP_NET_BIND_SERVICE`, `CAP_NET_ADMIN` and `CAP_SYS_ADMIN` as uid 0, and since Linux 5.12 mapping the parent's uid 0 into a nested user namespace needs `CAP_SETFCAP`, so the child cannot get back to the box uid. The working order is the reverse:

1. `unshare --user --map-user=<uid> --map-group=<gid> --net --mount --keep-caps` creates the namespaces with the box user's own uid mapped to itself. The child waits on a FIFO.
2. pasta, still outside and still the box user, attaches to the child's network namespace by PID: `pasta --config-net --no-map-gw -t none -u none -T none -U none --quiet <pid>`. As the owner of the child's user namespace it has the capabilities it needs there.
3. The child is released. It bind-mounts `/run/systemd/resolve/resolv.conf` over `/etc/resolv.conf` (the host's file points at the systemd-resolved stub on `127.0.0.53`, which inside the namespace is the namespace's own empty loopback), waits until no address is tentative (IPv6 duplicate-address detection; without the wait the first requests fail and Chrome reports `ERR_NETWORK_CHANGED`), then `setpriv --inh-caps=-all --ambient-caps=-all --bounding-set=-all` and execs the command. The command runs as the box uid with no capabilities and `NoNewPrivs` set.

AppArmor grants, one profile file (`/etc/apparmor.d/beebox-browser`):

```
profile beebox-browser-unshare /opt/beebox-browser/bin/unshare flags=(unconfined) { userns, }
profile beebox-browser-chrome /opt/beebox-browser/.agent-browser/browsers/*/chrome flags=(unconfined) { userns, }
```

`/opt/beebox-browser/bin/unshare` is a copy of `/usr/bin/unshare`, mode 0750, group `beebox-boxes`, so only box users can run the binary that gets the exemption. The Chrome profile follows the pattern Ubuntu ships for `/opt/google/chrome/chrome`. pasta needs no profile in this order: it joins a namespace and creates none. Not separately tested: whether Chrome's sandbox works without its own profile once it is already inside the launcher's user namespace.

## Findings for the plan

- **Track F's command changes.** The plan said `pasta --config-net --no-map-gw -- bbx engine browser-host`. It becomes the three-step launcher above, with pasta's port forwarding off.
- **Cloud metadata is reachable from inside the namespace**: `http://169.254.169.254/hetzner/v1/metadata/hostname` answered 200, as it does for every box process today. pasta forwards any outbound address. The browser lets a web page aim requests there (through the agent or by redirect). Belongs to the private egress issue; a cheap layer for the browser alone is a Chrome policy blocking that address.
- **Memory.** 688 MB for three tabs fits under `MemoryHigh=1G` alone, but the engine (144-223 MB per `docs/implemented-plans/per-box-units.md:200`) and the agent's subprocess share the cgroup. A browsing agent turn with three tabs could cross `MemoryHigh` (throttling) and, with a Docling run, approach `MemoryMax`. Not measured with the engine and an agent turn running.
- **pasta's defaults are unsafe for this use.** `-T auto` would have exposed every host-loopback service to the browser. The launcher must pass `-t none -u none -T none -U none` explicitly, and a test should pin those flags.
