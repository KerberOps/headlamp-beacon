# Headlamp Beacon

> A lighthouse for your Kubernetes cluster — watches versions of Headlamp plugins, core infrastructure, and business apps, and lights up when an update is available.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Headlamp Plugin](https://img.shields.io/badge/headlamp-plugin-blue)](https://headlamp.dev)

## What it does

Beacon adds a **Beacon** section to the Headlamp sidebar with three views:

| View | Description | Tier |
|---|---|---|
| Infrastructure | Core deployment versions vs latest on GitHub/GHCR | Free |
| Headlamp Plugins | Installed plugin versions vs latest published | Free |
| Applications | Custom business app monitoring | Pro |
| Settings | Email pipeline config & test | Pro |

Each row shows the current running version (read from the deployment's container image tag) alongside the latest known version (fetched by the updater CronJob), with a status badge.

## Architecture

```
Headlamp UI (browser)
└─ Beacon plugin (this repo)
     └─ reads ConfigMaps from ops-headlamp namespace

beacon-updater CronJob  (https://github.com/KerberOps/beacon)
└─ queries GitHub / GHCR → writes beacon-*-versions ConfigMaps
```

## Installation

### Via Headlamp Plugin Catalog

Search for **Beacon** in the Headlamp Plugin Catalog and click Install.

### Manual

```bash
headlamp-plugin install @kerberops/headlamp-beacon
```

## Configuration

The plugin reads the following ConfigMaps in the `ops-headlamp` namespace:

| ConfigMap | Purpose |
|---|---|
| `beacon-core-apps` | Infrastructure app definitions |
| `beacon-core-versions` | Infrastructure version cache |
| `beacon-plugins-apps` | Headlamp plugin definitions |
| `beacon-plugins-versions` | Plugin version cache |
| `beacon-license-config` | License level (`free`/`pro`/`enterprise`) and `company-domain` |

See the [beacon-updater](https://github.com/KerberOps/beacon) repo for deployment manifests and ConfigMap schemas.

## Development

```bash
npm install
npm start        # watch mode, loads into local Headlamp
npm run build    # production build → dist/main.js
npm run package  # create release tarball
```

## License

Copyright (C) 2026 KerberOps

This program is free software: you can redistribute it and/or modify it under the terms of the **GNU Affero General Public License** as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

See [LICENSE](./LICENSE) for the full text.
