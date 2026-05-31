# Changelog

All notable changes to Beacon are documented here.
Versions follow [Semantic Versioning](https://semver.org/).

---

## [2.1.0] — 2026-05-28

### Added
- **Settings → Security tab** — image CVE scan results powered by [Trivy](https://github.com/aquasecurity/trivy); shows severity breakdown per Beacon component image (Pro: full CVE table with package-level details)
- **Settings → Schedule tab** — configure the version-fetch cron expression and timezone directly from the Headlamp UI without editing manifests
- **beacon-scanner CronJob** (`deploy/05-scanner.yaml`) — daily Trivy scan of all Beacon component images, results stored in `beacon-security-scan` ConfigMap (Pro)
- **`dockerhub-tag` source type** — fetch latest tag from Docker Hub, with optional `tagSuffix` filter (e.g. `"-alpine"`)
- `ATTRIBUTION.md` — full list of third-party dependencies, their licenses, and the features they power
- `CLA.md` — Contributor License Agreement for dual-license model
- `CONTRIBUTING.md` — contribution guide

### Changed
- Settings → Infrastructure and Headlamp Plugins tabs now auto-scan the cluster and write ConfigMaps without any YAML editing
- `beacon-updater` bumped to **2.1.1** — base image switched to `python:3.12-alpine` for smaller attack surface; pip removed from final image
- Plugin bundle size increased from ~55 KB to ~67 KB (Security and Schedule tabs)

---

## [2.0.8] — 2026-05-20

### Fixed
- Reporter crash on versions cache format mismatch
- Reporter license check failing on bare string value
- Send Report dialog missing `Content-Type: application/json` header
- ACS From Name non-ASCII encoding artefact
- Settings Test Email accepted any domain instead of enforcing company domain

---

## [2.0.4] — 2026-05-19

### Added
- `versions.yaml` — single source of truth for all image versions
- `release.sh` — one-command version bump across all files

### Changed
- Email delivery switched from SMTP to Azure Communication Services (ACS)
- `beacon-reporter` auto-detects ACS vs SMTP based on environment

---

## [2.0.3] — 2026-05-18

### Added
- Pro features: PDF report generation and email delivery via beacon-reporter CronJob
- Settings page with email pipeline configuration and test delivery
- Applications page (Pro) with custom business app monitoring

### Changed
- Section names: Apps → Applications, K8s → Infrastructure
- Applications and Settings pages show Pro lock in free tier

---

## [2.0.0] — 2026-05-15

### Added
- Pro license gating via `beacon-license-config` ConfigMap
- `beacon-updater` CronJob for automated daily version fetching
- `beacon-reporter` CronJob for PDF report generation and email delivery (Pro)
- Four sidebar sections: Applications (Pro), Infrastructure, Headlamp Plugins, Settings
- RBAC scoped to `ops-headlamp` namespace

---

## [1.0.0] — 2026-05-10

### Initial Release
- Headlamp plugin UI (React/TypeScript)
- Version comparison via ConfigMaps
- Free tier: Infrastructure and Headlamp Plugins monitoring
