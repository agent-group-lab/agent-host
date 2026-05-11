# @infra/toolkit

## Overview
Node.js CLI utilities for dependency management and package.json updates across the monorepo.
Provides automated dependency checking, updating, and version synchronization tools.

## Import
```bash
# CLI usage via bin
npx ncu [--write] [--auto]

# Or via pnpm scripts
pnpm run ncu
pnpm run ncu:write
pnpm run ncu:auto
```

## Core API

### `ncu` CLI Command
```bash
# Check for outdated dependencies (dry run)
ncu

# Update package.json files with new versions
ncu --write

# Auto-update ncu.json and package.json files
ncu --auto
```

### Main Functions

#### `checkUpdatePckJson({ isWrite })`
- **Purpose**: Validates dependency versions across workspace packages against ncu.json
- **Parameters**: `isWrite: boolean` - whether to write updates to package.json
- **Checks**: Version conflicts between dependencies and devDependencies

#### `autoUpdateNcu()`
- **Purpose**: Automatically updates ncu.json with latest available package versions
- **Behavior**: Fetches latest versions and writes to ncu.json

#### `readPackages()`
- **Purpose**: Reads all package.json files in the monorepo workspace
- **Returns**: Array of package metadata with paths and parsed JSON content

### Key Features

- **Version Conflict Detection**: Identifies mismatched versions between deps and devDeps
- **Workspace Scanning**: Automatically discovers all packages in the monorepo
- **Batch Updates**: Updates multiple package.json files simultaneously
- **Validation**: Ensures version consistency across the workspace

## Integration Patterns

### With Git Hooks (Lefthook)
```bash
# Automatically run on commits
pre-commit:
  - pnpm run ncu:auto
```

### With CI/CD Pipeline
```bash
# Check for dependency issues
- name: Validate dependencies
  run: pnpm run ncu
```

### Manual Dependency Updates
```bash
# 1. Check what needs updating
pnpm run ncu

# 2. Update all packages
pnpm run ncu:write

# 3. Auto-sync with latest versions
pnpm run ncu:auto
```

## Commands
```bash
# Install dependencies
pnpm install

# Run dependency check
pnpm run ncu

# Update package.json files
pnpm run ncu:write

# Auto-update with latest versions
pnpm run ncu:auto

# Clean node_modules
pnpm run clean
```

## File Structure
```
infra/toolkit/
├── ncu.js              # Main CLI entry point
├── check-update-pckjson.js  # Package validation logic
├── auto-update-ncu.js  # Auto-update functionality  
├── utils.js            # Shared utilities
└── package.json        # Package configuration
```

The toolkit ensures dependency consistency across the entire monorepo workspace by centralizing version management and providing automated validation tools.