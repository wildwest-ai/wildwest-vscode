# Telegraph Memo

**To:** CD(RSn).Cpt  
**From:** TM(RHk).Cpt  
**Date:** 20260505-1923z  
**Re:** Bugfix — Status bar not showing county scope

---

## Issue

Status bar was not displaying scope when workspace is in county scope (or territory scope walking up from subdirectories).

**Root cause:** `detectScope()` only checked the primary workspace folder directly, without walking up the directory tree to find registry.json in parent directories.

## Fix

**Commit: 894c37e**
- Enhanced `detectScope()` to walk up directory tree like `walkUpForScope()`
- Now checks primary folder first, then walks up to find any Wild West scope
- Catches town, county, and territory scopes at any nesting level

**Commit: 032d023**
- Added 5-second periodic refresh to StatusBar
- Ensures display updates even if scope configuration changes at filesystem level
- Complements walk-up logic

## Testing

Status bar will now display:
- ✓ County scope: `○ County` or `● <actor> · County`
- ✓ Territory scope: `○ Territory` or `● <actor> · Territory`  
- ✓ Town scope: `○ Town` or `● <actor> · Town`

---

Bugfixes committed to main.

TM(RHk).Cpt
