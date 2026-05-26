import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  registerSidebarEntry,
  registerRoute,
  K8s,
  ApiProxy,
} from '@kinvolk/headlamp-plugin/lib';
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Box, Typography, Alert, CircularProgress, Tooltip, TableSortLabel,
  Popover, FormControlLabel, Checkbox, Divider, Chip,
  Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Switch, Paper, Tab, Tabs, Collapse, Select, MenuItem, FormControl, InputLabel,
} from '@mui/material';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AppConfig {
  name: string;
  currentVersion: {
    namespace: string;
    deployment: string;
    container?: string;
    initContainer?: string;
    vPrefix?: boolean;
  };
  latestVersion: {
    type: 'github-release' | 'github-tag' | 'ghcr-tag' | 'manual';
    repo?: string;
    image?: string;
    tagPrefix?: string;
    stripPrefix?: boolean;
    value?: string;
    releaseUrl?: string;
  };
}

interface VersionsCache {
  lastUpdate?: string;
  apps?: Record<string, string>;
  errors?: Record<string, string>;
}

type LicenseLevel = 'free' | 'pro' | 'enterprise';

// ─── Utility ──────────────────────────────────────────────────────────────────

function extractImageTag(image: string): string {
  if (!image) return 'unknown';
  const atIdx = image.indexOf('@sha256:');
  const noDigest = atIdx === -1 ? image : image.substring(0, atIdx);
  const after = noDigest.substring(noDigest.lastIndexOf('/') + 1);
  const colonIdx = after.lastIndexOf(':');
  return colonIdx === -1 ? 'latest' : after.substring(colonIdx + 1);
}

function compareVersions(a: string, b: string): number {
  const norm = (v: string) => v.replace(/^v/i, '').split(/[.\-+]/).map(p => { const n = Number(p); return Number.isFinite(n) ? n : 0; });
  const pa = norm(a); const pb = norm(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d !== 0) return d; }
  return 0;
}

function getReleaseUrl(app: AppConfig): string | null {
  const lv = app.latestVersion;
  if (lv.releaseUrl) return lv.releaseUrl;
  if (lv.repo) return `https://github.com/${lv.repo}/${lv.type === 'github-tag' ? 'tags' : 'releases'}`;
  return null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-PT', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

// ─── License hook ─────────────────────────────────────────────────────────────

function useLicenseLevel(): { level: LicenseLevel; domain: string } {
  const ConfigMap = (K8s as any).ResourceClasses.ConfigMap;
  const [licenseCm, cmError] = ConfigMap.useGet('beacon-license-config', 'ops-headlamp');
  if (cmError || !licenseCm) return { level: 'free', domain: 'yourdomain.com' };
  const raw: string = licenseCm?.jsonData?.data?.['license-level'] ?? licenseCm?.data?.['license-level'] ?? 'free';
  const level: LicenseLevel = ['pro', 'enterprise'].includes(raw.toLowerCase()) ? raw.toLowerCase() as LicenseLevel : 'free';
  const domain: string = licenseCm?.jsonData?.data?.['company-domain'] ?? licenseCm?.data?.['company-domain'] ?? 'yourdomain.com';
  return { level, domain };
}

// ─── Status ───────────────────────────────────────────────────────────────────

const STATUS_STYLES = {
  outdated: { background: 'rgba(255,152,0,0.2)',   color: '#ffb74d', border: '1px solid rgba(255,152,0,0.5)'   },
  upToDate: { background: 'rgba(76,175,80,0.2)',   color: '#81c784', border: '1px solid rgba(76,175,80,0.5)'   },
  error:    { background: 'rgba(244,67,54,0.2)',   color: '#ef9a9a', border: '1px solid rgba(244,67,54,0.5)'   },
  unknown:  { background: 'rgba(158,158,158,0.2)', color: '#bdbdbd', border: '1px solid rgba(158,158,158,0.5)' },
} as const;
type StatusKind = keyof typeof STATUS_STYLES;
const ALL_STATUS_FILTERS: StatusKind[] = ['upToDate', 'outdated', 'error', 'unknown'];
const STATUS_FILTER_LABELS: Record<StatusKind, string> = { upToDate: '✓ Up to Date', outdated: '⚠️ Update Available', error: '✗ Error', unknown: '? Unknown' };

function StatusBadge({ kind, label, tooltip, href }: { kind: StatusKind; label: string; tooltip?: string; href?: string | null }) {
  const sx = { ...STATUS_STYLES[kind], p: '4px 10px', borderRadius: '4px', fontWeight: 600, fontSize: '12px', display: 'inline-block', ...(href ? { cursor: 'pointer', textDecoration: 'none', '&:hover': { filter: 'brightness(1.3)', textDecoration: 'underline' } } : {}) };
  const badge = href ? <Typography component="a" href={href} target="_blank" rel="noopener noreferrer" sx={sx}>{label} ↗</Typography> : <Typography component="span" sx={sx}>{label}</Typography>;
  return tooltip ? <Tooltip title={tooltip}>{badge}</Tooltip> : badge;
}

// ─── Filter header ────────────────────────────────────────────────────────────

interface FilterHeaderProps<T extends string> { label: string; allOptions: T[]; activeFilters: T[]; onFiltersChange: (f: T[]) => void; renderOption: (o: T) => React.ReactNode; getOptionColor?: (o: T) => string; }
function FilterHeader<T extends string>({ label, allOptions, activeFilters, onFiltersChange, renderOption, getOptionColor }: FilterHeaderProps<T>) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);
  const isFiltered = activeFilters.length < allOptions.length;
  const toggleFilter = (o: T) => { if (activeFilters.includes(o)) { if (activeFilters.length > 1) onFiltersChange(activeFilters.filter(f => f !== o)); } else onFiltersChange([...activeFilters, o]); };
  return (
    <>
      <Box onClick={e => setAnchorEl(e.currentTarget as HTMLElement)} sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontWeight: 600, color: isFiltered ? '#ffb74d' : '#fff', userSelect: 'none', '&:hover': { opacity: 0.8 } }}>
        {label}<Typography component="span" sx={{ fontSize: '11px', opacity: 0.7 }}>{isFiltered ? ` (${activeFilters.length}/${allOptions.length})` : ' ▾'}</Typography>
      </Box>
      <Popover open={open} anchorEl={anchorEl} onClose={() => setAnchorEl(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }} PaperProps={{ sx: { background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', p: '8px 4px', minWidth: '220px', maxHeight: '320px', overflowY: 'auto' } }}>
        <Typography sx={{ px: 2, pb: 1, fontSize: '11px', color: '#888', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Filter by {label.toLowerCase()}</Typography>
        <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', mb: 1 }} />
        {allOptions.map(o => (<Box key={o} sx={{ px: 1 }}><FormControlLabel control={<Checkbox checked={activeFilters.includes(o)} onChange={() => toggleFilter(o)} size="small" sx={{ color: getOptionColor?.(o) ?? '#bdbdbd', '&.Mui-checked': { color: getOptionColor?.(o) ?? '#bdbdbd' } }} />} label={<Typography sx={{ fontSize: '13px', fontWeight: 500, color: getOptionColor?.(o) ?? '#ccc' }}>{renderOption(o)}</Typography>} sx={{ width: '100%', m: 0, borderRadius: '4px', '&:hover': { background: 'rgba(255,255,255,0.05)' } }} /></Box>))}
        {isFiltered && (<><Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', mt: 1, mb: 1 }} /><Box sx={{ px: 1 }}><Typography onClick={() => { onFiltersChange([...allOptions]); setAnchorEl(null); }} sx={{ fontSize: '12px', color: '#888', cursor: 'pointer', px: 1, py: 0.5, borderRadius: '4px', '&:hover': { color: '#fff', background: 'rgba(255,255,255,0.05)' } }}>↺ Reset to all</Typography></Box></>)}
      </Popover>
    </>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseConfigMapValue<T>(cm: any, key: string, fallback: T): { value: T; error: string | null } {
  if (!cm) return { value: fallback, error: null };
  const raw = cm.jsonData?.data?.[key] ?? cm.data?.[key];
  if (!raw) return { value: fallback, error: `key "${key}" missing` };
  try { return { value: JSON.parse(raw) as T, error: null }; }
  catch (e: any) { return { value: fallback, error: `Failed to parse ${key}: ${e?.message ?? e}` }; }
}

const darkFieldSx = {
  '& .MuiOutlinedInput-root': { color: '#fff', '& fieldset': { borderColor: 'rgba(255,255,255,0.2)' }, '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.35)' }, '&.Mui-focused fieldset': { borderColor: '#f5c518' } },
  '& .MuiInputLabel-root': { color: '#888' }, '& .MuiInputLabel-root.Mui-focused': { color: '#f5c518' },
  '& .MuiFormHelperText-root': { color: '#555' },
};

// ─── Save utilities ───────────────────────────────────────────────────────────

async function saveConfigMap(name: string, apps: AppConfig[]): Promise<void> {
  const appsJson = JSON.stringify(apps);
  const labels = { 'app.kubernetes.io/name': 'beacon', 'app.kubernetes.io/component': 'config', 'app.kubernetes.io/part-of': 'headlamp' };
  try {
    await ApiProxy.request(`/api/v1/namespaces/ops-headlamp/configmaps/${name}`, {
      method: 'PATCH', isJSON: true,
      headers: { 'Content-Type': 'application/merge-patch+json' },
      body: JSON.stringify({ data: { 'apps.json': appsJson } }),
    });
  } catch (e: any) {
    if (String(e?.message ?? e).match(/404|not found/i)) {
      await ApiProxy.request('/api/v1/namespaces/ops-headlamp/configmaps', {
        method: 'POST', isJSON: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name, namespace: 'ops-headlamp', labels }, data: { 'apps.json': appsJson } }),
      });
    } else throw e;
  }
}

async function triggerUpdater(): Promise<void> {
  try {
    const cj = await ApiProxy.request('/apis/batch/v1/namespaces/ops-headlamp/cronjobs/beacon-updater', { isJSON: true });
    await ApiProxy.request('/apis/batch/v1/namespaces/ops-headlamp/jobs', {
      method: 'POST', isJSON: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiVersion: 'batch/v1', kind: 'Job', metadata: { name: `beacon-refresh-${Date.now()}`, namespace: 'ops-headlamp', labels: { 'app.kubernetes.io/name': 'beacon', 'app.kubernetes.io/component': 'updater' } }, spec: cj.spec.jobTemplate.spec }),
    });
  } catch { /* updater not installed — skip */ }
}

// ─── First-run card ───────────────────────────────────────────────────────────

function FirstRunCard({ section, tabLabel }: { section: string; tabLabel: string }) {
  return (
    <Paper sx={{ p: 5, textAlign: 'center', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px' }}>
      <Typography sx={{ fontSize: '32px', mb: 2 }}>🔭</Typography>
      <Typography variant="h6" sx={{ color: '#ccc', fontWeight: 600, mb: 1.5 }}>{section} not configured yet</Typography>
      <Typography variant="body2" sx={{ color: '#555', maxWidth: 420, mx: 'auto', lineHeight: 1.8, mb: 3 }}>
        Beacon hasn't scanned your cluster for {section.toLowerCase()} yet.<br />
        Open <strong style={{ color: '#f5c518' }}>Settings → {tabLabel}</strong> to scan, select what you want to monitor, and save.
      </Typography>
      <Button component="a" href="/beacon/settings" variant="outlined"
        sx={{ borderColor: 'rgba(245,197,24,0.5)', color: '#f5c518', fontWeight: 600, textTransform: 'none', px: 3, '&:hover': { borderColor: '#f5c518', background: 'rgba(245,197,24,0.08)' } }}>
        Open Settings
      </Button>
    </Paper>
  );
}

// ─── Infrastructure catalogue + discovery ─────────────────────────────────────

interface CatalogueEntry { name: string; namespace: string; deployment: string; container?: string; latestVersion: AppConfig['latestVersion']; }
interface DiscoveredInfra extends CatalogueEntry { found: boolean; }

const INFRA_CATALOGUE: CatalogueEntry[] = [
  { name: 'Argo CD',             namespace: 'argocd',              deployment: 'argocd-server',                                     latestVersion: { type: 'github-tag', repo: 'argoproj/argo-cd',                       tagPrefix: 'v', stripPrefix: false, releaseUrl: 'https://github.com/argoproj/argo-cd/releases'                    } },
  { name: 'cert-manager',        namespace: 'cert-manager',         deployment: 'cert-manager',                                      latestVersion: { type: 'github-tag', repo: 'cert-manager/cert-manager',               tagPrefix: 'v', stripPrefix: false, releaseUrl: 'https://github.com/cert-manager/cert-manager/releases'            } },
  { name: 'Envoy Gateway',       namespace: 'envoy-gateway-system', deployment: 'envoy-gateway',       container: 'envoy-gateway',   latestVersion: { type: 'github-tag', repo: 'envoyproxy/gateway',                      tagPrefix: 'v', stripPrefix: false, releaseUrl: 'https://github.com/envoyproxy/gateway/releases'                   } },
  { name: 'External DNS',        namespace: 'external-dns',         deployment: 'external-dns',                                      latestVersion: { type: 'github-tag', repo: 'kubernetes-sigs/external-dns',            tagPrefix: 'v', stripPrefix: false, releaseUrl: 'https://github.com/kubernetes-sigs/external-dns/releases'         } },
  { name: 'External Secrets',    namespace: 'external-secrets',     deployment: 'external-secrets',                                  latestVersion: { type: 'github-tag', repo: 'external-secrets/external-secrets',       tagPrefix: 'v', stripPrefix: false, releaseUrl: 'https://github.com/external-secrets/external-secrets/releases'    } },
  { name: 'Flux',                namespace: 'flux-system',          deployment: 'source-controller',                                 latestVersion: { type: 'github-tag', repo: 'fluxcd/flux2',                            tagPrefix: 'v', stripPrefix: false, releaseUrl: 'https://github.com/fluxcd/flux2/releases'                         } },
  { name: 'ingress-nginx',       namespace: 'ingress-nginx',        deployment: 'ingress-nginx-controller',                          latestVersion: { type: 'github-tag', repo: 'kubernetes/ingress-nginx',                tagPrefix: 'controller-v', stripPrefix: false, releaseUrl: 'https://github.com/kubernetes/ingress-nginx/releases'        } },
  { name: 'Kube State Metrics',  namespace: 'monitoring',           deployment: 'kube-state-metrics',                                latestVersion: { type: 'github-tag', repo: 'kubernetes/kube-state-metrics',           tagPrefix: 'v', stripPrefix: false, releaseUrl: 'https://github.com/kubernetes/kube-state-metrics/releases'        } },
  { name: 'Metrics Server',      namespace: 'kube-system',          deployment: 'metrics-server',                                    latestVersion: { type: 'github-tag', repo: 'kubernetes-sigs/metrics-server',          tagPrefix: 'v', stripPrefix: false, releaseUrl: 'https://github.com/kubernetes-sigs/metrics-server/releases'       } },
  { name: 'Prometheus Operator', namespace: 'monitoring',           deployment: 'prometheus-operator',                               latestVersion: { type: 'github-tag', repo: 'prometheus-operator/prometheus-operator', tagPrefix: 'v', stripPrefix: false, releaseUrl: 'https://github.com/prometheus-operator/prometheus-operator/releases' } },
  { name: 'Reloader',            namespace: 'reloader',             deployment: 'reloader-reloader',   container: 'reloader-reloader', latestVersion: { type: 'github-tag', repo: 'stakater/Reloader',                   tagPrefix: 'v', stripPrefix: false, releaseUrl: 'https://github.com/stakater/Reloader/releases'                   } },
  { name: 'Sealed Secrets',      namespace: 'sealed-secrets',       deployment: 'sealed-secrets-controller', container: 'controller', latestVersion: { type: 'github-tag', repo: 'bitnami-labs/sealed-secrets',          tagPrefix: 'v', stripPrefix: false, releaseUrl: 'https://github.com/bitnami-labs/sealed-secrets/releases'          } },
  { name: 'Velero',              namespace: 'velero',               deployment: 'velero',                                            latestVersion: { type: 'github-tag', repo: 'vmware-tanzu/velero',                      tagPrefix: 'v', stripPrefix: false, releaseUrl: 'https://github.com/vmware-tanzu/velero/releases'                  } },
];

function useInfraDiscovery(): { discovered: DiscoveredInfra[]; scanning: boolean } {
  const [discovered, setDiscovered] = useState<DiscoveredInfra[]>([]);
  const [scanning, setScanning] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const results: DiscoveredInfra[] = [];
      for (const entry of INFRA_CATALOGUE) {
        try { const dep = await ApiProxy.request(`/apis/apps/v1/namespaces/${entry.namespace}/deployments/${entry.deployment}`, { isJSON: true }); results.push({ ...entry, found: !!dep?.metadata?.name }); }
        catch { results.push({ ...entry, found: false }); }
      }
      if (!cancelled) { setDiscovered(results); setScanning(false); }
    })();
    return () => { cancelled = true; };
  }, []);
  return { discovered, scanning };
}

// ─── Plugin catalogue + discovery ────────────────────────────────────────────

interface PluginCatalogueEntry { name: string; initContainerName: string; imagePatterns: string[]; latestVersion: AppConfig['latestVersion']; }
interface DiscoveredPlugin extends PluginCatalogueEntry { found: boolean; actualInitContainerName: string; }

const PLUGINS_CATALOGUE: PluginCatalogueEntry[] = [
  { name: 'Flux Plugin',            initContainerName: 'flux-plugin',            imagePatterns: ['headlamp-plugin-flux', 'headlamp-k8s/flux'],                 latestVersion: { type: 'ghcr-tag',   image: 'headlamp-k8s/headlamp-plugin-flux',       tagPrefix: 'v', stripPrefix: false, releaseUrl: 'https://github.com/headlamp-k8s/plugins/releases'                   } },
  { name: 'Kubescape Plugin',        initContainerName: 'kubescape-plugin',        imagePatterns: ['kubescape/headlamp-plugin'],                                  latestVersion: { type: 'github-tag', repo: 'kubescape/headlamp-plugin',              tagPrefix: 'v', stripPrefix: false, releaseUrl: 'https://github.com/kubescape/headlamp-plugin/releases'              } },
  { name: 'Trivy Plugin',            initContainerName: 'trivy-plugin',            imagePatterns: ['trivy-headlamp-plugin', 'kubebeam/trivy'],                   latestVersion: { type: 'github-tag', repo: 'kubebeam/trivy-headlamp-plugin',         tagPrefix: 'v', stripPrefix: false, releaseUrl: 'https://github.com/kubebeam/trivy-headlamp-plugin/releases'         } },
  { name: 'cert-manager Plugin',     initContainerName: 'cert-manager-plugin',     imagePatterns: ['headlamp-cert-manager'],                                      latestVersion: { type: 'github-tag', repo: 'headlamp-k8s/plugins',                  tagPrefix: 'v', stripPrefix: false, releaseUrl: 'https://github.com/headlamp-k8s/plugins/releases'                   } },
  { name: 'AI Assistant Plugin',     initContainerName: 'ai-assistant-plugin',     imagePatterns: ['headlamp-ai-assistant'],                                      latestVersion: { type: 'github-tag', repo: 'headlamp-k8s/plugins',                  tagPrefix: 'v', stripPrefix: false, releaseUrl: 'https://github.com/headlamp-k8s/plugins/releases'                   } },
  { name: 'KAITO Plugin',            initContainerName: 'kaito-plugin',            imagePatterns: ['headlamp-kaito', 'kaito-project/headlamp-kaito'],             latestVersion: { type: 'github-tag', repo: 'kaito-project/headlamp-kaito',          tagPrefix: 'v', stripPrefix: false, releaseUrl: 'https://github.com/kaito-project/headlamp-kaito/releases'           } },
  { name: 'Karpenter Plugin',        initContainerName: 'karpenter-plugin',        imagePatterns: ['headlamp-karpenter'],                                         latestVersion: { type: 'github-tag', repo: 'headlamp-k8s/plugins',                  tagPrefix: 'v', stripPrefix: false, releaseUrl: 'https://github.com/headlamp-k8s/plugins/releases'                   } },
  { name: 'KEDA Plugin',             initContainerName: 'keda-plugin',             imagePatterns: ['headlamp-keda'],                                              latestVersion: { type: 'github-tag', repo: 'headlamp-k8s/plugins',                  tagPrefix: 'v', stripPrefix: false, releaseUrl: 'https://github.com/headlamp-k8s/plugins/releases'                   } },
  { name: 'Knative Plugin',          initContainerName: 'knative-plugin',          imagePatterns: ['headlamp-knative'],                                           latestVersion: { type: 'github-tag', repo: 'headlamp-k8s/plugins',                  tagPrefix: 'v', stripPrefix: false, releaseUrl: 'https://github.com/headlamp-k8s/plugins/releases'                   } },
  { name: 'Minikube Plugin',         initContainerName: 'minikube-plugin',         imagePatterns: ['headlamp-minikube'],                                          latestVersion: { type: 'github-tag', repo: 'headlamp-k8s/plugins',                  tagPrefix: 'v', stripPrefix: false, releaseUrl: 'https://github.com/headlamp-k8s/plugins/releases'                   } },
  { name: 'OpenCost Plugin',         initContainerName: 'opencost-plugin',         imagePatterns: ['headlamp-opencost'],                                          latestVersion: { type: 'github-tag', repo: 'headlamp-k8s/plugins',                  tagPrefix: 'v', stripPrefix: false, releaseUrl: 'https://github.com/headlamp-k8s/plugins/releases'                   } },
  { name: 'OPA Gatekeeper Plugin',   initContainerName: 'gatekeeper-plugin',       imagePatterns: ['gatekeeper-headlamp-plugin', 'sozercan/gatekeeper-headlamp'], latestVersion: { type: 'github-tag', repo: 'sozercan/gatekeeper-headlamp-plugin',   tagPrefix: 'v', stripPrefix: false, releaseUrl: 'https://github.com/sozercan/gatekeeper-headlamp-plugin/releases'     } },
  { name: 'Inspektor Gadget Plugin', initContainerName: 'inspektor-gadget-plugin', imagePatterns: ['inspektor-gadget/headlamp-plugin'],                           latestVersion: { type: 'github-tag', repo: 'inspektor-gadget/headlamp-plugin',      tagPrefix: 'v', stripPrefix: false, releaseUrl: 'https://github.com/inspektor-gadget/headlamp-plugin/releases'        } },
];

interface PluginDiscoveryResult { headlampFound: boolean; discovered: DiscoveredPlugin[]; scanning: boolean; }

function usePluginDiscovery(): PluginDiscoveryResult {
  const [headlampFound, setHeadlampFound] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredPlugin[]>([]);
  const [scanning, setScanning] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const dep = await ApiProxy.request('/apis/apps/v1/namespaces/ops-headlamp/deployments/headlamp', { isJSON: true });
        const initContainers: Array<{ name: string; image: string }> = dep?.spec?.template?.spec?.initContainers ?? [];
        const containers: Array<{ name: string; image: string }> = dep?.spec?.template?.spec?.containers ?? [];
        const results: DiscoveredPlugin[] = PLUGINS_CATALOGUE.map(entry => {
          const match = initContainers.find(ic => {
            if (ic.name === 'beacon-plugin') return false;
            if (ic.name === entry.initContainerName) return true;
            return entry.imagePatterns.some(p => ic.image.includes(p));
          });
          return { ...entry, found: !!match, actualInitContainerName: match?.name ?? entry.initContainerName };
        });
        if (!cancelled) {
          setHeadlampFound(!!containers.find(c => c.name === 'headlamp'));
          setDiscovered(results);
          setScanning(false);
        }
      } catch { if (!cancelled) setScanning(false); }
    })();
    return () => { cancelled = true; };
  }, []);
  return { headlampFound, discovered, scanning };
}

// ─── Application discovery ────────────────────────────────────────────────────

interface DiscoveredApp { name: string; namespace: string; }

const EXCLUDED_NAMESPACES = new Set([
  'kube-system', 'kube-public', 'kube-node-lease', 'default', 'ops-headlamp',
  ...INFRA_CATALOGUE.map(c => c.namespace),
]);

function useAppDiscovery(): { byNamespace: Record<string, DiscoveredApp[]>; scanning: boolean } {
  const [byNamespace, setByNamespace] = useState<Record<string, DiscoveredApp[]>>({});
  const [scanning, setScanning] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await ApiProxy.request('/apis/apps/v1/deployments', { isJSON: true });
        const items: Array<{ metadata: { name: string; namespace: string } }> = res?.items ?? [];
        const grouped: Record<string, DiscoveredApp[]> = {};
        for (const dep of items) {
          const ns = dep.metadata.namespace;
          if (EXCLUDED_NAMESPACES.has(ns)) continue;
          if (!grouped[ns]) grouped[ns] = [];
          grouped[ns].push({ name: dep.metadata.name, namespace: ns });
        }
        if (!cancelled) { setByNamespace(grouped); setScanning(false); }
      } catch { if (!cancelled) setScanning(false); }
    })();
    return () => { cancelled = true; };
  }, []);
  return { byNamespace, scanning };
}

// ─── Save status indicator ────────────────────────────────────────────────────

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
function SaveStatusBadge({ status, error }: { status: SaveStatus; error?: string }) {
  if (status === 'idle') return null;
  if (status === 'saving') return <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><CircularProgress size={14} sx={{ color: '#f5c518' }} /><Typography sx={{ fontSize: '13px', color: '#888' }}>Saving…</Typography></Box>;
  if (status === 'saved') return <Typography sx={{ fontSize: '13px', color: '#81c784' }}>✓ Saved — versions will refresh shortly</Typography>;
  return <Typography sx={{ fontSize: '13px', color: '#ef9a9a' }}>✗ {error ?? 'Save failed'}</Typography>;
}

// ─── Shared scope row ─────────────────────────────────────────────────────────

function ScopeRow({ label, badge, enabled, onChange }: { label: string; badge?: string; enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.2, borderRadius: '8px', background: enabled ? 'rgba(76,175,80,0.06)' : 'rgba(255,255,255,0.02)', border: `1px solid ${enabled ? 'rgba(76,175,80,0.2)' : 'rgba(255,255,255,0.06)'}`, transition: 'all 0.15s' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Typography sx={{ fontWeight: 500, color: enabled ? '#fff' : '#555', fontSize: '14px', transition: 'color 0.15s' }}>{label}</Typography>
        {badge && <Chip label={badge} size="small" sx={{ background: 'rgba(100,149,237,0.1)', color: '#90caf9', border: '1px solid rgba(100,149,237,0.2)', fontSize: '11px', fontFamily: 'monospace', height: '18px' }} />}
      </Box>
      <Switch checked={enabled} onChange={e => onChange(e.target.checked)} size="small" sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: '#81c784' }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: '#81c784' } }} />
    </Box>
  );
}

// ─── Save button ──────────────────────────────────────────────────────────────

function SaveButton({ onSave, status, disabled }: { onSave: () => void; status: SaveStatus; disabled?: boolean }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 3 }}>
      <Button variant="contained" onClick={onSave} disabled={disabled || status === 'saving'}
        sx={{ background: '#f5c518', color: '#000', fontWeight: 700, textTransform: 'none', px: 3, py: 1, '&:hover': { background: '#e0b515' }, '&:disabled': { background: 'rgba(245,197,24,0.2)', color: 'rgba(0,0,0,0.4)' } }}>
        {status === 'saving' ? <><CircularProgress size={14} sx={{ color: '#000', mr: 1 }} />Saving…</> : '💾 Save Configuration'}
      </Button>
      <SaveStatusBadge status={status} />
    </Box>
  );
}

// ─── Infrastructure tab ───────────────────────────────────────────────────────

function InfrastructureScopeTab() {
  const { discovered, scanning } = useInfraDiscovery();
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (discovered.length > 0 && Object.keys(enabled).length === 0) {
      const init: Record<string, boolean> = {};
      discovered.forEach(c => { init[c.name] = c.found; });
      setEnabled(init);
    }
  }, [discovered]);

  const found   = discovered.filter(c => c.found);
  const missing = discovered.filter(c => !c.found);

  const selectedApps: AppConfig[] = discovered.filter(c => c.found && enabled[c.name]).map(c => ({
    name: c.name,
    currentVersion: { namespace: c.namespace, deployment: c.deployment, ...(c.container ? { container: c.container } : {}) },
    latestVersion: c.latestVersion,
  }));

  const handleSave = async () => {
    setSaveStatus('saving'); setSaveError('');
    try { await saveConfigMap('beacon-core-apps', selectedApps); await triggerUpdater(); setSaveStatus('saved'); }
    catch (e: any) { setSaveError(e?.message ?? 'Unknown error'); setSaveStatus('error'); }
  };

  if (scanning) return <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 4 }}><CircularProgress size={18} sx={{ color: '#f5c518' }} /><Typography sx={{ color: '#888', fontSize: '14px' }}>Scanning cluster for infrastructure components…</Typography></Box>;

  return (
    <Box>
      <Typography variant="body2" sx={{ color: '#666', mb: 3, lineHeight: 1.7 }}>
        Beacon scanned your cluster for well-known infrastructure components. Toggle what to monitor and save.
      </Typography>

      {found.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography sx={{ fontSize: '11px', color: '#81c784', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1.5 }}>✓ Detected ({found.length})</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {found.map(c => <ScopeRow key={c.name} label={c.name} badge={c.namespace} enabled={!!enabled[c.name]} onChange={v => setEnabled(p => ({ ...p, [c.name]: v }))} />)}
          </Box>
        </Box>
      )}

      {missing.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography sx={{ fontSize: '11px', color: '#444', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1.5 }}>Not detected ({missing.length})</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.8 }}>
            {missing.map(c => <Chip key={c.name} label={c.name} size="small" sx={{ background: 'rgba(255,255,255,0.02)', color: '#444', border: '1px solid rgba(255,255,255,0.05)', fontSize: '12px' }} />)}
          </Box>
        </Box>
      )}

      {found.length === 0 && <Alert severity="info" sx={{ mb: 3, background: 'rgba(33,150,243,0.06)', color: '#90caf9', border: '1px solid rgba(33,150,243,0.15)' }}>No known infrastructure components detected. Check RBAC permissions.</Alert>}

      {found.length > 0 && <SaveButton onSave={handleSave} status={saveStatus} disabled={selectedApps.length === 0} />}
    </Box>
  );
}

// ─── Headlamp Plugins tab ─────────────────────────────────────────────────────

function PluginsScopeTab() {
  const { headlampFound, discovered, scanning } = usePluginDiscovery();
  const [enableHeadlamp, setEnableHeadlamp] = useState(true);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (discovered.length > 0 && Object.keys(enabled).length === 0) {
      const init: Record<string, boolean> = {};
      discovered.forEach(p => { init[p.name] = p.found; });
      setEnabled(init);
    }
  }, [discovered]);

  const foundPlugins   = discovered.filter(p => p.found);
  const missingPlugins = discovered.filter(p => !p.found);

  const buildApps = (): AppConfig[] => {
    const apps: AppConfig[] = [];
    if (headlampFound && enableHeadlamp) apps.push({ name: 'Headlamp', currentVersion: { namespace: 'ops-headlamp', deployment: 'headlamp', container: 'headlamp' }, latestVersion: { type: 'github-tag', repo: 'kubernetes-sigs/headlamp', tagPrefix: 'v', stripPrefix: false, releaseUrl: 'https://github.com/kubernetes-sigs/headlamp/releases' } });
    discovered.filter(p => p.found && enabled[p.name]).forEach(p => apps.push({ name: p.name, currentVersion: { namespace: 'ops-headlamp', deployment: 'headlamp', initContainer: p.actualInitContainerName }, latestVersion: p.latestVersion }));
    return apps;
  };

  const handleSave = async () => {
    setSaveStatus('saving'); setSaveError('');
    try { await saveConfigMap('beacon-plugins-apps', buildApps()); await triggerUpdater(); setSaveStatus('saved'); }
    catch (e: any) { setSaveError(e?.message ?? 'Unknown error'); setSaveStatus('error'); }
  };

  if (scanning) return <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 4 }}><CircularProgress size={18} sx={{ color: '#f5c518' }} /><Typography sx={{ color: '#888', fontSize: '14px' }}>Reading Headlamp deployment for installed plugins…</Typography></Box>;

  return (
    <Box>
      <Typography variant="body2" sx={{ color: '#666', mb: 3, lineHeight: 1.7 }}>
        Beacon read the Headlamp deployment's initContainers to detect installed plugins. Toggle what to monitor and save.
      </Typography>

      <Box sx={{ mb: 3 }}>
        <Typography sx={{ fontSize: '11px', color: '#81c784', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1.5 }}>
          ✓ Detected ({(headlampFound ? 1 : 0) + foundPlugins.length})
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {headlampFound && <ScopeRow label="Headlamp" badge="ops-headlamp" enabled={enableHeadlamp} onChange={setEnableHeadlamp} />}
          {foundPlugins.map(p => <ScopeRow key={p.name} label={p.name} badge={p.actualInitContainerName} enabled={!!enabled[p.name]} onChange={v => setEnabled(prev => ({ ...prev, [p.name]: v }))} />)}
        </Box>
      </Box>

      {missingPlugins.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography sx={{ fontSize: '11px', color: '#444', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1.5 }}>Not installed ({missingPlugins.length})</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.8 }}>
            {missingPlugins.map(p => <Chip key={p.name} label={p.name} size="small" sx={{ background: 'rgba(255,255,255,0.02)', color: '#444', border: '1px solid rgba(255,255,255,0.05)', fontSize: '12px' }} />)}
          </Box>
        </Box>
      )}

      {!headlampFound && foundPlugins.length === 0 && <Alert severity="warning" sx={{ mb: 3, background: 'rgba(255,152,0,0.06)', color: '#ffb74d', border: '1px solid rgba(255,152,0,0.2)' }}>Could not read the Headlamp deployment in <code>ops-headlamp</code>. Check RBAC permissions.</Alert>}

      <SaveButton onSave={handleSave} status={saveStatus} disabled={buildApps().length === 0} />
    </Box>
  );
}

// ─── Applications tab (Pro) ───────────────────────────────────────────────────

function NamespaceGroup({ ns, apps, enabled, onToggle, onToggleAll }: { ns: string; apps: DiscoveredApp[]; enabled: Record<string, boolean>; onToggle: (key: string, v: boolean) => void; onToggleAll: (ns: string, v: boolean) => void; }) {
  const [open, setOpen] = useState(true);
  const allOn = apps.every(a => enabled[`${ns}/${a.name}`]);
  const someOn = apps.some(a => enabled[`${ns}/${a.name}`]);
  return (
    <Box sx={{ mb: 1.5, borderRadius: '8px', border: '1px solid rgba(255,255,255,0.07)', overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.2, background: 'rgba(255,255,255,0.04)', cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography sx={{ fontSize: '12px', color: open ? '#fff' : '#666' }}>{open ? '▾' : '▸'}</Typography>
          <Chip label={ns} size="small" sx={{ background: 'rgba(100,149,237,0.12)', color: '#90caf9', border: '1px solid rgba(100,149,237,0.2)', fontSize: '11px', fontFamily: 'monospace', height: '20px' }} />
          <Typography sx={{ fontSize: '12px', color: '#555' }}>{apps.length} deployment{apps.length !== 1 ? 's' : ''}</Typography>
        </Box>
        <Box onClick={e => e.stopPropagation()}>
          <Checkbox checked={allOn} indeterminate={someOn && !allOn} onChange={e => onToggleAll(ns, e.target.checked)} size="small"
            sx={{ color: '#555', '&.Mui-checked': { color: '#81c784' }, '&.MuiCheckbox-indeterminate': { color: '#ffb74d' }, p: 0.5 }} />
        </Box>
      </Box>
      <Collapse in={open}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {apps.map(a => (
            <Box key={a.name} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 0.9, borderTop: '1px solid rgba(255,255,255,0.04)', '&:hover': { background: 'rgba(255,255,255,0.02)' } }}>
              <Typography sx={{ fontSize: '13px', color: enabled[`${ns}/${a.name}`] ? '#ccc' : '#444', fontFamily: 'monospace' }}>{a.name}</Typography>
              <Switch checked={!!enabled[`${ns}/${a.name}`]} onChange={e => onToggle(`${ns}/${a.name}`, e.target.checked)} size="small"
                sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: '#81c784' }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: '#81c784' } }} />
            </Box>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}

function ApplicationsScopeTab({ isPro }: { isPro: boolean }) {
  const { byNamespace, scanning } = useAppDiscovery();
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (Object.keys(byNamespace).length > 0 && Object.keys(enabled).length === 0) {
      const init: Record<string, boolean> = {};
      Object.entries(byNamespace).forEach(([ns, apps]) => apps.forEach(a => { init[`${ns}/${a.name}`] = true; }));
      setEnabled(init);
    }
  }, [byNamespace]);

  const onToggle = (key: string, v: boolean) => setEnabled(p => ({ ...p, [key]: v }));
  const onToggleAll = (ns: string, v: boolean) => setEnabled(p => { const next = { ...p }; (byNamespace[ns] ?? []).forEach(a => { next[`${ns}/${a.name}`] = v; }); return next; });

  const selectedApps: AppConfig[] = Object.entries(byNamespace).flatMap(([ns, apps]) =>
    apps.filter(a => enabled[`${ns}/${a.name}`]).map(a => ({ name: a.name, currentVersion: { namespace: ns, deployment: a.name }, latestVersion: { type: 'manual' as const, value: '0.0.0' } }))
  );

  const handleSave = async () => {
    setSaveStatus('saving'); setSaveError('');
    try { await saveConfigMap('beacon-apps-apps', selectedApps); await triggerUpdater(); setSaveStatus('saved'); }
    catch (e: any) { setSaveError(e?.message ?? 'Unknown error'); setSaveStatus('error'); }
  };

  if (!isPro) return (
    <Paper sx={{ p: 4, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', textAlign: 'center' }}>
      <Typography variant="h6" sx={{ color: '#555', mb: 1.5 }}>🔒 Pro Feature</Typography>
      <Typography variant="body2" sx={{ color: '#444', maxWidth: 420, mx: 'auto', lineHeight: 1.7 }}>
        Custom application monitoring requires Beacon Pro.{' '}
        <Typography component="a" href="mailto:kerberops@outlook.com" sx={{ color: '#f5c518', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>Contact kerberops@outlook.com</Typography>{' '}to enable it.
      </Typography>
    </Paper>
  );

  if (scanning) return <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 4 }}><CircularProgress size={18} sx={{ color: '#f5c518' }} /><Typography sx={{ color: '#888', fontSize: '14px' }}>Scanning all namespaces for deployments…</Typography></Box>;

  const namespaces = Object.keys(byNamespace).sort();
  const totalDeployments = Object.values(byNamespace).reduce((s, a) => s + a.length, 0);

  return (
    <Box>
      <Typography variant="body2" sx={{ color: '#666', mb: 3, lineHeight: 1.7 }}>
        Found <strong style={{ color: '#ccc' }}>{totalDeployments}</strong> deployments across <strong style={{ color: '#ccc' }}>{namespaces.length}</strong> namespaces (system and infrastructure namespaces excluded). Select what to monitor and save.
      </Typography>

      {namespaces.length === 0 && <Alert severity="info" sx={{ background: 'rgba(33,150,243,0.06)', color: '#90caf9', border: '1px solid rgba(33,150,243,0.15)' }}>No application deployments found. All namespaces may be filtered out as infrastructure.</Alert>}

      {namespaces.map(ns => (
        <NamespaceGroup key={ns} ns={ns} apps={byNamespace[ns]} enabled={enabled} onToggle={onToggle} onToggleAll={onToggleAll} />
      ))}

      {namespaces.length > 0 && (
        <>
          <Alert severity="info" sx={{ mt: 2, mb: 1, background: 'rgba(33,150,243,0.05)', color: '#90caf9', border: '1px solid rgba(33,150,243,0.12)', fontSize: '12px' }}>
            Applications are tracked at their current running version only. Latest version comparison is not available for custom apps.
          </Alert>
          <SaveButton onSave={handleSave} status={saveStatus} disabled={selectedApps.length === 0} />
        </>
      )}
    </Box>
  );
}

// ─── Email & Reports tab ──────────────────────────────────────────────────────

function EmailReportsTab({ isPro, companyDomain }: { isPro: boolean; companyDomain: string }) {
  const [testEmail, setTestEmail] = useState('');
  const [testing, setTesting]     = useState(false);
  const [feedback, setFeedback]   = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const handleTest = async () => {
    const recipient = testEmail.trim();
    if (!recipient.includes('@') || recipient.split('@')[1]?.toLowerCase() !== companyDomain.toLowerCase()) { setFeedback({ type: 'error', msg: `Only @${companyDomain} addresses are allowed.` }); return; }
    setTesting(true); setFeedback(null);
    try {
      const cj = await ApiProxy.request('/apis/batch/v1/namespaces/ops-headlamp/cronjobs/beacon-reporter-daily', { isJSON: true });
      const jobSpec = { apiVersion: 'batch/v1', kind: 'Job', metadata: { name: `beacon-test-${Date.now()}`, namespace: 'ops-headlamp', labels: { 'app.kubernetes.io/name': 'beacon', 'app.kubernetes.io/component': 'smtp-test' } }, spec: { ...cj.spec.jobTemplate.spec, backoffLimit: 0, ttlSecondsAfterFinished: 300, template: { ...cj.spec.jobTemplate.spec.template, spec: { ...cj.spec.jobTemplate.spec.template.spec, containers: cj.spec.jobTemplate.spec.template.spec.containers.map((c: any) => ({ ...c, env: [...(c.env ?? []).filter((e: any) => !['DAILY_REPORT_RECIPIENTS','REPORT_SECTIONS','LOG_LEVEL'].includes(e.name)), { name: 'DAILY_REPORT_RECIPIENTS', value: recipient }, { name: 'REPORT_SECTIONS', value: 'plugins' }, { name: 'LOG_LEVEL', value: 'debug' }] })) } } } };
      await ApiProxy.request('/apis/batch/v1/namespaces/ops-headlamp/jobs', { method: 'POST', body: JSON.stringify(jobSpec), isJSON: true, headers: { 'Content-Type': 'application/json' } });
      setFeedback({ type: 'success', msg: `✅ Test report queued — check inbox in ~1 min.` });
    } catch (err: any) { setFeedback({ type: 'error', msg: `Test failed: ${err?.message ?? 'Unknown error'}` }); }
    finally { setTesting(false); }
  };

  if (!isPro) return (
    <Paper sx={{ p: 4, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', textAlign: 'center' }}>
      <Typography variant="h6" sx={{ color: '#555', mb: 1.5 }}>🔒 Pro Feature</Typography>
      <Typography variant="body2" sx={{ color: '#444', maxWidth: 420, mx: 'auto', lineHeight: 1.7 }}>
        Email reports and delivery configuration require Beacon Pro.{' '}
        <Typography component="a" href="mailto:kerberops@outlook.com" sx={{ color: '#f5c518', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>Contact kerberops@outlook.com</Typography>{' '}to upgrade.
      </Typography>
    </Paper>
  );

  return (
    <Box>
      <Paper sx={{ p: 3, mb: 3, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2, color: '#f5c518' }}>📧 Email Configuration</Typography>
        <Alert severity="info" sx={{ background: 'rgba(33,150,243,0.08)', color: '#90caf9', border: '1px solid rgba(33,150,243,0.2)', borderRadius: '8px' }}>
          <Typography sx={{ fontWeight: 700, fontSize: '13px', mb: 0.5 }}>Configured via Kubernetes Secret</Typography>
          <Typography sx={{ fontSize: '13px', opacity: 0.85 }}>Email delivery is managed by the <code>beacon-smtp-config</code> secret. Edit it directly or re-apply <code>06-pro-features.yaml</code> to update credentials.</Typography>
        </Alert>
      </Paper>
      <Paper sx={{ p: 3, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1, color: '#f5c518' }}>🧪 Test Email Delivery</Typography>
        <Typography variant="body2" sx={{ color: '#666', mb: 2.5 }}>Send a test PDF report to verify the full email pipeline end-to-end.</Typography>
        <TextField fullWidth size="small" label="Send test to" type="email" placeholder={`someone@${companyDomain}`} value={testEmail} onChange={e => { setTestEmail(e.target.value); setFeedback(null); }} onKeyDown={e => { if (e.key === 'Enter' && testEmail && !testing) handleTest(); }} sx={darkFieldSx} />
        {feedback && <Alert severity={feedback.type} sx={{ mt: 2, borderRadius: '8px', background: feedback.type === 'success' ? 'rgba(76,175,80,0.10)' : 'rgba(244,67,54,0.10)', color: feedback.type === 'success' ? '#81c784' : '#ef9a9a', border: `1px solid ${feedback.type === 'success' ? 'rgba(76,175,80,0.3)' : 'rgba(244,67,54,0.3)'}` }}>{feedback.msg}</Alert>}
        <Box sx={{ mt: 2.5 }}>
          <Button variant="outlined" onClick={handleTest} disabled={testing || !testEmail} sx={{ borderColor: 'rgba(255,255,255,0.2)', color: '#ccc', fontWeight: 600, textTransform: 'none', px: 3, py: 1, '&:hover': { borderColor: '#90caf9', color: '#90caf9' }, '&:disabled': { borderColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.2)' } }}>
            {testing ? <><CircularProgress size={14} sx={{ color: '#ccc', mr: 1 }} />Sending…</> : 'Test Connection'}
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}

// ─── Send Report Dialog ───────────────────────────────────────────────────────

function SendReportDialog({ open, onClose, section, companyDomain }: { open: boolean; onClose: () => void; section: string; companyDomain: string }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const isValid = (e: string) => !!e && e.includes('@') && e.split('@')[1]?.toLowerCase() === companyDomain.toLowerCase();
  const handleClose = () => { setEmail(''); setLoading(false); setStatus('idle'); setErrorMsg(''); onClose(); };
  const handleSend = async () => {
    if (!isValid(email)) return;
    setLoading(true); setErrorMsg('');
    try {
      const SECTION_KEY_MAP: Record<string, string> = { 'applications': 'apps', 'infrastructure': 'core', 'headlamp plugins': 'plugins' };
      const sectionKey = SECTION_KEY_MAP[section.toLowerCase()] ?? section.toLowerCase();
      const cj = await ApiProxy.request('/apis/batch/v1/namespaces/ops-headlamp/cronjobs/beacon-reporter-daily', { isJSON: true });
      const jobSpec = { apiVersion: 'batch/v1', kind: 'Job', metadata: { name: `beacon-report-${sectionKey}-${Date.now()}`, namespace: 'ops-headlamp', labels: { 'app.kubernetes.io/name': 'beacon', 'app.kubernetes.io/component': 'report-request' }, annotations: { 'beacon/requested-by': email, 'beacon/section': sectionKey } }, spec: { ...cj.spec.jobTemplate.spec, template: { ...cj.spec.jobTemplate.spec.template, metadata: { ...(cj.spec.jobTemplate.spec.template.metadata ?? {}), labels: { ...(cj.spec.jobTemplate.spec.template.metadata?.labels ?? {}), 'app.kubernetes.io/component': 'report-request' } }, spec: { ...cj.spec.jobTemplate.spec.template.spec, containers: cj.spec.jobTemplate.spec.template.spec.containers.map((c: any) => ({ ...c, env: [...(c.env ?? []).filter((e: any) => !['DAILY_REPORT_RECIPIENTS','REPORT_SECTIONS'].includes(e.name)), { name: 'DAILY_REPORT_RECIPIENTS', value: email }, { name: 'REPORT_SECTIONS', value: sectionKey }] })) } } } };
      await ApiProxy.request('/apis/batch/v1/namespaces/ops-headlamp/jobs', { method: 'POST', body: JSON.stringify(jobSpec), isJSON: true, headers: { 'Content-Type': 'application/json' } });
      setStatus('success');
    } catch (err: any) { setStatus('error'); setErrorMsg(err?.message ?? 'Failed to send. Check cluster permissions.'); }
    finally { setLoading(false); }
  };
  const emailError = !!email && !isValid(email);
  return (
    <Dialog open={open} onClose={status === 'success' ? handleClose : undefined} maxWidth="xs" fullWidth PaperProps={{ sx: { background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '12px' } }}>
      <DialogTitle sx={{ fontWeight: 700, fontSize: '16px', borderBottom: '1px solid rgba(255,255,255,0.08)', pb: 1.5 }}>📧 Send {section} Report</DialogTitle>
      <DialogContent sx={{ pt: 3.5, pb: 2.5 }}>
        {status === 'success' ? <Alert severity="success" sx={{ background: 'rgba(76,175,80,0.12)', color: '#81c784', border: '1px solid rgba(76,175,80,0.3)' }}>Report queued! It will be sent to <strong>{email}</strong> shortly.</Alert>
          : (<><Typography variant="body2" sx={{ color: '#888', mb: 3.5, lineHeight: 1.6 }}>A PDF report for the <strong style={{ color: '#fff' }}>{section}</strong> section will be generated and emailed below.</Typography><TextField autoFocus fullWidth size="small" type="email" label="Company email" placeholder={`someone@${companyDomain}`} value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && isValid(email) && !loading) handleSend(); }} disabled={loading} error={emailError} helperText={emailError ? `Only @${companyDomain} addresses are allowed` : `E.g: someone@${companyDomain}`} sx={{ ...darkFieldSx, '& .MuiFormHelperText-root': { color: emailError ? '#ef9a9a' : '#555' } }} />{status === 'error' && <Alert severity="error" sx={{ mt: 2, background: 'rgba(244,67,54,0.1)', color: '#ef9a9a', border: '1px solid rgba(244,67,54,0.3)' }}>{errorMsg}</Alert>}</>)}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1, gap: 1 }}>
        <Button onClick={handleClose} disabled={loading} sx={{ color: '#666', '&:hover': { color: '#999', background: 'rgba(255,255,255,0.05)' } }}>{status === 'success' ? 'Close' : 'Cancel'}</Button>
        {status !== 'success' && <Button variant="contained" onClick={handleSend} disabled={loading || !isValid(email)} sx={{ background: '#f5c518', color: '#000', fontWeight: 700, px: 3, '&:hover': { background: '#e0b515' }, '&:disabled': { background: 'rgba(245,197,24,0.2)', color: 'rgba(0,0,0,0.4)' } }}>{loading ? <CircularProgress size={16} sx={{ color: '#000' }} /> : 'Send'}</Button>}
      </DialogActions>
    </Dialog>
  );
}

// ─── AppRowInner ──────────────────────────────────────────────────────────────

function AppRowInner({ app, latestVersion, cacheError, onStatusChange }: { app: AppConfig; latestVersion: string | null; cacheError?: string; onStatusChange: (n: string, k: StatusKind) => void }) {
  const Deployment = (K8s as any).ResourceClasses.Deployment;
  const [deployment, depError] = Deployment.useGet(app.currentVersion.deployment, app.currentVersion.namespace);
  let current = 'loading...'; let currentError: string | null = null;
  if (depError) { current = 'error'; currentError = `Deployment ${app.currentVersion.namespace}/${app.currentVersion.deployment}: ${String(depError)}`; }
  else if (deployment) {
    const podSpec = deployment.spec?.template?.spec ?? deployment.jsonData?.spec?.template?.spec;
    const containers = podSpec?.containers ?? []; const initContainers = podSpec?.initContainers ?? [];
    let cs: any;
    if (app.currentVersion.initContainer) cs = initContainers.find((c: any) => c.name === app.currentVersion.initContainer);
    else if (app.currentVersion.container) cs = containers.find((c: any) => c.name === app.currentVersion.container);
    else cs = containers[0];
    if (cs?.image) { let tag = extractImageTag(cs.image); if (app.currentVersion.vPrefix && tag !== 'unknown' && tag !== 'latest' && !tag.startsWith('v')) tag = 'v' + tag; current = tag; }
    else { current = 'not found'; currentError = 'Container not found in deployment'; }
  }
  const releaseUrl = getReleaseUrl(app);
  const haveCurrent = !['loading...', 'error', 'not found', 'unknown'].includes(current);
  const haveLatest = !!latestVersion && !['0.0.0', 'unknown', 'N/A', 'loading...'].includes(latestVersion);
  const isOutdated = haveCurrent && haveLatest && compareVersions(current, latestVersion!) < 0;
  const isUpToDate = haveCurrent && haveLatest && !isOutdated;
  let statusKind: StatusKind = 'unknown';
  if (currentError || cacheError) statusKind = 'error';
  else if (current !== 'loading...') { if (isOutdated) statusKind = 'outdated'; else if (isUpToDate) statusKind = 'upToDate'; }
  const lastReported = useRef<StatusKind | null>(null);
  useEffect(() => { if (lastReported.current !== statusKind) { lastReported.current = statusKind; onStatusChange(app.name, statusKind); } }, [statusKind, app.name, onStatusChange]);
  let status: React.ReactNode;
  if (currentError) status = <StatusBadge kind="error" label="✗ Error" tooltip={currentError} href={releaseUrl} />;
  else if (cacheError) status = <StatusBadge kind="error" label="✗ Fetch failed" tooltip={cacheError} href={releaseUrl} />;
  else if (current === 'loading...') status = <CircularProgress size={16} sx={{ color: '#bdbdbd' }} />;
  else if (isOutdated) status = <StatusBadge kind="outdated" label="⚠️ Update Available" href={releaseUrl} />;
  else if (isUpToDate) status = <StatusBadge kind="upToDate" label="✓ Up to Date" href={releaseUrl} />;
  else status = <StatusBadge kind="unknown" label="? Unknown" tooltip="Latest version not yet cached. Run the updater." href={releaseUrl} />;
  const cellSx = { color: '#ccc', borderBottom: '1px solid rgba(255,255,255,0.1)' };
  const codeStyle: React.CSSProperties = { background: 'rgba(0,0,0,0.3)', padding: '3px 8px', borderRadius: '4px', color: '#fff' };
  return (
    <>
      <TableCell sx={{ ...cellSx, fontWeight: 500, color: '#fff' }}>{app.name}</TableCell>
      <TableCell sx={cellSx}><Chip label={app.currentVersion.namespace} size="small" sx={{ background: 'rgba(100,149,237,0.15)', color: '#90caf9', border: '1px solid rgba(100,149,237,0.3)', fontSize: '11px', fontFamily: 'monospace', height: '20px' }} /></TableCell>
      <TableCell sx={cellSx}><code style={codeStyle}>{current}</code></TableCell>
      <TableCell sx={cellSx}><code style={codeStyle}>{latestVersion ?? 'N/A'}</code></TableCell>
      <TableCell sx={cellSx}>{status}</TableCell>
    </>
  );
}

// ─── Shared page component ────────────────────────────────────────────────────

type SortDirection = 'asc' | 'desc';
interface PageProps { appsConfigMapName: string; versionsConfigMapName: string; pageTitle: string; firstRunTabLabel: string; }

function BeaconPageContent({ appsConfigMapName, versionsConfigMapName, pageTitle, firstRunTabLabel }: PageProps) {
  const ConfigMap = (K8s as any).ResourceClasses.ConfigMap;
  const [appsCm, appsCmError] = ConfigMap.useGet(appsConfigMapName, 'ops-headlamp');
  const [versionsCm] = ConfigMap.useGet(versionsConfigMapName, 'ops-headlamp');
  const { level: licenseLevel, domain: companyDomain } = useLicenseLevel();
  const isPro = licenseLevel === 'pro' || licenseLevel === 'enterprise';
  const { value: apps, error: appsParseError } = parseConfigMapValue<AppConfig[]>(appsCm, 'apps.json', []);
  const { value: versionsCache } = parseConfigMapValue<VersionsCache>(versionsCm, 'versions.json', {});
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [sortDir, setSortDir] = useState<SortDirection>('asc');
  const [activeStatusFilters, setActiveStatusFilters] = useState<StatusKind[]>([...ALL_STATUS_FILTERS]);
  const allNamespaces = React.useMemo(() => [...new Set(apps.map(a => a.currentVersion.namespace))].sort(), [apps]);
  const [activeNsFilters, setActiveNsFilters] = useState<string[]>([]);
  useEffect(() => { if (allNamespaces.length > 0) setActiveNsFilters(prev => prev.length === 0 ? [...allNamespaces] : prev); }, [allNamespaces.join(',')]);
  const [statusMap, setStatusMap] = useState<Record<string, StatusKind>>({});
  const handleStatusChange = useCallback((name: string, kind: StatusKind) => { setStatusMap(prev => prev[name] === kind ? prev : { ...prev, [name]: kind }); }, []);
  const sortedApps = React.useMemo(() => [...apps].sort((a, b) => { const c = a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0; return sortDir === 'asc' ? c : -c; }), [apps, sortDir]);
  const visibleCount = apps.filter(app => activeStatusFilters.includes(statusMap[app.name] ?? 'unknown') && activeNsFilters.includes(app.currentVersion.namespace)).length;
  const isFiltered = visibleCount < apps.length && apps.length > 0;

  if (!appsCm && !appsCmError) return (<Box sx={{ p: 3 }}><Typography variant="h5" sx={{ fontWeight: 600, mb: 3 }}>{pageTitle}</Typography><Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box></Box>);
  if (appsCmError) return (<Box sx={{ p: 3 }}><Typography variant="h5" sx={{ fontWeight: 600, mb: 4 }}>{pageTitle}</Typography><FirstRunCard section={pageTitle} tabLabel={firstRunTabLabel} /></Box>);
  if (appsParseError) return (<Box sx={{ p: 3 }}><Typography variant="h5" sx={{ fontWeight: 600, mb: 3 }}>{pageTitle}</Typography><Alert severity="error">{appsParseError}</Alert></Box>);

  const lastUpdate = versionsCache.lastUpdate;
  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
          <Typography variant="h5" sx={{ fontWeight: 600 }}>{pageTitle}</Typography>
          {isFiltered && <Typography variant="caption" sx={{ color: '#ffb74d' }}>Showing {visibleCount} of {apps.length}</Typography>}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {lastUpdate && <Typography variant="caption" sx={{ color: '#888' }}>Updated: {formatDate(lastUpdate)}</Typography>}
          {isPro ? (
            <Button variant="outlined" size="large" onClick={() => setReportDialogOpen(true)} sx={{ borderColor: 'rgba(245,197,24,0.6)', color: '#f5c518', fontWeight: 700, fontSize: '16px', textTransform: 'none', px: 3.5, py: 1.1, '&:hover': { borderColor: '#f5c518', background: 'rgba(245,197,24,0.12)' } }}>📧 Send Report</Button>
          ) : (
            <Tooltip title="Send Report is a Pro feature." arrow><span><Button variant="outlined" size="large" disabled sx={{ borderColor: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.25)', fontWeight: 700, fontSize: '16px', textTransform: 'none', px: 3.5, py: 1.1 }}>🔒 Send Report</Button></span></Tooltip>
          )}
        </Box>
      </Box>
      {!versionsCm && <Alert severity="warning" sx={{ mb: 2 }}>Versions cache not found. Run the updater to populate it.</Alert>}
      <TableContainer sx={{ background: 'transparent' }}>
        <Table>
          <TableHead>
            <TableRow sx={{ borderBottom: '2px solid rgba(255,255,255,0.2)' }}>
              <TableCell sx={{ fontWeight: 600, color: '#fff' }}><TableSortLabel active direction={sortDir} onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')} sx={{ color: '#fff !important', '& .MuiTableSortLabel-icon': { color: '#fff !important' } }}>Application</TableSortLabel></TableCell>
              <TableCell sx={{ fontWeight: 600, color: '#fff' }}><FilterHeader<string> label="Namespace" allOptions={allNamespaces} activeFilters={activeNsFilters} onFiltersChange={setActiveNsFilters} renderOption={ns => ns} getOptionColor={() => '#90caf9'} /></TableCell>
              <TableCell sx={{ fontWeight: 600, color: '#fff' }}>Current Version</TableCell>
              <TableCell sx={{ fontWeight: 600, color: '#fff' }}>Latest Version</TableCell>
              <TableCell sx={{ fontWeight: 600, color: '#fff' }}><FilterHeader<StatusKind> label="Status" allOptions={ALL_STATUS_FILTERS} activeFilters={activeStatusFilters} onFiltersChange={setActiveStatusFilters} renderOption={k => STATUS_FILTER_LABELS[k]} getOptionColor={k => STATUS_STYLES[k].color} /></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedApps.map(app => {
              const visible = activeStatusFilters.includes(statusMap[app.name] ?? 'unknown') && activeNsFilters.includes(app.currentVersion.namespace);
              return (<TableRow key={app.name} sx={{ display: visible ? undefined : 'none', '&:hover': { background: 'rgba(255,255,255,0.05)' } }}><AppRowInner app={app} latestVersion={versionsCache.apps?.[app.name] ?? null} cacheError={versionsCache.errors?.[app.name]} onStatusChange={handleStatusChange} /></TableRow>);
            })}
          </TableBody>
        </Table>
      </TableContainer>
      {apps.length === 0 && <Alert severity="info" sx={{ mt: 2 }}>No apps configured in <code>{appsConfigMapName}</code>. Go to Settings to configure.</Alert>}
      {apps.length > 0 && visibleCount === 0 && <Alert severity="info" sx={{ mt: 2 }}>No apps match the selected filters.</Alert>}
      <SendReportDialog open={reportDialogOpen} onClose={() => setReportDialogOpen(false)} section={pageTitle} companyDomain={companyDomain} />
    </Box>
  );
}

// ─── Schedule tab ─────────────────────────────────────────────────────────────

const COMMON_TIMEZONES = [
  'UTC',
  'Europe/Lisbon', 'Europe/London', 'Europe/Dublin',
  'Europe/Madrid', 'Europe/Paris', 'Europe/Brussels',
  'Europe/Berlin', 'Europe/Amsterdam', 'Europe/Warsaw',
  'Europe/Bucharest', 'Europe/Helsinki', 'Europe/Kiev', 'Europe/Moscow',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Toronto', 'America/Sao_Paulo',
  'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Shanghai',
  'Australia/Sydney', 'Pacific/Auckland',
];

const tzSelectSx = { color: '#fff', '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.2)' }, '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.35)' }, '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#f5c518' }, '& .MuiSvgIcon-root': { color: '#888' } };
const tzMenuSx  = { PaperProps: { sx: { background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.12)', maxHeight: 320 } } };
const tzItemSx  = { fontSize: '13px', color: '#ccc', '&:hover': { background: 'rgba(255,255,255,0.06)' }, '&.Mui-selected': { background: 'rgba(245,197,24,0.12)', color: '#f5c518' } };
const tzLabelSx = { color: '#888', '&.Mui-focused': { color: '#f5c518' } };

function ScheduleTab({ isPro }: { isPro: boolean }) {
  const [updaterSchedule, setUpdaterSchedule]       = useState('0 9 * * *');
  const [updaterTz, setUpdaterTz]                   = useState('Europe/Lisbon');
  const [updaterLoading, setUpdaterLoading]         = useState(true);
  const [updaterNotFound, setUpdaterNotFound]       = useState(false);
  const [updaterSave, setUpdaterSave]               = useState<SaveStatus>('idle');
  const [updaterSaveErr, setUpdaterSaveErr]         = useState('');

  const [reporterEnabled, setReporterEnabled]       = useState(true);
  const [reporterSchedule, setReporterSchedule]     = useState('30 9 * * *');
  const [reporterTz, setReporterTz]                 = useState('Europe/Lisbon');
  const [reporterRecipients, setReporterRecipients] = useState('');
  const [reporterLoading, setReporterLoading]       = useState(true);
  const [reporterNotFound, setReporterNotFound]     = useState(false);
  const [reporterSave, setReporterSave]             = useState<SaveStatus>('idle');
  const [reporterSaveErr, setReporterSaveErr]       = useState('');

  useEffect(() => {
    (async () => {
      try {
        const cj = await ApiProxy.request('/apis/batch/v1/namespaces/ops-headlamp/cronjobs/beacon-updater', { isJSON: true });
        setUpdaterSchedule(cj.spec?.schedule ?? '0 9 * * *');
        setUpdaterTz(cj.spec?.timeZone ?? 'Europe/Lisbon');
      } catch (e: any) { if (String(e?.message ?? e).match(/404|not found/i)) setUpdaterNotFound(true); }
      finally { setUpdaterLoading(false); }
    })();
  }, []);

  useEffect(() => {
    if (!isPro) { setReporterLoading(false); return; }
    (async () => {
      try {
        const cj = await ApiProxy.request('/apis/batch/v1/namespaces/ops-headlamp/cronjobs/beacon-reporter-daily', { isJSON: true });
        setReporterEnabled(!cj.spec?.suspend);
        setReporterSchedule(cj.spec?.schedule ?? '30 9 * * *');
        setReporterTz(cj.spec?.timeZone ?? 'Europe/Lisbon');
        const envs: any[] = cj.spec?.jobTemplate?.spec?.template?.spec?.containers?.[0]?.env ?? [];
        setReporterRecipients(envs.find((e: any) => e.name === 'DAILY_REPORT_RECIPIENTS')?.value ?? '');
      } catch (e: any) { if (String(e?.message ?? e).match(/404|not found/i)) setReporterNotFound(true); }
      finally { setReporterLoading(false); }
    })();
  }, [isPro]);

  const saveUpdater = async () => {
    setUpdaterSave('saving'); setUpdaterSaveErr('');
    try {
      await ApiProxy.request('/apis/batch/v1/namespaces/ops-headlamp/cronjobs/beacon-updater', {
        method: 'PATCH', isJSON: true,
        headers: { 'Content-Type': 'application/merge-patch+json' },
        body: JSON.stringify({ spec: { schedule: updaterSchedule.trim(), timeZone: updaterTz } }),
      });
      setUpdaterSave('saved');
    } catch (e: any) { setUpdaterSaveErr(e?.message ?? 'Save failed'); setUpdaterSave('error'); }
  };

  const saveReporter = async () => {
    setReporterSave('saving'); setReporterSaveErr('');
    try {
      const cj = await ApiProxy.request('/apis/batch/v1/namespaces/ops-headlamp/cronjobs/beacon-reporter-daily', { isJSON: true });
      const containers = (cj.spec?.jobTemplate?.spec?.template?.spec?.containers ?? []).map((c: any) => ({
        ...c, env: [...(c.env ?? []).filter((e: any) => e.name !== 'DAILY_REPORT_RECIPIENTS'), { name: 'DAILY_REPORT_RECIPIENTS', value: reporterRecipients.trim() }],
      }));
      await ApiProxy.request('/apis/batch/v1/namespaces/ops-headlamp/cronjobs/beacon-reporter-daily', {
        method: 'PATCH', isJSON: true,
        headers: { 'Content-Type': 'application/merge-patch+json' },
        body: JSON.stringify({ spec: { suspend: !reporterEnabled, schedule: reporterSchedule.trim(), timeZone: reporterTz, jobTemplate: { spec: { template: { spec: { containers } } } } } }),
      });
      setReporterSave('saved');
    } catch (e: any) { setReporterSaveErr(e?.message ?? 'Save failed'); setReporterSave('error'); }
  };

  if (updaterLoading) return <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 4 }}><CircularProgress size={18} sx={{ color: '#f5c518' }} /><Typography sx={{ color: '#888', fontSize: '14px' }}>Loading schedule…</Typography></Box>;

  return (
    <Box>
      {/* ── Version Updater ── */}
      <Paper sx={{ p: 3, mb: 3, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5, color: '#f5c518' }}>🔄 Version Updater</Typography>
        <Typography variant="body2" sx={{ color: '#666', mb: 3 }}>Controls when Beacon fetches the latest versions from GitHub / GHCR.</Typography>
        {updaterNotFound ? (
          <Alert severity="warning" sx={{ background: 'rgba(255,152,0,0.06)', color: '#ffb74d', border: '1px solid rgba(255,152,0,0.2)' }}>
            CronJob <code>beacon-updater</code> not found in <code>ops-headlamp</code>. Deploy <code>05-cronjob.yaml</code> first.
          </Alert>
        ) : (
          <>
            <Box sx={{ display: 'flex', gap: 2, mb: 1 }}>
              <TextField size="small" label="Cron Schedule" value={updaterSchedule}
                onChange={e => { setUpdaterSchedule(e.target.value); setUpdaterSave('idle'); }}
                helperText={<>Cron format — <Typography component="a" href="https://crontab.guru" target="_blank" rel="noopener noreferrer" sx={{ color: '#90caf9', fontSize: 'inherit' }}>crontab.guru ↗</Typography></>}
                sx={{ ...darkFieldSx, flex: 1 }} />
              <FormControl size="small" sx={{ minWidth: 220 }}>
                <InputLabel sx={tzLabelSx}>Timezone</InputLabel>
                <Select label="Timezone" value={updaterTz} onChange={e => { setUpdaterTz(e.target.value); setUpdaterSave('idle'); }} sx={tzSelectSx} MenuProps={tzMenuSx}>
                  {COMMON_TIMEZONES.map(tz => <MenuItem key={tz} value={tz} sx={tzItemSx}>{tz}</MenuItem>)}
                </Select>
              </FormControl>
            </Box>
            <SaveButton onSave={saveUpdater} status={updaterSave} disabled={!updaterSchedule.trim()} />
            {updaterSave === 'error' && <Typography sx={{ mt: 1, fontSize: '12px', color: '#ef9a9a' }}>{updaterSaveErr}</Typography>}
          </>
        )}
      </Paper>

      {/* ── Daily Reports (Pro) ── */}
      {!isPro ? (
        <Paper sx={{ p: 4, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', textAlign: 'center' }}>
          <Typography variant="h6" sx={{ color: '#555', mb: 1.5 }}>🔒 Pro Feature</Typography>
          <Typography variant="body2" sx={{ color: '#444', maxWidth: 420, mx: 'auto', lineHeight: 1.7 }}>
            Daily report scheduling requires Beacon Pro.{' '}
            <Typography component="a" href="mailto:kerberops@outlook.com" sx={{ color: '#f5c518', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>Contact kerberops@outlook.com</Typography>{' '}to upgrade.
          </Typography>
        </Paper>
      ) : reporterLoading ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2 }}><CircularProgress size={16} sx={{ color: '#888' }} /><Typography sx={{ color: '#888', fontSize: '13px' }}>Loading reporter schedule…</Typography></Box>
      ) : reporterNotFound ? (
        <Alert severity="info" sx={{ background: 'rgba(33,150,243,0.06)', color: '#90caf9', border: '1px solid rgba(33,150,243,0.15)' }}>
          CronJob <code>beacon-reporter-daily</code> not found. Deploy <code>06-pro-features.yaml</code> to enable daily reports.
        </Alert>
      ) : (
        <Paper sx={{ p: 3, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2.5 }}>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#f5c518' }}>📅 Daily Reports</Typography>
              <Typography variant="body2" sx={{ color: '#666', mt: 0.5 }}>Schedule, recipients, and enable/disable for the automatic daily PDF report.</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 0.5 }}>
              <Typography sx={{ fontSize: '13px', color: reporterEnabled ? '#81c784' : '#555' }}>{reporterEnabled ? 'Enabled' : 'Disabled'}</Typography>
              <Switch checked={reporterEnabled} onChange={e => { setReporterEnabled(e.target.checked); setReporterSave('idle'); }} size="small"
                sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: '#81c784' }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: '#81c784' } }} />
            </Box>
          </Box>
          <TextField fullWidth size="small" label="Recipients" placeholder="devops@company.com, ops@company.com"
            value={reporterRecipients} onChange={e => { setReporterRecipients(e.target.value); setReporterSave('idle'); }}
            helperText="Comma-separated email addresses" sx={{ ...darkFieldSx, mb: 2 }} />
          <Box sx={{ display: 'flex', gap: 2, mb: 1 }}>
            <TextField size="small" label="Cron Schedule" value={reporterSchedule}
              onChange={e => { setReporterSchedule(e.target.value); setReporterSave('idle'); }}
              helperText={<>Cron format — <Typography component="a" href="https://crontab.guru" target="_blank" rel="noopener noreferrer" sx={{ color: '#90caf9', fontSize: 'inherit' }}>crontab.guru ↗</Typography></>}
              sx={{ ...darkFieldSx, flex: 1 }} />
            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel sx={tzLabelSx}>Timezone</InputLabel>
              <Select label="Timezone" value={reporterTz} onChange={e => { setReporterTz(e.target.value); setReporterSave('idle'); }} sx={tzSelectSx} MenuProps={tzMenuSx}>
                {COMMON_TIMEZONES.map(tz => <MenuItem key={tz} value={tz} sx={tzItemSx}>{tz}</MenuItem>)}
              </Select>
            </FormControl>
          </Box>
          <SaveButton onSave={saveReporter} status={reporterSave} disabled={!reporterSchedule.trim()} />
          {reporterSave === 'error' && <Typography sx={{ mt: 1, fontSize: '12px', color: '#ef9a9a' }}>{reporterSaveErr}</Typography>}
        </Paper>
      )}
    </Box>
  );
}

// ─── Settings page ────────────────────────────────────────────────────────────

const tabSx = { color: '#666', fontWeight: 600, textTransform: 'none' as const, fontSize: '14px', '&.Mui-selected': { color: '#f5c518' } };

function BeaconSettingsPage() {
  const { level: licenseLevel, domain: companyDomain } = useLicenseLevel();
  const isPro = licenseLevel === 'pro' || licenseLevel === 'enterprise';
  const [tab, setTab] = useState(0);
  return (
    <Box sx={{ p: 3, maxWidth: 860 }}>
      <Typography variant="h5" sx={{ fontWeight: 600, mb: 3 }}>Settings</Typography>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3, borderBottom: '1px solid rgba(255,255,255,0.08)', '& .MuiTabs-indicator': { backgroundColor: '#f5c518' } }}>
        <Tab label={isPro ? 'Applications'         : '🔒 Applications'}    sx={tabSx} />
        <Tab label={isPro ? '📧 Email & Reports'   : '🔒 Email & Reports'} sx={tabSx} />
        <Tab label="Headlamp Plugins"  sx={tabSx} />
        <Tab label="Infrastructure"    sx={tabSx} />
        <Tab label="Schedule"          sx={tabSx} />
      </Tabs>
      {tab === 0 && <ApplicationsScopeTab isPro={isPro} />}
      {tab === 1 && <EmailReportsTab isPro={isPro} companyDomain={companyDomain} />}
      {tab === 2 && <PluginsScopeTab />}
      {tab === 3 && <InfrastructureScopeTab />}
      {tab === 4 && <ScheduleTab isPro={isPro} />}
    </Box>
  );
}

// ─── Pages ────────────────────────────────────────────────────────────────────

function BeaconAppsPage() {
  const { level: licenseLevel } = useLicenseLevel();
  const isPro = licenseLevel === 'pro' || licenseLevel === 'enterprise';
  if (!isPro) return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" sx={{ fontWeight: 600, mb: 4 }}>Applications</Typography>
      <Paper sx={{ p: 4, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', textAlign: 'center' }}>
        <Typography variant="h6" sx={{ color: '#888', mb: 1.5 }}>🔒 Pro Feature</Typography>
        <Typography variant="body2" sx={{ color: '#555', maxWidth: 480, mx: 'auto', lineHeight: 1.7 }}>
          Custom application monitoring requires Beacon Pro.{' '}
          <Typography component="a" href="mailto:kerberops@outlook.com" sx={{ color: '#f5c518', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>Contact kerberops@outlook.com</Typography>{' '}to enable it for your cluster.
        </Typography>
      </Paper>
    </Box>
  );
  return <BeaconPageContent appsConfigMapName="beacon-apps-apps" versionsConfigMapName="beacon-apps-versions" pageTitle="Applications" firstRunTabLabel="Applications" />;
}
function BeaconCorePage()     { return <BeaconPageContent appsConfigMapName="beacon-core-apps"    versionsConfigMapName="beacon-core-versions"    pageTitle="Infrastructure"   firstRunTabLabel="Infrastructure" />; }
function BeaconPluginsPage()  { return <BeaconPageContent appsConfigMapName="beacon-plugins-apps" versionsConfigMapName="beacon-plugins-versions" pageTitle="Headlamp Plugins" firstRunTabLabel="Headlamp Plugins" />; }

// ─── Sidebar & routes ─────────────────────────────────────────────────────────

registerSidebarEntry({ parent: null,     name: 'beacon',          label: 'Beacon',           icon: 'mdi:lighthouse', url: '/beacon/core' });
registerSidebarEntry({ parent: 'beacon', name: 'beacon-apps',     label: 'Applications',     url: '/beacon/apps'     });
registerSidebarEntry({ parent: 'beacon', name: 'beacon-plugins',  label: 'Headlamp Plugins', url: '/beacon/plugins'  });
registerSidebarEntry({ parent: 'beacon', name: 'beacon-core',     label: 'Infrastructure',   url: '/beacon/core'     });
registerSidebarEntry({ parent: 'beacon', name: 'beacon-settings', label: 'Settings',         url: '/beacon/settings' });

registerRoute({ path: '/beacon/core',     exact: true, sidebar: 'beacon-core',     noCluster: true, component: BeaconCorePage     });
registerRoute({ path: '/beacon/plugins',  exact: true, sidebar: 'beacon-plugins',  noCluster: true, component: BeaconPluginsPage  });
registerRoute({ path: '/beacon/apps',     exact: true, sidebar: 'beacon-apps',     noCluster: true, component: BeaconAppsPage     });
registerRoute({ path: '/beacon/settings', exact: true, sidebar: 'beacon-settings', noCluster: true, component: BeaconSettingsPage });
