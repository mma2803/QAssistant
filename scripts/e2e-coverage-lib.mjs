import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const methodNames = {
  Get: 'GET',
  Post: 'POST',
  Patch: 'PATCH',
  Put: 'PUT',
  Delete: 'DELETE',
};

function controllerFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return controllerFiles(path);
    return entry.name.endsWith('.controller.ts') ? [path] : [];
  });
}

function cleanPath(parts) {
  return parts
    .filter(Boolean)
    .join('/')
    .replace(/\/+/, '/')
    .replace(/^\/+|\/+$/g, '');
}

export function inventoryApiRoutes(apiSourceDir) {
  const routes = [];
  for (const file of controllerFiles(apiSourceDir)) {
    const source = readFileSync(file, 'utf8');
    const controller = source.match(/@Controller\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/);
    const base = controller?.[1] ?? '';
    const routePattern = /@(Get|Post|Patch|Put|Delete)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/g;
    for (const match of source.matchAll(routePattern)) {
      const relative = cleanPath([base, match[2] ?? '']);
      const path = relative === 'health' ? '/health' : `/api/v1/${relative}`;
      routes.push({
        method: methodNames[match[1]],
        path: path.replace(/\/$/, ''),
        source: file,
      });
    }
  }
  return routes.sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
}

export function routeWasRequested(route, requests) {
  const escaped = route.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped.replace(/:[^/]+/g, '[^/]+')}$`);
  return requests.some((request) => request.method === route.method && pattern.test(request.path));
}
