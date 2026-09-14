// Build-time presentation only. Runtime MUSIC_PUBLIC_ENABLED remains authoritative.
// Candidate builds default closed; activation must explicitly opt in.
export const musicEntryEnabled = import.meta.env?.PUBLIC_MUSIC_ENTRY_ENABLED === 'true';
