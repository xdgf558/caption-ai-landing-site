import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const gateIds = ['exact-head-ci', 'production-schema', 'production-backup', 'real-promotion-rights', 'production-build',
  'production-route-contract', 'performance', 'devices-accessibility', 'compatible-rollback-monitoring', 'production-authorization'];
const requireCondition = (condition, code) => { if (!condition) throw new Error('STATION_RELEASE_' + code); };
// A review/checklist reader, never a deployment authorizer. Updating this file
// cannot grant permission or establish remote facts; each evidence needs review.
export function assessReleaseReadiness(status) {
  requireCondition(status?.task === 'T22' && typeof status.productionDeployed === 'boolean' && typeof status.legacyClosureVerified === 'boolean', 'STATUS');
  requireCondition(Array.isArray(status.gates) && status.gates.length === gateIds.length &&
    new Set(status.gates.map(row => row.id)).size === gateIds.length && status.gates.every(row => gateIds.includes(row.id)), 'GATE_SET');
  for (const gate of status.gates) {
    requireCondition(['pending', 'failed', 'passed'].includes(gate.status) && typeof gate.reason === 'string' && Array.isArray(gate.evidence), 'GATE');
    requireCondition(gate.evidence.every(value => typeof value === 'string' && value.length > 0) &&
      (gate.status !== 'passed' || gate.evidence.length > 0), 'EVIDENCE');
  }
  const unsatisfied = status.gates.filter(row => row.status !== 'passed').map(row => row.id);
  return { launchReady: unsatisfied.length === 0, productionDeployed: status.productionDeployed,
    legacyClosureVerified: status.legacyClosureVerified, unsatisfied, authority: 'review checklist only; separate execution authorization required' };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  requireCondition(args.length === 0 || (args.length === 1 && args[0] === '--require-ready'), 'ARGUMENTS');
  const result = assessReleaseReadiness(JSON.parse(await readFile(new URL('../ops/station-release-readiness.json', import.meta.url))));
  console.log(JSON.stringify(result, null, 2));
  if (args.length && !result.launchReady) process.exitCode = 2;
}
