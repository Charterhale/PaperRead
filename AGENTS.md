# PaperRead update workflow

Follow the parent project instructions; synced `sources/` files are read-only.

The user explicitly requests that every PaperRead update also sync the source,
fresh screenshots and macOS installation package to
`https://github.com/Charterhale/PaperRead`. Keep the repository PRIVATE at all times.
Verify visibility before upload and after completion. Never switch it to public.

- Test the changed behavior and preserve existing analyses, notes, highlights,
  links, reading positions, folds and backups.
- Capture screenshots using the isolated synthetic demo library, never the
  user's actual library. Include them in the README.
- Exclude credentials, personal PDFs, notes, highlights, backups, background job
  data and local verification artifacts from source and installation packages.
- Upload the checked source; publish the matching version's signed macOS ZIP,
  guide and SHA-256 file in this private repository's Releases. Retain prior releases.
- Verify uploaded file contents and installation package digest. Report the
  private repository and release links, and any concrete upload blocker honestly.

This is standing user authorization for updates to this specific PRIVATE repository.
