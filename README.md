# setup-fakes3

[![test](https://github.com/AkaraChen/setup-fakes3/actions/workflows/test.yml/badge.svg)](https://github.com/AkaraChen/setup-fakes3/actions/workflows/test.yml)

A GitHub Action that installs [fakes3](https://github.com/AkaraChen/fakes3), an in-memory S3 server
for tests, and starts it in the background. The server is ready in milliseconds, the `fakes3` command
(including `fakes3 ctl`) is on `PATH` for later steps, and the server's log is printed at the end of
the job.

```yaml
steps:
  - uses: actions/checkout@v7
  - uses: AkaraChen/setup-fakes3@v1
    id: s3
  - run: pytest
    env:
      S3_ENDPOINT: ${{ steps.s3.outputs.endpoint }}   # http://127.0.0.1:9000
```

Point any S3 client at the endpoint with path-style addressing. Any credentials work unless you set
`auth: true`.

## Examples

### AWS CLI and SDKs, through environment variables

With `aws-env: true`, the action exports `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY`, which the AWS CLI and current AWS SDKs read without any code changes:

```yaml
- uses: AkaraChen/setup-fakes3@v1
  with:
    aws-env: true
- run: |
    aws s3 mb s3://demo
    aws s3 cp README.md s3://demo/
```

This replaces any real AWS credentials for the rest of the job, so leave it off in jobs that also
deploy to AWS, and pass the endpoint to your tests explicitly instead.

### Reset state, move the clock, inspect requests

The action exports `FAKES3_ENDPOINT`, which `fakes3 ctl` uses, so later steps can drive the
[control plane](https://github.com/AkaraChen/fakes3/blob/main/docs/control-plane.md) directly:

```yaml
- uses: AkaraChen/setup-fakes3@v1
- run: ./seed-fixtures.sh && fakes3 ctl snapshot create seeded
- run: npm test
- if: failure()
  run: fakes3 ctl requests list --status error
```

### Match AWS's current defaults and verify signatures

```yaml
- uses: AkaraChen/setup-fakes3@v1
  with:
    auth: true
    access-key: AKIATEST
    secret-key: test-secret
    bucket-defaults: aws    # ACLs disabled, Block Public Access on, SSE-S3
```

### Several servers, random ports

```yaml
- uses: AkaraChen/setup-fakes3@v1
  id: primary
  with:
    port: 0
- uses: AkaraChen/setup-fakes3@v1
  id: replica
  with:
    port: 0
- run: go test ./...
  env:
    PRIMARY_S3: ${{ steps.primary.outputs.endpoint }}
    REPLICA_S3: ${{ steps.replica.outputs.endpoint }}
```

`FAKES3_ENDPOINT` points at the server that started last.

### Install only

When your test harness starts its own servers, for example one per test with `fakes3 --port 0`, skip
the background server:

```yaml
- uses: AkaraChen/setup-fakes3@v1
  with:
    start: false
- run: pytest   # a fixture runs `fakes3 --port 0` per test and reads the address it prints
```

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `version` | `latest` | fakes3 version, such as `0.1.0` or `v0.1.0`, or `latest` |
| `start` | `true` | Start the server in the background. With `false`, only put `fakes3` on `PATH` |
| `host` | `127.0.0.1` | Address to listen on. Use `0.0.0.0` if tests in another container need to reach it |
| `port` | `9000` | Port to listen on; `0` picks a free one |
| `access-key` | `fakes3` | Access key of the default account |
| `secret-key` | `fakes3secret` | Secret key of the default account |
| `auth` | `false` | Verify request signatures. Without it any credentials are accepted |
| `users` | | More accounts, one per line, as `name:access-key:secret[:account-id[:canonical-id]]` |
| `bucket-defaults` | server default (`legacy`) | Settings new buckets start with: `legacy` or `aws` |
| `memory-limit` | server default (`auto`) | Cap on object data: `512MiB`, `2GiB`, `unlimited` or `auto` |
| `args` | | More [server options](https://github.com/AkaraChen/fakes3#configuration), separated by whitespace |
| `aws-env` | `false` | Also export `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_REGION` and `AWS_DEFAULT_REGION` (`us-east-1`) if they are unset |
| `wait-timeout` | `10` | Seconds to wait for the server to start listening |

The server options are described in the
[fakes3 README](https://github.com/AkaraChen/fakes3#configuration).

## Outputs

| Output | Description |
| --- | --- |
| `version` | The fakes3 version that was installed, such as `0.1.0` |
| `path` | Path of the `fakes3` binary |
| `endpoint` | URL to point S3 clients at, such as `http://127.0.0.1:9000` |
| `port` | Port the server listens on |
| `access-key` | Access key of the default account |
| `secret-key` | Secret key of the default account |
| `pid` | Process id of the server |
| `log-file` | File the server's output goes to |

Only `version` and `path` are set when `start` is `false`.

## Platforms

fakes3 runs on **Linux x64 and arm64** runners, GitHub-hosted or self-hosted, including container
jobs on any distribution (the binary is static). It doesn't run on macOS or Windows, because large objects
are stored in Linux `memfd`s; the action fails with an error there.

## Without this action

On Linux runners, the Docker image also works as a service container:

```yaml
jobs:
  test:
    runs-on: ubuntu-24.04
    services:
      s3:
        image: ghcr.io/akarachen/fakes3:0.1.0
        ports: ["9000:9000"]
    steps:
      - run: pytest   # http://127.0.0.1:9000
```

The action needs no Docker, skips the image pull, works in container jobs, puts `fakes3 ctl` on `PATH`,
picks free ports, and prints the server log at the end of the job.

## How it works

1. Resolves `latest` by following the redirect of
   `https://github.com/AkaraChen/fakes3/releases/latest`, which needs no token.
2. Downloads the static binary for the runner's architecture from the fakes3 GitHub release, checks it
   against the release's SHA-256 checksum, and keeps it in the runner's tool cache.
3. Starts `fakes3` as a background process with its output in `$RUNNER_TEMP`, and waits until it
   prints the address it listens on. If the server exits first (for example because the port is taken),
   the step fails with the server's output.
4. At the end of the job, a post step stops the server and prints its log in a collapsed group, or
   warns if the server had already exited.

## Development

```bash
npm ci
npm run check   # type-check
npm run build   # bundle src/ into dist/, which is committed
```

CI fails if `dist/` doesn't match the source. The [test workflow](.github/workflows/test.yml) runs the
action from the checkout on x64 and arm64 runners, in Debian and Alpine containers, and checks that it
fails clearly on macOS, on a taken port and on an unknown version.

To release, tag the commit and move the major tag:

```bash
git tag v1.0.0 && git tag -f v1 && git push origin v1.0.0 && git push -f origin v1
```

## License

[MIT](LICENSE)
