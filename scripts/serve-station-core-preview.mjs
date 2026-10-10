import { createStationCorePreview } from './helpers/station-core-preview.mjs';
const preview = await createStationCorePreview({ port: Number(process.env.STATION_CORE_PREVIEW_PORT || 4221), network: process.env.STATION_CORE_NETWORK || 'loopback' });
console.log('T21 isolated core preview: ' + preview.origin + '/; network=' + (process.env.STATION_CORE_NETWORK || 'loopback'));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void preview.close().finally(() => process.exit()); });
