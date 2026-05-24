<p align="center">
  <img src="./logo.svg" width="200" height="200" alt="Beacon Logo" />
</p>

# Headlamp Beacon

> A lighthouse for your Kubernetes cluster — watches versions of Headlamp plugins and core infrastructure, and lights up when an update is available.

<p align="center">
  <a href="https://www.gnu.org/licenses/agpl-3.0"><img src="https://img.shields.io/badge/License-AGPL_v3-blue.svg" alt="License: AGPL v3"/></a>
  <a href="https://headlamp.dev"><img src="https://img.shields.io/badge/headlamp-plugin-blue" alt="Headlamp Plugin"/></a>
</p>

---

## Why Beacon?

Modern Kubernetes clusters are rarely simple. A typical production environment runs Headlamp itself, a handful of plugins, an ingress controller, a certificate manager, sealed secrets, monitoring stacks, and a growing number of business application deployments — each with its own release cycle.

**Keeping all of those versions aligned and up to date is not optional.** Outdated components are one of the most common sources of security vulnerabilities and subtle bugs. A version mismatch between a plugin and Headlamp core can break the UI. An unpatched ingress controller can expose your cluster to known CVEs. A stale business app running a dependency with a known exploit may never show up in a security scan if nobody is tracking it.

Most teams handle this reactively — they find out something is outdated when something breaks, or when a security advisory lands in their inbox. Beacon flips that dynamic:

- **Visibility at a glance.** Every monitored component shows its running version alongside the latest available, with a clear status badge. No manual lookups, no spreadsheets.
- **Embedded in your existing workflow.** Because Beacon lives inside Headlamp, the same tool your team already uses to manage the cluster, version awareness becomes part of the daily routine — not a separate dashboard nobody remembers to check.
- **Zero external dependencies for the plugin.** The UI reads directly from ConfigMaps in the cluster. No external SaaS, no outbound connections from the browser, no data leaves your network.
- **Actionable links.** Every outdated badge links directly to the GitHub release notes so whoever sees it can act on it immediately.
- **Lightweight by design.** The updater runs once a day as a CronJob, finishes in seconds, and exits. There is nothing running continuously.

---

## What it does

Beacon adds a **Beacon** section to the Headlamp sidebar with views for each monitoring category:

| View | Description | Tier |
|---|---|---|
| Infrastructure | Core deployment versions vs latest on GitHub / GHCR | Free |
| Headlamp Plugins | Installed plugin versions vs latest published | Free |
| Applications | Custom business app monitoring | Pro |
| Settings | Email pipeline config & test | Pro |

Each row shows the running container image tag alongside the latest known version, with a status badge: **Up to Date** / **Update Available** / **Error** / **Unknown**.

---

## Resource requirements

Beacon is intentionally minimal. Here is what it costs to run:

| Component | CPU request | CPU limit | Memory request | Memory limit | Disk |
|---|---|---|---|---|---|
| Beacon plugin | — | — | — | — | 25 KB (JS loaded in browser) |
| beacon-updater CronJob | 50m | 200m | 64 Mi | 128 Mi | none (read-only rootfs) |
| ConfigMaps (×4) | — | — | — | — | ~10–50 KB each |

The plugin itself consumes **no cluster resources** — it is a 25 KB JavaScript file loaded in the browser that reads ConfigMaps via the existing Headlamp API proxy.

The updater CronJob runs once per day, typically completes in under 30 seconds, and then exits. It has no persistent storage and no idle CPU or memory cost between runs.

### Check your cluster's current utilisation

Before deploying, you can inspect available headroom on your nodes:

```bash
# Node-level CPU and memory usage (requires metrics-server)
kubectl top nodes

# Detailed allocated resources per node
kubectl describe nodes | grep -A 8 "Allocated resources"

# Available (allocatable) capacity across all nodes
kubectl get nodes -o custom-columns=\
"NODE:.metadata.name,\
CPU-ALLOCATABLE:.status.allocatable.cpu,\
MEM-ALLOCATABLE:.status.allocatable.memory"

# What is already running in ops-headlamp (if the namespace exists)
kubectl top pods -n ops-headlamp
```

> If `kubectl top` returns `error: Metrics API not available`, your cluster is missing `metrics-server`. Install it with:
> ```bash
> kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
> ```

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

> **GitHub rate limits:** Unauthenticated requests to the GitHub API are limited to 60 req/hour per IP. If you monitor many apps, create a GitHub PAT and uncomment the `GITHUB_TOKEN` env block in the CronJob manifest.

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

## Troubleshooting

### Plugin Catalog not working on Kubernetes

The Headlamp Plugin Catalog installs plugins into an `emptyDir` volume at runtime. In in-cluster Kubernetes deployments (especially with OIDC or a custom CA), this volume is lost on every pod restart and the installed plugins disappear.

**Solution:** use the **initContainer pattern** — each plugin is copied into the shared plugin volume before the main Headlamp container starts, so it survives restarts without relying on the catalog.

A ready-to-use Helm values file is provided at [`deploy/headlamp-values.yaml`](./deploy/headlamp-values.yaml). Deploy it with:

```bash
helm upgrade --install headlamp headlamp/headlamp \
  --namespace ops-headlamp \
  --create-namespace \
  -f deploy/headlamp-values.yaml
```

Adjust the `image` field in the `beacon-plugin` initContainer to point to your built image, and remove the `flux-plugin` / `kubescape-plugin` blocks if you don't use those plugins.

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
