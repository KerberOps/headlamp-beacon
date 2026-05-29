#!/usr/bin/env python3
"""
Beacon Updater.

Reads the apps to monitor from ConfigMaps (three categories: plugins, core, apps),
fetches the latest version for each from its configured source (GitHub releases/tags or GHCR container tags),
and writes the results to cache ConfigMaps consumed by the Headlamp plugin.

Designed to be idempotent: failures for individual apps are recorded under
`errors` instead of failing the whole run. Structured logs are emitted per the SRE Standard.
"""
from __future__ import annotations

import json
import logging
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Callable

from kubernetes import client, config
from kubernetes.client.rest import ApiException

logging.basicConfig(
    level=logging.INFO,
    format='ts=%(asctime)s level=%(levelname)s component=updater msg="%(message)s"',
    datefmt='%Y-%m-%dT%H:%M:%S%z',
)
log = logging.getLogger('beacon-updater')

NAMESPACE = os.environ.get('NAMESPACE', 'ops-headlamp')
GITHUB_TOKEN = os.environ.get('GITHUB_TOKEN', '').strip()
HTTP_TIMEOUT = int(os.environ.get('HTTP_TIMEOUT', '15'))

CATEGORIES = [
    {
        'name': 'plugins',
        'apps_cm': os.environ.get('PLUGINS_APPS_CM', 'beacon-plugins-apps'),
        'versions_cm': os.environ.get('PLUGINS_VERSIONS_CM', 'beacon-plugins-versions'),
    },
    {
        'name': 'core',
        'apps_cm': os.environ.get('CORE_APPS_CM', 'beacon-core-apps'),
        'versions_cm': os.environ.get('CORE_VERSIONS_CM', 'beacon-core-versions'),
    },
    {
        'name': 'apps',
        'apps_cm': os.environ.get('APPS_APPS_CM', 'beacon-apps-apps'),
        'versions_cm': os.environ.get('APPS_VERSIONS_CM', 'beacon-apps-versions'),
    },
]

SEMVER_RE = re.compile(r'^v?(\d+)\.(\d+)\.(\d+)')


def http_get_json(url: str, extra_headers: dict | None = None) -> object:
    """Fetch JSON from a URL, adding GitHub auth headers when applicable."""
    headers = {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'beacon-updater/1.0',
    }
    if extra_headers:
        headers.update(extra_headers)
    if GITHUB_TOKEN and 'api.github.com' in url:
        headers['Authorization'] = f'Bearer {GITHUB_TOKEN}'
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
        return json.loads(resp.read())


def fetch_github_release(source: dict) -> str:
    """Return the tag_name of the repo's latest release."""
    repo = source.get('repo')
    if not repo:
        raise ValueError('github-release requires "repo" field')
    url = f'https://api.github.com/repos/{repo}/releases/latest'
    data = http_get_json(url)
    return data['tag_name']


def fetch_github_tag(source: dict) -> str:
    """Return the latest tag matching the repo and optional tagPrefix."""
    repo = source.get('repo')
    if not repo:
        raise ValueError('github-tag requires "repo" field')
    tag_prefix = source.get('tagPrefix', '')
    strip_prefix = source.get('stripPrefix', True)

    url = f'https://api.github.com/repos/{repo}/tags?per_page=100'
    data = http_get_json(url)

    tags = [t['name'] for t in data if t['name'].startswith(tag_prefix)]
    if not tags:
        raise ValueError(f'no tags matched prefix={tag_prefix!r}')

    # Sort by semver descending
    def semver_tuple(tag: str) -> tuple:
        m = SEMVER_RE.search(tag)
        if not m:
            return (0, 0, 0)
        return tuple(map(int, m.groups()))

    tags.sort(key=semver_tuple, reverse=True)
    tag = tags[0]
    if strip_prefix and tag.startswith(tag_prefix):
        return tag[len(tag_prefix):]
    return tag


def fetch_ghcr_tag(source: dict) -> str:
    """Return the latest tag of a GHCR container image."""
    image = source.get('image')
    if not image:
        raise ValueError('ghcr-tag requires "image" field')
    tag_prefix = source.get('tagPrefix', 'v')
    strip_prefix = source.get('stripPrefix', False)

    # Get anonymous token
    token_url = 'https://ghcr.io/token?service=ghcr.io&scope=repository:' + image + ':pull'
    try:
        token_data = http_get_json(token_url)
        token = token_data['token']
    except Exception as e:
        raise ValueError(f'failed to get GHCR token: {e}')

    # List tags
    headers = {'Authorization': f'Bearer {token}'}
    tags_url = f'https://ghcr.io/v2/{image}/tags/list'
    try:
        tags_data = http_get_json(tags_url, extra_headers=headers)
        tags = tags_data.get('tags', [])
    except Exception as e:
        raise ValueError(f'failed to list GHCR tags: {e}')

    if not tags:
        raise ValueError('no tags found')

    # Filter by prefix
    tags = [t for t in tags if t.startswith(tag_prefix)]
    if not tags:
        raise ValueError(f'no semver tags matched prefix={tag_prefix!r}')

    # Sort by semver descending
    def semver_tuple(tag: str) -> tuple:
        m = SEMVER_RE.search(tag)
        if not m:
            return (0, 0, 0)
        return tuple(map(int, m.groups()))

    tags.sort(key=semver_tuple, reverse=True)
    tag = tags[0]
    if strip_prefix and tag.startswith(tag_prefix):
        return tag[len(tag_prefix):]
    return tag


def fetch_manual(source: dict) -> str:
    """Return a manually specified version string."""
    value = source.get('value')
    if not value:
        raise ValueError('manual requires "value" field')
    return value


def fetch_dockerhub_tag(source: dict) -> str:
    """Return the latest tag of a Docker Hub image matching an optional suffix.

    Queries the 100 most-recently-updated tags and picks the highest semver
    among those ending with tagSuffix (e.g. "-alpine").
    Works for both official images (e.g. "redis") and user images ("user/image").
    """
    image = source.get('image')
    if not image:
        raise ValueError('dockerhub-tag requires "image" field')
    tag_suffix = source.get('tagSuffix', '')

    # Official images live under library/
    repo = image if '/' in image else f'library/{image}'
    url = f'https://hub.docker.com/v2/repositories/{repo}/tags?page_size=100&ordering=last_updated'

    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'beacon-updater/1.0'})
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
            data = json.loads(resp.read())
        tags = [t['name'] for t in data.get('results', [])]
    except Exception as e:
        raise ValueError(f'Docker Hub tag list failed for {image}: {e}')

    if not tags:
        raise ValueError(f'no tags found for {image}')

    if tag_suffix:
        tags = [t for t in tags if t.endswith(tag_suffix)]
        if not tags:
            raise ValueError(f'no tags matched suffix={tag_suffix!r} for {image}')

    def semver_tuple(tag: str) -> tuple:
        m = SEMVER_RE.search(tag)
        if not m:
            return (0, 0, 0)
        return tuple(map(int, m.groups()))

    tags.sort(key=semver_tuple, reverse=True)
    return tags[0]


def fetch_acr_tag(source: dict) -> str:
    """Return the latest tag of an Azure Container Registry image.

    Auth flow: IMDS (node MSI / Workload Identity) → ACR OAuth2 token exchange.
    The node's kubelet managed identity has AcrPull when ACR is attached to AKS.
    """
    registry = source.get('registry')
    repo = source.get('repo')
    if not registry or not repo:
        raise ValueError('acr-tag requires "registry" and "repo" fields')
    tag_prefix = source.get('tagPrefix', '')
    strip_prefix = source.get('stripPrefix', False)

    # Step 1: get Azure AD token from IMDS (node MSI)
    imds_url = (
        'http://169.254.169.254/metadata/identity/oauth2/token'
        '?api-version=2018-02-01'
        '&resource=https%3A%2F%2Fcontainerregistry.azure.net'
    )
    try:
        req = urllib.request.Request(imds_url, headers={'Metadata': 'true', 'User-Agent': 'beacon-updater/1.0'})
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
            aad_token = json.loads(resp.read())['access_token']
    except Exception as e:
        raise ValueError(f'IMDS token fetch failed: {e}')

    # Step 2: exchange AAD token for ACR refresh token
    exchange_body = urllib.parse.urlencode({
        'grant_type': 'access_token',
        'service': registry,
        'access_token': aad_token,
    }).encode()
    try:
        req = urllib.request.Request(
            f'https://{registry}/oauth2/exchange',
            data=exchange_body,
            headers={'Content-Type': 'application/x-www-form-urlencoded'},
        )
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
            acr_refresh_token = json.loads(resp.read())['refresh_token']
    except Exception as e:
        raise ValueError(f'ACR token exchange failed: {e}')

    # Step 3: get scoped ACR access token for metadata_read
    token_body = urllib.parse.urlencode({
        'grant_type': 'refresh_token',
        'service': registry,
        'scope': f'repository:{repo}:metadata_read',
        'refresh_token': acr_refresh_token,
    }).encode()
    try:
        req = urllib.request.Request(
            f'https://{registry}/oauth2/token',
            data=token_body,
            headers={'Content-Type': 'application/x-www-form-urlencoded'},
        )
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
            acr_access_token = json.loads(resp.read())['access_token']
    except Exception as e:
        raise ValueError(f'ACR scoped token failed: {e}')

    # Step 4: list tags ordered by time descending
    tags_url = f'https://{registry}/acr/v1/{repo}/_tags?orderby=timedesc&n=50&detail=false'
    try:
        req = urllib.request.Request(tags_url, headers={'Authorization': f'Bearer {acr_access_token}'})
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
            tags = [t['name'] for t in json.loads(resp.read()).get('tags', [])]
    except Exception as e:
        raise ValueError(f'ACR tag list failed for {registry}/{repo}: {e}')

    if not tags:
        raise ValueError(f'no tags found in {registry}/{repo}')

    if tag_prefix:
        tags = [t for t in tags if t.startswith(tag_prefix)]
        if not tags:
            raise ValueError(f'no tags matched prefix={tag_prefix!r} in {registry}/{repo}')

    def semver_tuple(tag: str) -> tuple:
        m = SEMVER_RE.search(tag)
        if not m:
            return (0, 0, 0)
        return tuple(map(int, m.groups()))

    tags.sort(key=semver_tuple, reverse=True)
    tag = tags[0]
    if strip_prefix and tag_prefix and tag.startswith(tag_prefix):
        return tag[len(tag_prefix):]
    return tag


FETCHERS: dict[str, Callable[[dict], str]] = {
    'github-release': fetch_github_release,
    'github-tag': fetch_github_tag,
    'ghcr-tag': fetch_ghcr_tag,
    'acr-tag': fetch_acr_tag,
    'dockerhub-tag': fetch_dockerhub_tag,
    'manual': fetch_manual,
}


def process_category(category: dict) -> tuple[dict[str, str], dict[str, str]]:
    """Process one category: read apps, fetch versions, return (apps_dict, errors_dict)."""
    category_name = category['name']
    apps_cm_name = category['apps_cm']
    versions_cm_name = category['versions_cm']

    config.load_incluster_config()
    v1 = client.CoreV1Api()

    # Read apps ConfigMap
    try:
        cm = v1.read_namespaced_config_map(apps_cm_name, NAMESPACE)
    except ApiException as e:
        log.error(f'failed to read {apps_cm_name}: {e.reason}')
        return {}, {}

    apps_data = cm.data.get('apps.json', '[]')
    try:
        apps = json.loads(apps_data)
    except json.JSONDecodeError as e:
        log.error(f'failed to parse {apps_cm_name}/apps.json: {e}')
        return {}, {}

    log.info(f'loaded {category_name} apps count={len(apps)}')

    versions_dict: dict[str, str] = {}
    errors_dict: dict[str, str] = {}

    # Fetch versions
    for app in apps:
        app_name = app.get('name')
        if not app_name:
            continue

        source_spec = app.get('latestVersion', {})
        source_type = source_spec.get('type', 'manual')

        try:
            fetcher = FETCHERS.get(source_type)
            if not fetcher:
                raise ValueError(f'unknown source type: {source_type}')
            version = fetcher(source_spec)
            versions_dict[app_name] = version
            log.info(f'fetched app="{app_name}" version="{version}"')
        except Exception as e:
            errors_dict[app_name] = str(e)
            log.warning(f'fetch failed app="{app_name}" error="{e}"')

    return versions_dict, errors_dict


def main():
    """Main entry point: process all three categories."""
    config.load_incluster_config()
    v1 = client.CoreV1Api()

    try:
        all_success = 0
        all_errors = 0

        for category in CATEGORIES:
            versions_dict, errors_dict = process_category(category)
            all_success += len(versions_dict)
            all_errors += len(errors_dict)

            versions_cm_name = category['versions_cm']
            now = datetime.now(timezone.utc).isoformat()

            body = client.V1ConfigMap(
                api_version='v1',
                kind='ConfigMap',
                metadata=client.V1ObjectMeta(
                    name=versions_cm_name,
                    namespace=NAMESPACE,
                    labels={
                        'app.kubernetes.io/name': 'beacon',
                        'app.kubernetes.io/component': 'updater',
                    },
                ),
                data={
                    'versions.json': json.dumps({
                        'lastUpdate': now,
                        'apps': versions_dict,
                        'errors': errors_dict if errors_dict else None,
                    })
                },
            )

            try:
                v1.read_namespaced_config_map(versions_cm_name, NAMESPACE)
                v1.patch_namespaced_config_map(versions_cm_name, NAMESPACE, body)
                log.info(f'updated configmap name={versions_cm_name}')
            except ApiException:
                v1.create_namespaced_config_map(NAMESPACE, body)
                log.info(f'created configmap name={versions_cm_name}')

        log.info(f'done success={all_success} errors={all_errors}')
        return 0

    except Exception as e:
        log.error(f'fatal error: {e}', exc_info=True)
        return 1


if __name__ == '__main__':
    sys.exit(main())
