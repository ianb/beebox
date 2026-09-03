# Deployed Codex runtime wiring

Production installs workspace dependencies under `/opt/beebox/node_modules`.
Setup and every deploy refresh `/usr/local/bin/codex` to the direct,
SDK-version-matched dependency, and the deploy gate checks the plugin command
without reading or mutating the service account's real Codex home.

```ts setup
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { codexBinaryPath } from "../../src/services/codex-binary.js";

const setup = await readFile("deploy/setup-server.sh", "utf8");
const deploy = await readFile("deploy/deploy.sh", "utf8");
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const execFileAsync = promisify(execFile);
```

The CLI and SDK versions are one lockstep contract.

```ts
packageJson.dependencies["@openai/codex"] === packageJson.dependencies["@openai/codex-sdk"]
=> true
```

The resolver reaches an executable whose reported version is the package pin.
The doctest harness already supplies an isolated `CODEX_HOME`, so this cannot
read or mutate the developer's plugin or authentication state.

```ts continue
const result = await execFileAsync(codexBinaryPath(), ["--version"]);
result.stdout.trim() === `codex-cli ${packageJson.dependencies["@openai/codex"]}`
=> true
```

Both provisioning paths refresh the operator command from that dependency.

```ts continue
setup.includes('ln -sf "$INSTALL_DIR/beebox/node_modules/.bin/codex" /usr/local/bin/codex')
=> true

deploy.includes('ln -sf /opt/beebox/node_modules/.bin/codex /usr/local/bin/codex')
=> true
```

The deployment gate uses a scratch home and checks plugin-command
compatibility. It does not run `plugin list` against repairable global state.

```ts continue
deploy.includes('CODEX_HOME="$codex_check_home" codex plugin --help')
=> true

deploy.includes('CODEX_HOME="$codex_check_home" codex plugin list')
=> false
```
