# Deployed Codex runtime wiring

Production installs workspace dependencies under `/opt/beebox/node_modules`.
Setup and every deploy refresh `/usr/local/bin/codex` to the direct,
SDK-version-matched dependency, and the deploy gate checks the plugin command
without reading or mutating the service account's real Codex home.

```ts setup
import { readFile } from "node:fs/promises";

const setup = await readFile("deploy/setup-server.sh", "utf8");
const deploy = await readFile("deploy/deploy.sh", "utf8");
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
```

The CLI and SDK versions are one lockstep contract.

```ts
packageJson.dependencies["@openai/codex"] === packageJson.dependencies["@openai/codex-sdk"]
=> true
```

Both provisioning paths refresh the operator command from that dependency.

```ts continue
setup.includes('ln -sf "$INSTALL_DIR/node_modules/.bin/codex" /usr/local/bin/codex')
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
