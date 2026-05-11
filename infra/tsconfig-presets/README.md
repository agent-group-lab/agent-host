# @infra/tsconfig-presets

## Overview
Shared TypeScript configuration presets for consistent compilation settings across the monorepo.
Provides base configurations for different target environments: Node.js, browsers, libraries

## Import
```json
{
  "extends": "@infra/tsconfig-presets/base.json"
}
```

## Core API

### Available Presets

#### `base.json` - Foundation Configuration
```json
{
  "extends": "@infra/tsconfig-presets/base.json"
}
```
- **Strict mode**: All strict type checking enabled
- **Modern features**: ES module interop, synthetic defaults
- **Development**: Source maps, declarations, declaration maps
- **Quality**: No unused locals/parameters, no implicit returns

#### `lib.cjs.json` - CommonJS Libraries
```json
{
  "extends": "@infra/tsconfig-presets/lib.cjs.json"
}
```
- **Module**: CommonJS output format
- **Target**: ESNext for modern Node.js environments

#### `lib.esm.json` - ES Module Libraries  
```json
{
  "extends": "@infra/tsconfig-presets/lib.esm.json"
}
```
- **Module**: ESNext with bundler resolution
- **Target**: ESNext for modern bundlers/browsers


### Configuration Features

- **Consistent strictness**: All presets inherit strict type checking
- **Source maps**: Development debugging support
- **Declaration files**: Type definition generation
- **Module interop**: Cross-module system compatibility
- **Incremental builds**: Faster development cycles

## Integration Patterns

### Shared Libraries
```json
// common/utils/tsconfig.json
{
  "extends": "@infra/tsconfig-presets/lib.esm.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
```

### Workspace References
```json
{
  "extends": "@infra/tsconfig-presets/base.json"
}
```

## Commands
```bash
# Type check with preset
tsc --noEmit

# Build with preset configuration  
tsc --build

# Watch mode development
tsc --watch
```

## Preset Hierarchy
```
base.json (foundation)
├── lib.cjs.json (CommonJS libraries)
└── lib.esm.json (ES module apps)
```

Each preset extends the base configuration and adds environment-specific optimizations while maintaining consistent type safety and development experience across the monorepo.