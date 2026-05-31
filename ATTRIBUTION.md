# Third-Party Software Attribution

Beacon is built on top of several open-source components. This document lists every
third-party dependency, its license, and the Beacon feature it powers.

All open-source licenses referenced here are compatible with commercial distribution.

---

## Summary Table

| Component | Version | License | Used In |
|-----------|---------|---------|---------|
| [Headlamp](#headlamp) | ≥ 0.14 | Apache 2.0 | Plugin platform (all tiers) |
| [Headlamp Plugin SDK](#headlamp-plugin-sdk) | 0.14.0 | MIT | Plugin build toolchain |
| [Trivy](#trivy) | latest | Apache 2.0 | Security tab — image vulnerability scanning |
| [Kubernetes Python Client](#kubernetes-python-client) | 29.0.0 | Apache 2.0 | Updater · Reporter — cluster API access |
| [ReportLab](#reportlab) | 4.0.9 | BSD 3-Clause | Reporter — PDF generation (Pro) |
| [Azure Communication Services Email SDK](#azure-communication-services-email-sdk) | 1.0.0 | MIT | Reporter — email delivery (Pro) |
| [Matplotlib](#matplotlib) | 3.8.4 | Matplotlib (BSD-compatible) | Reporter — chart rendering in PDFs (Pro) |
| [Pillow](#pillow) | 12.2.0 | MIT-CMU | Reporter — image processing in PDFs (Pro) |
| [Sealed Secrets](#sealed-secrets) | ≥ 0.17 | Apache 2.0 | Deployment — encrypted secret management |
| [Alpine Linux](#alpine-linux) | 3.x | MIT + BSD + GPL-2 | Base image for all Beacon containers |

---

## Component Details

### Headlamp

- **Author:** Kinvolk / CNCF
- **License:** Apache License 2.0
- **Source:** https://github.com/headlamp-k8s/headlamp
- **Used in:** All tiers — Beacon is a Headlamp plugin and runs entirely inside the
  Headlamp UI. Headlamp provides the sidebar navigation, routing, Kubernetes API proxy,
  and React rendering environment.

---

### Headlamp Plugin SDK

- **Package:** `@kinvolk/headlamp-plugin`
- **License:** MIT
- **Source:** https://github.com/headlamp-k8s/headlamp
- **Used in:** `beacon-plugin` (Free + Pro) — provides `registerRoute`,
  `registerSidebarEntry`, `K8s`, and `ApiProxy` used throughout the plugin source.

---

### Trivy

- **Author:** Aqua Security
- **License:** Apache License 2.0
- **Source:** https://github.com/aquasecurity/trivy
- **Container image:** `aquasec/trivy:latest` (Docker Hub)
- **Used in:** `beacon-scanner` CronJob — runs as a separate job in the customer's
  cluster to scan Beacon container images for OS and package vulnerabilities. Results
  are written to the `beacon-security-scan` ConfigMap and displayed in the
  **Settings → Security** tab.
- **Attribution in UI:** "Powered by Trivy X.X.X" is shown in the Security tab header.

---

### Kubernetes Python Client

- **Package:** `kubernetes==29.0.0`
- **License:** Apache License 2.0
- **Source:** https://github.com/kubernetes-client/python
- **Used in:**
  - `beacon-updater` — reads Kubernetes Deployments and CronJobs; writes version
    cache to ConfigMaps.
  - `beacon-reporter` — reads ConfigMaps to build the PDF report content; writes
    job annotations.

---

### ReportLab

- **Package:** `reportlab==4.0.9`
- **License:** BSD 3-Clause License
- **Source:** https://www.reportlab.com / https://pypi.org/project/reportlab/
- **Note:** This refers to the **open-source ReportLab Toolkit** distributed via PyPI,
  not the commercial ReportLab PLUS edition. The BSD 3-Clause license permits
  commercial use with attribution.
- **Used in:** `beacon-reporter` (Pro) — generates the daily PDF report that is
  emailed to configured recipients. Handles layout, typography, tables, and
  section rendering.

---

### Azure Communication Services Email SDK

- **Package:** `azure-communication-email==1.0.0`
- **License:** MIT License
- **Source:** https://github.com/Azure/azure-sdk-for-python/tree/main/sdk/communication/azure-communication-email
- **Used in:** `beacon-reporter` (Pro — AET / Azure customers) — sends the generated
  PDF report via Azure Communication Services instead of direct SMTP. Authenticates
  using an ACS connection string stored in a Sealed Secret.

---

### Matplotlib

- **Package:** `matplotlib==3.8.4`
- **License:** Matplotlib License (BSD-compatible, PSF-derived)
- **Source:** https://github.com/matplotlib/matplotlib
- **Used in:** `beacon-reporter` (Pro) — reserved for chart generation in PDF
  reports (version trend charts, status distribution). Included in requirements for
  future report sections.

---

### Pillow

- **Package:** `Pillow==12.2.0`
- **License:** MIT-CMU License (HPND)
- **Source:** https://github.com/python-pillow/Pillow
- **Used in:** `beacon-reporter` (Pro) — image processing dependency for Matplotlib
  and ReportLab when rendering logos or charts inside the PDF.

---

### Sealed Secrets

- **Author:** Bitnami (VMware)
- **License:** Apache License 2.0
- **Source:** https://github.com/bitnami-labs/sealed-secrets
- **Used in:** Deployment manifests — SMTP credentials and ACS connection strings
  are stored as `SealedSecret` resources so they can be safely committed to Git.
  Beacon does not bundle or distribute Sealed Secrets; it is listed as a cluster
  prerequisite in the deployment documentation.

---

### Alpine Linux

- **License:** Combination of MIT, BSD, and GPL-2.0 (per individual package)
- **Source:** https://alpinelinux.org
- **Used in:** Base image (`python:3.12-alpine`) for `beacon-updater`,
  `beacon-reporter`, and `beacon-scanner`. Alpine is chosen for its minimal attack
  surface and small image size.

---

## License Texts

Full license texts are available at the following canonical locations:

| License | URL |
|---------|-----|
| Apache License 2.0 | https://www.apache.org/licenses/LICENSE-2.0 |
| MIT License | https://opensource.org/licenses/MIT |
| BSD 3-Clause | https://opensource.org/licenses/BSD-3-Clause |
| Matplotlib License | https://matplotlib.org/stable/users/project/license.html |
| Pillow (HPND) | https://github.com/python-pillow/Pillow/blob/main/LICENSE |

---

## Notice

Beacon itself is dual-licensed (AGPL-3.0 / Commercial). This ATTRIBUTION.md covers
only the third-party components embedded in or required by Beacon. For Beacon's own
licensing terms see [README.md § Licensing](./README.md#licensing).

*Last updated: 2026-05-29*
