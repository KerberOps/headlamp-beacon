# Headlamp Beacon

> A lighthouse for your Kubernetes cluster — watches versions of Headlamp plugins and core infrastructure, and lights up when an update is available.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Headlamp Plugin](https://img.shields.io/badge/headlamp-plugin-blue)](https://headlamp.dev)

---

## What it does

Beacon adds a **Beacon** section to the Headlamp sidebar with views for each monitoring category:

| View | Description | Tier |
|---|---|---|
| Infrastructure | Core deployment versions vs latest on GitHub/GHCR | Free |
| Headlamp Plugins | Installed plugin versions vs latest published | Free |
| Applications | Custom business app monitoring | Pro |
| Settings | Email pipeline config & test | Pro |

Each row shows the running container image tag alongside the latest known version, with a status badge: **Up to Date** / **Update Available** / **Error** / **Unknown**.

---

## Architecture

```
Headlamp UI (browser)
└─ Beacon plugin (this repo — reads ConfigMaps)
        │
        ▼  ops-headlamp namespace
   beacon-*-apps ConfigMaps       ← you define what to monitor
   beacon-*-versions ConfigMaps   ← updater writes version cache here

beacon-updater CronJob (this repo — updater/)
└─ queries GitHub releases / GHCR tags
└─ writes results to beacon-*-versions ConfigMaps daily
```

> **Important:** All resources live in the `ops-headlamp` namespace. This is hardcoded in the plugin and cannot be changed without rebuilding from source.

---

## Installation (Free Tier)

### Prerequisites

- A running Kubernetes cluster
- Headlamp deployed in your cluster (any namespace is fine)
- `kubectl` configured with access to the cluster

---

### Step 1 — Create the namespace

All Beacon resources live in `ops-headlamp`.

```bash
kubectl apply -f deploy/00-namespace.yaml
```

---

### Step 2 — Deploy RBAC

Creates a `ServiceAccount`, `Role`, and `RoleBinding` for the updater CronJob so it can read app definitions and write version caches.

```bash
kubectl apply -f deploy/01-rbac.yaml
```

---

### Step 3 — Configure what to monitor

Two ConfigMaps define which deployments Beacon watches:

| File | ConfigMap | Purpose |
|---|---|---|
| `deploy/02-plugins-configmap.yaml` | `beacon-plugins-apps` | Headlamp itself + installed plugins |
| `deploy/03-core-configmap.yaml` | `beacon-core-apps` | Infrastructure deployments |

Edit the `apps.json` entries to match your cluster's actual deployment names and namespaces, then apply:

```bash
kubectl apply -f deploy/02-plugins-configmap.yaml
kubectl apply -f deploy/03-core-configmap.yaml
```

#### ConfigMap entry schema

```jsonc
{
  "name": "Display name in the UI",
  "currentVersion": {
    "namespace": "the-namespace",       // Kubernetes namespace of the deployment
    "deployment": "my-deployment",      // Deployment name
    "container": "my-container",        // Container name (optional, defaults to first)
    "initContainer": "my-init",         // Use instead of container for init containers
    "vPrefix": true                     // Force "v" prefix on current version (for images that omit it)
  },
  "latestVersion": {
    "type": "github-release",           // github-release | github-tag | ghcr-tag | manual
    "repo": "owner/repo",               // GitHub repo (for github-release and github-tag)
    "image": "owner/image",             // GHCR image path (for ghcr-tag)
    "tagPrefix": "v",                   // Filter tags by this prefix
    "stripPrefix": false,               // Whether to remove the prefix in the display
    "releaseUrl": "https://...",        // URL opened when clicking the status badge
    "value": "1.2.3"                    // Fixed version string (for type: manual)
  }
}
```

---

### Step 4 — Build and push the updater image

The updater is a Python script that fetches the latest versions and writes them to the ConfigMaps. Build it from source and push to any registry accessible from your cluster:

```bash
cd updater/
docker build --no-cache -t ghcr.io/<your-org>/beacon-updater:2.0.8 .
docker push ghcr.io/<your-org>/beacon-updater:2.0.8
```

Then update the `image` field in `deploy/04-updater-cronjob.yaml` to point to your image.

> **GitHub rate limits:** Unauthenticated requests to the GitHub API are limited to 60/hour per IP. If you monitor many apps, create a GitHub PAT and uncomment the `GITHUB_TOKEN` env block in the CronJob manifest.

---

### Step 5 — Deploy the updater CronJob

```bash
kubectl apply -f deploy/04-updater-cronjob.yaml
```

The CronJob runs daily at 09:00 UTC by default. Change the `schedule` field to your preferred time.

---

### Step 6 — Run the updater immediately

Don't wait until tomorrow — trigger a first run now:

```bash
kubectl create job beacon-updater-init \
  --from=cronjob/beacon-updater \
  -n ops-headlamp
```

Watch it complete:

```bash
kubectl logs -f -l app.kubernetes.io/component=updater -n ops-headlamp
```

---

### Step 7 — Install the Beacon plugin

Install via the Headlamp Plugin Catalog (search for **Beacon**), or manually:

```bash
headlamp-plugin install @kerberops/headlamp-beacon
```

Once installed, a **Beacon** entry appears in the Headlamp sidebar. The Infrastructure and Headlamp Plugins views will populate once the updater has run at least once.

---

## Upgrading

1. Update the `image` tag in `deploy/04-updater-cronjob.yaml` and re-apply.
2. Update the plugin version in Headlamp via the Plugin Catalog.
3. Re-apply any ConfigMap changes if the schema changed (check the [CHANGELOG](./CHANGELOG.md)).

---

## Development

```bash
npm install
npm start        # watch mode — loads into local Headlamp instance
npm run build    # production build → dist/main.js
npm run package  # create release tarball
```

---

## Pro / Enterprise

The **Applications** page and **Send Report** (on-demand PDF email reports) are Pro features. Contact [KerberOps](mailto:kerberops@outlook.com) for licensing.

---

## License

Copyright (C) 2026 KerberOps

Licensed under the **GNU Affero General Public License v3.0** — see [LICENSE](./LICENSE).  
Any modified version run over a network must make its source code available under the same license.
