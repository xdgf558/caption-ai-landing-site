# Signal XML Parser Supply-Chain Audit

Date: 2026-07-17

## Scope

Signal automation phase 2 parses RSS and Atom feeds with `fast-xml-parser` 5.10.1. This review covers the complete production dependency closure reachable from that package, including packages whose names are less familiar.

## Registry And Publisher Review

The exact versions below were checked against the official npm registry. All eight packages list `amitgupta <amitgupta.gwl@gmail.com>` as their npm maintainer and Amit Gupta as their packaged author. Their source repositories are under the NaturalIntelligence organization, except `@nodable/entities`, which points to the related nodable repository.

| Package | Version | Source repository |
| --- | ---: | --- |
| `fast-xml-parser` | 5.10.1 | `NaturalIntelligence/fast-xml-parser` |
| `@nodable/entities` | 3.0.0 | `nodable/val-parsers` |
| `fast-xml-builder` | 1.3.0 | `NaturalIntelligence/fast-xml-builder` |
| `is-unsafe` | 2.0.0 | `NaturalIntelligence/is-unsafe` |
| `path-expression-matcher` | 1.6.2 | `NaturalIntelligence/path-expression-matcher` |
| `strnum` | 2.4.1 | `NaturalIntelligence/strnum` |
| `xml-naming` | 0.3.0 | `NaturalIntelligence/xml-naming` |
| `anynum` | 1.0.1 | `NaturalIntelligence/anynum` |

The lockfile resolves every package from `https://registry.npmjs.org/` and records a SHA-512 integrity value. The primary parser release also exposes npm provenance using the SLSA provenance predicate.

## Installed Content Review

- The eight packages contain JavaScript/TypeScript source, type declarations, source maps, package metadata, documentation, and license files.
- No native libraries or Windows/macOS executables were found.
- No package declares `preinstall`, `install`, or `postinstall` lifecycle scripts.
- `fast-xml-parser` exposes one expected JavaScript CLI entry, `fxparser`; no transitive package exposes a command.
- Every package declares the MIT license.

`npm audit signatures` reported 288 verified registry signatures and 44 verified attestations for the installed dependency tree. `npm audit --omit=dev` reported no advisory affecting this XML parser closure. The repository still has unrelated pre-existing Astro/Vite/esbuild advisories; those were not introduced by Signal phase 2 and require a separate framework-upgrade review.

## Ongoing Enforcement

`npm run audit:xml-supply-chain` runs as part of the normal test suite. It fails if:

- the parser or any transitive package changes version or integrity hash;
- the complete dependency closure gains or loses a package;
- a package stops resolving from the official npm registry;
- repository, author, license, command entry, or install lifecycle metadata changes;
- an installed package adds a native executable, library, shell script, or symbolic link.

Any parser upgrade must deliberately update the allowlist after repeating this review.

## Decision

Keep the exact 5.10.1 pin and the audited dependency closure for phase 2. Vendoring a partial RSS/Atom parser is not justified at this point: it would transfer parser correctness and security maintenance into this repository. Reconsider vendoring or replacing the parser if a future release adds an unexplained maintainer, install script, native payload, or unnecessary dependency.

## Reproduction

```sh
npm run audit:xml-supply-chain
npm audit signatures
npm audit --omit=dev
```
