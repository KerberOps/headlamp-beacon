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
  Switch, Paper, InputAdornment, IconButton,
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

// ─── Utility functions ────────────────────────────────────────────────────────

function extractImageTag(image: string): string {
  if (!image) return 'unknown';
  const atIdx = image.indexOf('@sha256:');
  const noDigest = atIdx === -1 ? image : image.substring(0, atIdx);
  const slashIdx = noDigest.lastIndexOf('/');
  const after = slashIdx === -1 ? noDigest : noDigest.substring(slashIdx + 1);
  const colonIdx = after.lastIndexOf(':');
  if (colonIdx === -1) return 'latest';
  return after.substring(colonIdx + 1);
}

function compareVersions(a: string, b: string): number {
  const norm = (v: string) =>
    v.replace(/^v/i, '').split(/[.\-+]/).map(p => { const n = Number(p); return Number.isFinite(n) ? n : 0; });
  const pa = norm(a);
  const pb = norm(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function getReleaseUrl(app: AppConfig): string | null {
  const lv = app.latestVersion;
  if (lv.releaseUrl) return lv.releaseUrl;
  if (lv.repo) {
    if (lv.type === 'github-release') return `https://github.com/${lv.repo}/releases`;
    if (lv.type === 'github-tag')    return `https://github.com/${lv.repo}/tags`;
  }
  return null;
}

// ─── Shared hook: read license level ──────────────────────────────────────────
// Defaults to FREE if ConfigMap doesn't exist or license-level not set

function useLicenseLevel(): { level: LicenseLevel; domain: string } {
  const ConfigMap = (K8s as any).ResourceClasses.ConfigMap;
  const [licenseCm, cmError] = ConfigMap.useGet('beacon-license-config', 'ops-headlamp');
  
  // If ConfigMap doesn't exist, default to 'free'
  if (cmError || !licenseCm) {
    return { level: 'free', domain: 'aeteurope.com' };
  }
  
  const raw: string =
    licenseCm?.jsonData?.data?.['license-level'] ??
    licenseCm?.data?.['license-level'] ??
    'free';
  const level: LicenseLevel = ['pro', 'enterprise'].includes(raw.toLowerCase()) ? raw.toLowerCase() as LicenseLevel : 'free';
  const domain: string =
    licenseCm?.jsonData?.data?.['company-domain'] ??
    licenseCm?.data?.['company-domain'] ??
    'aeteurope.com';
  return { level, domain };
}

// ─── Status types & styles ────────────────────────────────────────────────────

const STATUS_STYLES = {
  outdated: { background: 'rgba(255,152,0,0.2)',   color: '#ffb74d', border: '1px solid rgba(255,152,0,0.5)'   },
  upToDate: { background: 'rgba(76,175,80,0.2)',   color: '#81c784', border: '1px solid rgba(76,175,80,0.5)'   },
  error:    { background: 'rgba(244,67,54,0.2)',   color: '#ef9a9a', border: '1px solid rgba(244,67,54,0.5)'   },
  unknown:  { background: 'rgba(158,158,158,0.2)', color: '#bdbdbd', border: '1px solid rgba(158,158,158,0.5)' },
} as const;

type StatusKind = keyof typeof STATUS_STYLES;
const ALL_STATUS_FILTERS: StatusKind[] = ['upToDate', 'outdated', 'error', 'unknown'];
const STATUS_FILTER_LABELS: Record<StatusKind, string> = {
  upToDate: '✓ Up to Date', outdated: '⚠️ Update Available', error: '✗ Error', unknown: '? Unknown',
};

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ kind, label, tooltip, href }: { kind: StatusKind; label: string; tooltip?: string; href?: string | null }) {
  const badgeSx = {
    ...STATUS_STYLES[kind], p: '4px 10px', borderRadius: '4px', fontWeight: 600, fontSize: '12px', display: 'inline-block',
    ...(href ? { cursor: 'pointer', textDecoration: 'none', '&:hover': { filter: 'brightness(1.3)', textDecoration: 'underline' } } : {}),
  };
  const badge = href
    ? <Typography component="a" href={href} target="_blank" rel="noopener noreferrer" sx={badgeSx}>{label} ↗</Typography>
    : <Typography component="span" sx={badgeSx}>{label}</Typography>;
  return tooltip ? <Tooltip title={tooltip}>{badge}</Tooltip> : badge;
}

// ─── Filter header ────────────────────────────────────────────────────────────

interface FilterHeaderProps<T extends string> {
  label: string; allOptions: T[]; activeFilters: T[]; onFiltersChange: (f: T[]) => void;
  renderOption: (o: T) => React.ReactNode; getOptionColor?: (o: T) => string;
}

function FilterHeader<T extends string>({ label, allOptions, activeFilters, onFiltersChange, renderOption, getOptionColor }: FilterHeaderProps<T>) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);
  const isFiltered = activeFilters.length < allOptions.length;
  const toggleFilter = (option: T) => {
    if (activeFilters.includes(option)) { if (activeFilters.length > 1) onFiltersChange(activeFilters.filter(f => f !== option)); }
    else onFiltersChange([...activeFilters, option]);
  };
  return (
    <>
      <Box onClick={e => setAnchorEl(e.currentTarget as HTMLElement)} sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontWeight: 600, color: isFiltered ? '#ffb74d' : '#fff', userSelect: 'none', '&:hover': { opacity: 0.8 } }}>
        {label}<Typography component="span" sx={{ fontSize: '11px', opacity: 0.7 }}>{isFiltered ? ` (${activeFilters.length}/${allOptions.length})` : ' ▾'}</Typography>
      </Box>
      <Popover open={open} anchorEl={anchorEl} onClose={() => setAnchorEl(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }} PaperProps={{ sx: { background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', p: '8px 4px', minWidth: '220px', maxHeight: '320px', overflowY: 'auto' } }}>
        <Typography sx={{ px: 2, pb: 1, fontSize: '11px', color: '#888', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Filter by {label.toLowerCase()}</Typography>
        <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', mb: 1 }} />
        {allOptions.map(option => (
          <Box key={option} sx={{ px: 1 }}>
            <FormControlLabel control={<Checkbox checked={activeFilters.includes(option)} onChange={() => toggleFilter(option)} size="small" sx={{ color: getOptionColor ? getOptionColor(option) : '#bdbdbd', '&.Mui-checked': { color: getOptionColor ? getOptionColor(option) : '#bdbdbd' } }} />} label={<Typography sx={{ fontSize: '13px', fontWeight: 500, color: getOptionColor ? getOptionColor(option) : '#ccc' }}>{renderOption(option)}</Typography>} sx={{ width: '100%', m: 0, borderRadius: '4px', '&:hover': { background: 'rgba(255,255,255,0.05)' } }} />
          </Box>
        ))}
        {isFiltered && (<><Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', mt: 1, mb: 1 }} /><Box sx={{ px: 1 }}><Typography onClick={() => { onFiltersChange([...allOptions]); setAnchorEl(null); }} sx={{ fontSize: '12px', color: '#888', cursor: 'pointer', px: 1, py: 0.5, borderRadius: '4px', '&:hover': { color: '#fff', background: 'rgba(255,255,255,0.05)' } }}>↺ Reset to all</Typography></Box></>)}
      </Popover>
    </>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseConfigMapValue<T>(cm: any, key: string, fallback: T): { value: T; error: string | null } {
  if (!cm) return { value: fallback, error: null };
  const raw = cm.jsonData?.data?.[key] ?? cm.data?.[key];
  if (!raw) return { value: fallback, error: `key "${key}" missing from configmap` };
  try { return { value: JSON.parse(raw) as T, error: null }; }
  catch (e: any) { return { value: fallback, error: `Failed to parse ${key}: ${e?.message ?? e}` }; }
}

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleString('pt-PT', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

// ─── Dark-themed text field ───────────────────────────────────────────────────

const darkFieldSx = {
  '& .MuiOutlinedInput-root': { color: '#fff', '& fieldset': { borderColor: 'rgba(255,255,255,0.2)' }, '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.35)' }, '&.Mui-focused fieldset': { borderColor: '#f5c518' } },
  '& .MuiInputLabel-root': { color: '#888' }, '& .MuiInputLabel-root.Mui-focused': { color: '#f5c518' },
  '& .MuiFormHelperText-root': { color: '#555' },
};

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
      
      // Map UI page titles to reporter section keys (ConfigMap name prefix)
      const SECTION_KEY_MAP: Record<string, string> = {
        'applications': 'apps',
        'infrastructure': 'core',
        'headlamp plugins': 'plugins',
      };
      const sectionKey = SECTION_KEY_MAP[section.toLowerCase()] ?? section.toLowerCase();
      const cronJob = await ApiProxy.request('/apis/batch/v1/namespaces/ops-headlamp/cronjobs/beacon-reporter-daily', { isJSON: true });
      const jobSpec = {
        apiVersion: 'batch/v1', kind: 'Job',
        metadata: { name: `beacon-report-${sectionKey}-${Date.now()}`, namespace: 'ops-headlamp', labels: { 'app.kubernetes.io/name': 'beacon', 'app.kubernetes.io/component': 'report-request' }, annotations: { 'beacon/requested-by': email, 'beacon/section': sectionKey } },
        spec: { ...cronJob.spec.jobTemplate.spec, template: { ...cronJob.spec.jobTemplate.spec.template, metadata: { ...(cronJob.spec.jobTemplate.spec.template.metadata ?? {}), labels: { ...(cronJob.spec.jobTemplate.spec.template.metadata?.labels ?? {}), 'app.kubernetes.io/component': 'report-request' } }, spec: { ...cronJob.spec.jobTemplate.spec.template.spec, containers: cronJob.spec.jobTemplate.spec.template.spec.containers.map((c: any) => ({ ...c, env: [...(c.env ?? []).filter((e: any) => !['DAILY_REPORT_RECIPIENTS', 'REPORT_SECTIONS'].includes(e.name)), { name: 'DAILY_REPORT_RECIPIENTS', value: email }, { name: 'REPORT_SECTIONS', value: sectionKey }] })) } } },
      };
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
        {status === 'success' ? (
          <Alert severity="success" sx={{ background: 'rgba(76,175,80,0.12)', color: '#81c784', border: '1px solid rgba(76,175,80,0.3)' }}>Report queued! It will be sent to <strong>{email}</strong> shortly.</Alert>
        ) : (<>
          <Typography variant="body2" sx={{ color: '#888', mb: 3.5, lineHeight: 1.6 }}>A PDF report for the <strong style={{ color: '#fff' }}>{section}</strong> section will be generated and emailed to the address below.</Typography>
          <TextField autoFocus fullWidth size="small" type="email" label="Company email" placeholder={`someone@${companyDomain}`} value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && isValid(email) && !loading) handleSend(); }} disabled={loading} error={emailError} helperText={emailError ? `Only @${companyDomain} addresses are allowed` : `Only company emails allowed. E.g: someone@${companyDomain}`} sx={{ ...darkFieldSx, '& .MuiFormHelperText-root': { color: emailError ? '#ef9a9a' : '#555' } }} />
          {status === 'error' && <Alert severity="error" sx={{ mt: 2, background: 'rgba(244,67,54,0.1)', color: '#ef9a9a', border: '1px solid rgba(244,67,54,0.3)' }}>{errorMsg}</Alert>}
        </>)}
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

  let current = 'loading...';
  let currentError: string | null = null;
  if (depError) { current = 'error'; currentError = `Deployment ${app.currentVersion.namespace}/${app.currentVersion.deployment}: ${String(depError)}`; }
  else if (deployment) {
    const podSpec = deployment.spec?.template?.spec ?? deployment.jsonData?.spec?.template?.spec;
    const containers = podSpec?.containers ?? []; const initContainers = podSpec?.initContainers ?? [];
    let containerSpec: any;
    if (app.currentVersion.initContainer) containerSpec = initContainers.find((c: any) => c.name === app.currentVersion.initContainer);
    else if (app.currentVersion.container) containerSpec = containers.find((c: any) => c.name === app.currentVersion.container);
    else containerSpec = containers[0];
    if (containerSpec?.image) { let tag = extractImageTag(containerSpec.image); if (app.currentVersion.vPrefix && tag !== 'unknown' && tag !== 'latest' && !tag.startsWith('v')) tag = 'v' + tag; current = tag; }
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

interface PageProps { appsConfigMapName: string; versionsConfigMapName: string; pageTitle: string; }
type SortDirection = 'asc' | 'desc';

function BeaconPageContent({ appsConfigMapName, versionsConfigMapName, pageTitle }: PageProps) {
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
  const sortedApps = React.useMemo(() => [...apps].sort((a, b) => { const cmp = a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0; return sortDir === 'asc' ? cmp : -cmp; }), [apps, sortDir]);
  const visibleCount = apps.filter(app => { const statusOk = activeStatusFilters.includes(statusMap[app.name] ?? 'unknown'); const nsOk = activeNsFilters.includes(app.currentVersion.namespace); return statusOk && nsOk; }).length;
  const isFiltered = visibleCount < apps.length && apps.length > 0;

  if (!appsCm && !appsCmError) return (<Box sx={{ p: 3 }}><Typography variant="h5" sx={{ fontWeight: 600, mb: 3 }}>{pageTitle}</Typography><Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box></Box>);
  if (appsCmError) return (<Box sx={{ p: 3 }}><Typography variant="h5" sx={{ fontWeight: 600, mb: 3 }}>{pageTitle}</Typography><Alert severity="error">ConfigMap <code>{appsConfigMapName}</code> not found in namespace <code>ops-headlamp</code>.</Alert></Box>);
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
          {lastUpdate && <Typography variant="caption" sx={{ color: '#888' }}>Latest versions updated: {formatDate(lastUpdate)}</Typography>}

          {/* Send Report — active for Pro, grayed for Free */}
          {isPro ? (
            <Button variant="outlined" size="large" onClick={() => setReportDialogOpen(true)} sx={{ borderColor: 'rgba(245,197,24,0.6)', color: '#f5c518', fontWeight: 700, fontSize: '16px', textTransform: 'none', px: 3.5, py: 1.1, '&:hover': { borderColor: '#f5c518', background: 'rgba(245,197,24,0.12)' } }}>
              📧 Send Report
            </Button>
          ) : (
            <Tooltip title="Send Report is a Pro feature. Upgrade to unlock email reports." arrow>
              <span>
                <Button variant="outlined" size="large" disabled sx={{ borderColor: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.25)', fontWeight: 700, fontSize: '16px', textTransform: 'none', px: 3.5, py: 1.1 }}>
                  🔒 Send Report
                </Button>
              </span>
            </Tooltip>
          )}
        </Box>
      </Box>

      {!versionsCm && <Alert severity="warning" sx={{ mb: 2 }}>Versions cache <code>{versionsConfigMapName}</code> not found. Trigger the updater to populate it.</Alert>}

      <TableContainer sx={{ background: 'transparent' }}>
        <Table>
          <TableHead>
            <TableRow sx={{ borderBottom: '2px solid rgba(255,255,255,0.2)' }}>
              <TableCell sx={{ fontWeight: 600, color: '#fff' }}><TableSortLabel active direction={sortDir} onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')} sx={{ color: '#fff !important', '& .MuiTableSortLabel-icon': { color: '#fff !important' } }}>Application</TableSortLabel></TableCell>
              <TableCell sx={{ fontWeight: 600, color: '#fff' }}><FilterHeader<string> label="Namespace" allOptions={allNamespaces} activeFilters={activeNsFilters} onFiltersChange={setActiveNsFilters} renderOption={ns => ns} getOptionColor={() => '#90caf9'} /></TableCell>
              <TableCell sx={{ fontWeight: 600, color: '#fff' }}>Current Version</TableCell>
              <TableCell sx={{ fontWeight: 600, color: '#fff' }}>Latest Version</TableCell>
              <TableCell sx={{ fontWeight: 600, color: '#fff' }}><FilterHeader<StatusKind> label="Status" allOptions={ALL_STATUS_FILTERS} activeFilters={activeStatusFilters} onFiltersChange={setActiveStatusFilters} renderOption={kind => STATUS_FILTER_LABELS[kind]} getOptionColor={kind => STATUS_STYLES[kind].color} /></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedApps.map(app => {
              const statusOk = activeStatusFilters.includes(statusMap[app.name] ?? 'unknown');
              const nsOk = activeNsFilters.includes(app.currentVersion.namespace);
              const visible = statusOk && nsOk;
              return (<TableRow key={app.name} sx={{ display: visible ? undefined : 'none', '&:hover': { background: 'rgba(255,255,255,0.05)' } }}><AppRowInner app={app} latestVersion={versionsCache.apps?.[app.name] ?? null} cacheError={versionsCache.errors?.[app.name]} onStatusChange={handleStatusChange} /></TableRow>);
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {apps.length === 0 && <Alert severity="info" sx={{ mt: 2 }}>No apps configured. Edit the <code>{appsConfigMapName}</code> ConfigMap to add apps.</Alert>}
      {apps.length > 0 && visibleCount === 0 && <Alert severity="info" sx={{ mt: 2 }}>No apps match the selected filters.</Alert>}

      <SendReportDialog open={reportDialogOpen} onClose={() => setReportDialogOpen(false)} section={pageTitle} companyDomain={companyDomain} />
    </Box>
  );
}

// ─── Settings page (Pro only) ─────────────────────────────────────────────────

function BeaconSettingsPage() {
  const { level: licenseLevel, domain: companyDomain } = useLicenseLevel();
  const isPro = licenseLevel === 'pro' || licenseLevel === 'enterprise';

  // AET: email is configured via beacon-acs-secret — read only, no editing
  const [acsFromAddress, setAcsFromAddress] = useState('');
  const [fromName, setFromName]             = useState('Beacon Monitor — AET');
  const [testEmail, setTestEmail]           = useState('');
  const [loading, setLoading]               = useState(true);
  const [testing, setTesting]               = useState(false);
  const [feedback, setFeedback]             = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // Properly decode base64 K8s secret values containing UTF-8 characters.
  // Plain atob() returns Latin-1 bytes which garble non-ASCII (e.g. em dash → â).
  const decodeSecretValue = (b64: string): string => {
    if (!b64) return '';
    try {
      const bytes = atob(b64);
      return decodeURIComponent(
        bytes.split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
      );
    } catch {
      try { return atob(b64); } catch { return ''; }
    }
  };

  useEffect(() => {
    if (!isPro) { setLoading(false); return; }
    (async () => {
      try {
        const secret = await ApiProxy.request(
          '/api/v1/namespaces/ops-headlamp/secrets/beacon-acs-secret', { isJSON: true }
        ).catch(() => null);
        if (secret?.data) {
          const d = (k: string) => decodeSecretValue(secret.data?.[k] ?? '');
          setAcsFromAddress(d('acs-from-address'));
          setFromName(d('from-name') || 'Beacon Monitor — AET');
        }
      } catch { /* no secret */ } finally { setLoading(false); }
    })();
  }, [isPro]);

  const handleTest = async () => {
    const recipient = testEmail.trim();
    if (!recipient) { setFeedback({ type: 'error', msg: 'Enter a recipient email address.' }); return; }
    if (!recipient.includes('@') || recipient.split('@')[1]?.toLowerCase() !== companyDomain.toLowerCase()) {
      setFeedback({ type: 'error', msg: `Only @${companyDomain} addresses are allowed for testing.` });
      return;
    }
    setTesting(true); setFeedback(null);
    try {
      const cronJob = await ApiProxy.request(
        '/apis/batch/v1/namespaces/ops-headlamp/cronjobs/beacon-reporter-daily', { isJSON: true }
      );
      const jobSpec = {
        apiVersion: 'batch/v1', kind: 'Job',
        metadata: { name: `beacon-test-${Date.now()}`, namespace: 'ops-headlamp',
          labels: { 'app.kubernetes.io/name': 'beacon', 'app.kubernetes.io/component': 'smtp-test' } },
        spec: {
          ...cronJob.spec.jobTemplate.spec, backoffLimit: 0, ttlSecondsAfterFinished: 300,
          template: { ...cronJob.spec.jobTemplate.spec.template, spec: {
            ...cronJob.spec.jobTemplate.spec.template.spec,
            containers: cronJob.spec.jobTemplate.spec.template.spec.containers.map((c: any) => ({
              ...c, env: [
                ...(c.env ?? []).filter((e: any) =>
                  !['DAILY_REPORT_RECIPIENTS','REPORT_SECTIONS','LOG_LEVEL'].includes(e.name)),
                { name: 'DAILY_REPORT_RECIPIENTS', value: recipient },
                { name: 'REPORT_SECTIONS',         value: 'plugins' },
                { name: 'LOG_LEVEL',               value: 'debug' },
              ],
            })),
          }},
        },
      };
      await ApiProxy.request('/apis/batch/v1/namespaces/ops-headlamp/jobs',
        { method: 'POST', body: JSON.stringify(jobSpec), isJSON: true, headers: { 'Content-Type': 'application/json' } });
      setFeedback({ type: 'success', msg: `✅ Test report queued — sending to ${recipient}. Check inbox in ~1 min.` });
    } catch (err: any) {
      setFeedback({ type: 'error', msg: `Test failed: ${err?.message ?? 'Unknown error'}` });
    } finally { setTesting(false); }
  };

  if (!isPro) return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" sx={{ fontWeight: 600, mb: 3 }}>Settings</Typography>
      <Paper sx={{ p: 4, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', textAlign: 'center' }}>
        <Typography variant="h6" sx={{ color: '#888', mb: 1 }}>🔒 Pro Feature</Typography>
        <Typography variant="body2" sx={{ color: '#555' }}>This feature is available in Beacon Pro. Reach out to enable it for your cluster.</Typography>
      </Paper>
    </Box>
  );

  if (loading) return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" sx={{ fontWeight: 600, mb: 3 }}>Settings</Typography>
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
    </Box>
  );

  return (
    <Box sx={{ p: 3, maxWidth: 700 }}>
      <Typography variant="h5" sx={{ fontWeight: 600, mb: 3 }}>Settings</Typography>

      {/* ─── ACS info card — read only ──────────────────────────────────────── */}
      <Paper sx={{ p: 3, mb: 3, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2, color: '#f5c518' }}>📧 Email Configuration</Typography>
        <Alert severity="info" sx={{ background: 'rgba(33,150,243,0.08)', color: '#90caf9', border: '1px solid rgba(33,150,243,0.2)', borderRadius: '8px', mb: 2.5 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '13px', mb: 0.5 }}>☁️ Azure Communication Services</Typography>
          <Typography sx={{ fontSize: '13px', opacity: 0.85 }}>
            Email delivery is configured via a Sealed Secret deployed in the cluster. No changes can be made here.
          </Typography>
          {acsFromAddress && (
            <Typography sx={{ fontSize: '12px', mt: 1, fontFamily: 'monospace', color: '#64b5f6' }}>
              From: {fromName} &lt;{acsFromAddress}&gt;
            </Typography>
          )}
        </Alert>

        {/* SMTP fields — visible but fully disabled */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, opacity: 0.35, pointerEvents: 'none' }}>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField fullWidth size="small" label="SMTP Server" value="Managed via ACS" sx={darkFieldSx} disabled />
            <TextField size="small" label="Port" value="—" sx={{ ...darkFieldSx, width: '120px' }} disabled />
          </Box>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField fullWidth size="small" label="Username" value="Managed via Sealed Secret" sx={darkFieldSx} disabled />
            <TextField fullWidth size="small" label="Password" value="••••••••••••••••" sx={darkFieldSx} disabled />
          </Box>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField fullWidth size="small" label="From Address" value={acsFromAddress || 'Managed via Sealed Secret'} sx={darkFieldSx} disabled />
            <TextField fullWidth size="small" label="From Name" value={fromName} sx={darkFieldSx} disabled />
          </Box>
          <FormControlLabel
            control={<Switch checked={true} disabled
              sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: '#555' }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: '#555' } }} />}
            label={<Typography sx={{ fontSize: '14px', color: '#444' }}>Use TLS (STARTTLS)</Typography>} />
        </Box>
      </Paper>

      {/* ─── Test Connection ────────────────────────────────────────────────── */}
      <Paper sx={{ p: 3, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1, color: '#f5c518' }}>🧪 Test Email Delivery</Typography>
        <Typography variant="body2" sx={{ color: '#666', mb: 2.5 }}>Send a test PDF report to verify the full email pipeline end-to-end.</Typography>
        <TextField fullWidth size="small" label="Send test to" type="email" placeholder="someone@aeteurope.com"
          value={testEmail} onChange={e => { setTestEmail(e.target.value); setFeedback(null); }}
          onKeyDown={e => { if (e.key === 'Enter' && testEmail && !testing) handleTest(); }} sx={darkFieldSx} />
        {feedback && (
          <Alert severity={feedback.type} sx={{ mt: 2, borderRadius: '8px',
            background: feedback.type === 'success' ? 'rgba(76,175,80,0.10)' : 'rgba(244,67,54,0.10)',
            color: feedback.type === 'success' ? '#81c784' : '#ef9a9a',
            border: `1px solid ${feedback.type === 'success' ? 'rgba(76,175,80,0.3)' : 'rgba(244,67,54,0.3)'}` }}>
            {feedback.msg}
          </Alert>
        )}
        <Box sx={{ mt: 2.5 }}>
          <Button variant="outlined" onClick={handleTest} disabled={testing || !testEmail}
            sx={{ borderColor: 'rgba(255,255,255,0.2)', color: '#ccc', fontWeight: 600, textTransform: 'none', px: 3, py: 1,
              '&:hover': { borderColor: '#90caf9', color: '#90caf9' },
              '&:disabled': { borderColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.2)' } }}>
            {testing ? <><CircularProgress size={14} sx={{ color: '#ccc', mr: 1 }} />Sending...</> : 'Test Connection'}
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}

// ─── Pages ────────────────────────────────────────────────────────────────────

function BeaconAppsPage() {
  const { level: licenseLevel } = useLicenseLevel();
  const isPro = licenseLevel === 'pro' || licenseLevel === 'enterprise';

  if (!isPro) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 600, mb: 3 }}>Applications</Typography>
        <Paper sx={{ p: 4, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', textAlign: 'center' }}>
          <Typography variant="h6" sx={{ color: '#888', mb: 1.5 }}>🔒 Pro Feature</Typography>
          <Typography variant="body2" sx={{ color: '#555', maxWidth: 480, mx: 'auto' }}>
            Custom application monitoring requires a Beacon Pro license. Contact support to upgrade.
          </Typography>
        </Paper>
      </Box>
    );
  }

  return <BeaconPageContent appsConfigMapName="beacon-apps-apps" versionsConfigMapName="beacon-apps-versions" pageTitle="Applications" />;
}
function BeaconCorePage() { return <BeaconPageContent appsConfigMapName="beacon-core-apps" versionsConfigMapName="beacon-core-versions" pageTitle="Infrastructure" />; }
function BeaconPluginsPage() { return <BeaconPageContent appsConfigMapName="beacon-plugins-apps" versionsConfigMapName="beacon-plugins-versions" pageTitle="Headlamp Plugins" />; }

// ─── Sidebar & routes ─────────────────────────────────────────────────────────

registerSidebarEntry({ parent: null, name: 'beacon', label: 'Beacon', icon: 'mdi:lighthouse', url: '/beacon/apps' });
registerSidebarEntry({ parent: 'beacon', name: 'beacon-apps',     label: 'Applications',     url: '/beacon/apps'     });
registerSidebarEntry({ parent: 'beacon', name: 'beacon-core',     label: 'Infrastructure',     url: '/beacon/core'     });
registerSidebarEntry({ parent: 'beacon', name: 'beacon-plugins',  label: 'Headlamp Plugins',  url: '/beacon/plugins'  });
registerSidebarEntry({ parent: 'beacon', name: 'beacon-settings', label: 'Settings', url: '/beacon/settings' });

registerRoute({ path: '/beacon/apps',     exact: true, sidebar: 'beacon-apps',     noCluster: true, component: BeaconAppsPage     });
registerRoute({ path: '/beacon/core',     exact: true, sidebar: 'beacon-core',     noCluster: true, component: BeaconCorePage     });
registerRoute({ path: '/beacon/plugins',  exact: true, sidebar: 'beacon-plugins',  noCluster: true, component: BeaconPluginsPage  });
registerRoute({ path: '/beacon/settings', exact: true, sidebar: 'beacon-settings', noCluster: true, component: BeaconSettingsPage });
