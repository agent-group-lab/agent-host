# @infra/dep-presets

## Overview
Dependency cruiser configuration presets for enforcing architecture boundaries and dependency rules across the monorepo.
Provides validation rules for circular dependencies, deprecated packages, orphaned modules, and package.json compliance.

## Import
```javascript
// In .dependency-cruiser.mjs
import defaultConfig from '@infra/dep-presets/default.mjs';

export default {
  ...defaultConfig,
  // Override or extend rules
};
```

## Core API

### Main Export: `defaultConfig`
```javascript
import defaultConfig, { merge } from '@infra/dep-presets/default.mjs';

// Use default configuration
export default defaultConfig;

// Merge with custom rules
export default merge(defaultConfig, {
  forbidden: [...customRules]
});
```

### Built-in Validation Rules

#### `no-circular` - Circular Dependency Detection
```javascript
{
  name: 'no-circular',
  severity: 'warn',
  from: {},
  to: { circular: true }
}
```
- **Detects**: Circular import chains between modules
- **Action**: Warns about potential architectural issues

#### `no-orphans` - Unused Module Detection  
```javascript
{
  name: 'no-orphans', 
  severity: 'warn',
  from: { 
    orphan: true,
    pathNot: ['(^|/)[.][^/]+[.](?:js|cjs|mjs|ts|cts|mts|json)$']
  }
}
```
- **Detects**: Modules not imported by any other module
- **Excludes**: Config files, dot files, TypeScript declarations

#### `no-deprecated-core` - Node.js Core Module Warnings
```javascript
{
  name: 'no-deprecated-core',
  severity: 'warn', 
  to: {
    dependencyTypes: ['core'],
    path: ['^punycode$', '^domain$', '^constants$']
  }
}
```
- **Detects**: Usage of deprecated Node.js core modules
- **Examples**: `punycode`, `domain`, `constants`, `sys`

#### `not-to-deprecated` - NPM Package Warnings
```javascript
{
  name: 'not-to-deprecated',
  severity: 'warn',
  to: { dependencyTypes: ['deprecated'] }
}
```
- **Detects**: Dependencies on deprecated NPM packages
- **Action**: Suggests upgrading or finding alternatives

#### `no-non-package-json` - Missing Dependencies
```javascript
{
  name: 'no-non-package-json',
  severity: 'error',
  to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] }
}
```
- **Detects**: Imports not declared in package.json dependencies
- **Severity**: Error (blocks builds)

### Configuration Options

#### Module Resolution
- **TypeScript**: Uses `tsconfig.json` for path resolution
- **Extensions**: Supports `.js`, `.ts`, `.mjs`, `.cjs`, `.json`
- **Node Modules**: Resolves from `node_modules` directories

#### Exclude Patterns
```javascript
exclude: {
  path: [
    'node_modules',
    'dist',
    'build',
    'coverage'
  ]
}
```

## Integration Patterns

### Monorepo Validation
```bash
# Run dependency validation
pnpm run check:deps

# Check specific package
dependency-cruiser --config .dependency-cruiser.mjs src/
```

### CI/CD Pipeline
```yaml
# .github/workflows/validation.yml
- name: Validate Architecture
  run: |
    pnpm run check:deps
    dependency-cruiser --config .dependency-cruiser.mjs --output-type err
```

### Custom Rules Extension
```javascript
// .dependency-cruiser.mjs
import defaultConfig from '@infra/dep-presets/default.mjs';
import merge from 'lodash.merge';

export default merge(defaultConfig, {
  forbidden: [
    {
      name: 'no-server-to-client',
      from: { path: '^servers/' },
      to: { path: '^projects/' },
      comment: 'Server code should not depend on client code'
    }
  ]
});
```

### Package-Specific Rules
```javascript
// servers/user-center/.dependency-cruiser.mjs
import baseConfig from '@infra/dep-presets/default.mjs';

export default {
  ...baseConfig,
  forbidden: [
    ...baseConfig.forbidden,
    {
      name: 'no-nest-to-react',
      from: { path: '.' },
      to: { path: 'react' },
      comment: 'NestJS services should not import React'
    }
  ]
};
```

## Commands
```bash
# Validate all dependencies
dependency-cruiser --config .dependency-cruiser.mjs src/

# Generate dependency graph
dependency-cruiser --config .dependency-cruiser.mjs --output-type dot src/ | dot -T svg > deps.svg

# Output validation errors only
dependency-cruiser --config .dependency-cruiser.mjs --output-type err src/

# Focus on specific rules
dependency-cruiser --config .dependency-cruiser.mjs --focus "^src/" src/
```

## Architecture Enforcement

The preset enforces clean architecture by:
- **Preventing cycles**: Ensures unidirectional dependency flow
- **Validating boundaries**: Blocks inappropriate cross-layer dependencies  
- **Package compliance**: Ensures all imports are properly declared
- **Security**: Warns about deprecated/vulnerable dependencies
- **Code hygiene**: Identifies unused/orphaned modules

This configuration maintains architectural integrity across the entire monorepo while providing flexibility for package-specific customizations.