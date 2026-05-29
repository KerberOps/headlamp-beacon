# License Protection & Enforcement Guide

**Last Updated:** 2026-05-28

---

## Your Current Protection Status

### What you have in place

| Layer | File | What it does |
|-------|------|--------------|
| **Copyright** | `LICENSE` (AGPL-3.0) | Makes all derivatives open source if distributed or run over a network |
| **Dual license** | `README.md` | Puts companies on notice that commercial use requires a paid license |
| **CLA** | `CLA.md` | Gives you the right to commercially license contributor code |
| **Contribution guide** | `CONTRIBUTING.md` | Makes CLA acceptance a condition of contributing (by opening a PR) |

### What AGPL-3.0 forces on anyone who uses your code

| Scenario | What they must do |
|----------|-------------------|
| Use it internally without modification | Nothing — free to use |
| Modify it and run it as a service (SaaS, internal tool) | Publish their modified source code under AGPL |
| Ship it as part of a product | Include your copyright notice and the AGPL license |
| White-label it or keep modifications private | Must obtain a commercial license from you |
| Relicense it as closed-source | Not allowed — ever |

---

## Common Violations to Watch For

1. **A company ships a closed-source product** that includes Beacon without buying a commercial license
2. **A SaaS product** runs a modified version of Beacon but does not publish the modified source code
3. **Someone removes your copyright notice** from the code or the UI
4. **A fork is published** under a different license without your permission
5. **A contributor's PR is merged** elsewhere and used commercially without CLA coverage

---

## How to Detect Violations

- **Search GitHub** periodically for forks or code copies:
  `github.com/search?q=headlamp-beacon&type=repositories`
- **Search Docker Hub / GHCR** for images named `beacon-plugin` or `headlamp-beacon` not published by you
- **Search Google** for `"headlamp beacon" site:*.io OR site:*.com -site:github.com`
- **Monitor npm / ArtifactHub** for packages with suspiciously similar names or descriptions

---

## What To Do If You Find a Violation

### Step 1 — Document everything
Before contacting anyone, take screenshots and record:
- The URL of the product, repo, or service
- The date you found it
- What specifically is missing (source code not published, copyright removed, etc.)
- Any evidence linking it to your code (similar UI, copied comments, identical logic)

### Step 2 — Send a friendly notice first
Most violations are unintentional. Email the company or individual:

> Subject: AGPL-3.0 Compliance — Headlamp Beacon
>
> Hi,
>
> I noticed you are using Headlamp Beacon (https://github.com/KerberOps/headlamp-beacon)
> in [product/service]. Under its AGPL-3.0 license, you are required to [publish your
> modified source code / include the copyright notice / obtain a commercial license].
>
> I would like to resolve this amicably. Please either:
> (a) comply with the AGPL-3.0 requirements within 14 days, or
> (b) contact me at kerberops@outlook.com to discuss a commercial license.
>
> Best regards,
> KerberOps

Give them **14–30 days** to respond.

### Step 3 — Escalate if ignored

If they don't respond or refuse to comply:

1. **GitHub DMCA takedown** — if the violation is a public GitHub repo:
   `https://support.github.com/contact/dmca-takedown-request`

2. **Software Freedom Conservancy** — a non-profit that enforces GPL/AGPL on behalf of copyright holders, at no cost:
   `https://sfconservancy.org/copyleft-compliance/`

3. **Legal counsel** — for commercial violations (a company profiting from your code), a cease-and-desist letter from a lawyer is usually enough. AGPL violations are actionable copyright infringement.

### Step 4 — Offer a commercial license as resolution
In most cases, the violating company would rather pay you than rewrite their product. Use the violation as a sales opportunity:

> "To resolve this without legal action, you can purchase a commercial license that removes all AGPL obligations. Contact kerberops@outlook.com."

---

## Important Notes

- **AGPL-3.0 violations are copyright infringement** — you do not need to register a copyright to enforce it. Your `LICENSE` file and commit history establish ownership.
- **The CLA protects your dual-license model** — without it, contributors could block you from enforcing the commercial license on their code.
- **"Internal use" is a grey area** — AGPL only triggers the source-disclosure obligation when software is run over a network and accessed by users outside the organisation. Pure internal tools with no external users are generally exempt.
- **Keep your commit history clean** — it is your proof of authorship. Never rewrite history on `main`.

---

## Contacts

| Purpose | Contact |
|---------|---------|
| Commercial license enquiries | kerberops@outlook.com |
| AGPL compliance reports | kerberops@outlook.com |
| GitHub DMCA | https://support.github.com/contact/dmca-takedown-request |
| Software Freedom Conservancy | https://sfconservancy.org/copyleft-compliance/ |
