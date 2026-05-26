# Beacon v2.1.0

A version-monitoring plugin for Headlamp. Beacon watches your Kubernetes cluster and shows which deployments, Headlamp plugins, and business apps are running outdated versions.

## Features (Free tier)

- **Infrastructure** — monitor core deployment versions against GitHub releases or GHCR tags
- **Headlamp Plugins** — track installed plugin versions vs latest published
- Sortable, filterable table with namespace and status filters
- Status badges: Up to Date / Update Available / Error / Unknown
- Daily version fetch via the `beacon-updater` CronJob

## Features (Pro / Enterprise)

- **Applications** — custom business app monitoring
- **Send Report** — trigger on-demand PDF reports emailed to your team
- **Settings** — email pipeline configuration and test delivery

## Requirements

- Headlamp >= 0.22
- `beacon-updater` CronJob deployed in your cluster
- All resources must live in the `ops-headlamp` namespace

> **No manual ConfigMap editing required.** The Settings page in Headlamp automatically scans your cluster, lets you select what to monitor, and writes the ConfigMaps for you.

## Installation

Install via the Headlamp Plugin Catalog (search for "Beacon") or manually:

```bash
headlamp-plugin install @kerberops/headlamp-beacon
```

For full deployment instructions (RBAC, CronJob, Helm values) see the [README](https://github.com/KerberOps/headlamp-beacon#installation-free-tier).

## License

AGPL-3.0-only — see [LICENSE](https://github.com/KerberOps/headlamp-beacon/blob/main/LICENSE)
