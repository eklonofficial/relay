// Static-host compatible defense in depth. Run via stamp.mjs before publishing;
// --check in CI catches inline-script edits without corresponding CSP hash updates.
// The policy itself and the shared calculator/vercel.json sync live in docs/games/tools/security.mjs.
import { dirname } from 'node:path';
import { syncPages, syncSite, report } from '../../tools/security.mjs';
export { scriptHashes, policy } from '../../tools/security.mjs';

export function syncSecurity(root, check = false) {
  const { changes } = syncPages(root, ['index.html'], check);
  changes.push(...syncSite(dirname(root), check));
  return report(changes, check);
}
