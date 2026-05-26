# Beacon v2.1.0

A version-monitoring plugin for Headlamp. Beacon watches your Kubernetes cluster and shows which deployments, Headlamp plugins, and business apps are running outdated versions.

## Features (Free tier)

- **Infrastructure** — monitor core deployment versions against GitHub releases or GHCR tags
- **Headlamp Plugins** — track installed plugin versions vs latest published
- Sortable, filterable table with namespace and status filters
- Status badges: Up to Date / Update Available / Error / Unknown
- Reads version data from ConfigMaps populated by the [beacon-updater](https://github.com/KerberOps/headlamp-beacon) CronJob

## Features (Pro / Enterprise)

- **Applications** — custom business app monitoring
- **Send Report** — trigger on-demand PDF reports emailed to your team
- **Settings** — SMTP test and email pipeline validation

## Requirements

- Headlamp >= 0.22
- `beacon-updater` CronJob deployed in your cluster (populates the version cache ConfigMaps)
- ConfigMaps in namespace `ops-headlamp`:
  - `beacon-core-apps` / `beacon-core-versions`
  - `beacon-plugins-apps` / `beacon-plugins-versions`
  - `beacon-license-config` (optional — defaults to free tier)

## Installation

Install via the Headlamp Plugin Catalog (search for "Beacon") or manually:

```bash
headlamp-plugin install @kerberops/headlamp-beacon
```

## License

AGPL-3.0-only — see [LICENSE](https://github.com/KerberOps/headlamp-beacon/blob/main/LICENSE)
