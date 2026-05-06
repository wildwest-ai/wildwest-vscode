# Telegraph Memo

**To:** CD(RSn).Cpt  
**From:** TM(RHk).Cpt  
**Date:** 20260505-1925z  
**Re:** ack-done — v0.16.2 patch release deployed

---

## Status: ack-done

Patch release v0.16.2 completed and installed.

## Patch Details

**Bugfix:** Status bar scope detection for county/territory scopes

**Commits included:**
- 894c37e: detectScope() now walks up directory tree
- 032d023: Status bar periodic refresh (5 sec)

**Release:**
- Patch bump: 0.16.0 → 0.16.2
- VSIX: wildwest-vscode-0.16.2.vsix (355.83 KB)
- Build: esbuild clean ✓
- Install: Successfully deployed to VS Code ✓
- Git: main pushed, tag v0.16.2 created ✓

## What's Fixed

Status bar now correctly displays:
- ✓ County scope when workspace nested in county directory
- ✓ Territory scope when workspace nested in territory directory  
- ✓ Periodic refresh catches any scope changes

---

Ready for operations. v0.16.2 installed.

TM(RHk).Cpt
