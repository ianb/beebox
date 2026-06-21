# Image proxy SSRF guard

`/api/proxy-image` fetches arbitrary image URLs server-side for the frozen-page
hot-link fallback, so it must refuse anything that could reach an internal
address. `isBlockedAddress` classifies resolved IPs; `assertPublicHttpUrl`
gates schemes, local hostnames, and literal IPs (hostname resolution adds a DNS
check on top, not exercised here).

```ts setup
import { isBlockedAddress, assertPublicHttpUrl, UnsafeProxyUrlError } from "../../../src/webapp/routes/proxy-image.js";

async function guard(url) {
  try {
    await assertPublicHttpUrl(url);
    return "ok";
  } catch (e) {
    return e instanceof UnsafeProxyUrlError ? e.reason : "other";
  }
}
```

## Private, loopback, link-local, and mapped addresses are blocked

```ts
[
  isBlockedAddress("127.0.0.1"),
  isBlockedAddress("10.0.0.5"),
  isBlockedAddress("192.168.1.1"),
  isBlockedAddress("172.16.0.1"),
  isBlockedAddress("169.254.169.254"),
  isBlockedAddress("::1"),
  isBlockedAddress("fe80::1"),
  isBlockedAddress("fc00::1"),
  isBlockedAddress("::ffff:127.0.0.1"),
].join(",")
=> true,true,true,true,true,true,true,true,true
```

## Public addresses are allowed

```ts
[
  isBlockedAddress("8.8.8.8"),
  isBlockedAddress("93.184.216.34"),
  isBlockedAddress("172.32.0.1"),
  isBlockedAddress("2606:4700:4700::1111"),
].join(",")
=> false,false,false,false
```

## assertPublicHttpUrl rejects bad schemes, local hosts, literal private IPs, and junk

```ts
await guard("ftp://example.com/a.png")
=> only http(s) URLs are proxied

await guard("http://localhost/a.png")
=> local hostnames are not proxied

await guard("http://127.0.0.1/a.png")
=> resolves to a non-public address

await guard("http://169.254.169.254/latest/meta-data/")
=> resolves to a non-public address

await guard("not a url")
=> malformed URL
```

## A public literal-IP URL passes

```ts
await guard("https://8.8.8.8/logo.png")
=> ok
```
