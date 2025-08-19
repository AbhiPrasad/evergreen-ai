# Dependency Analysis Agent

A comprehensive AI agent that analyzes JavaScript/TypeScript codebases to identify dependency usage patterns, security concerns, and optimization opportunities.

## Features

### 🔍 **Comprehensive Dependency Analysis**
- **Import Pattern Detection**: Identifies all types of imports (ES6, CommonJS, dynamic imports, type-only imports)
- **Usage Pattern Analysis**: Tracks how dependencies are used across your codebase
- **Dependency Classification**: Categorizes dependencies as direct, transitive, dev, or peer dependencies
- **Package Manager Integration**: Works with npm, yarn, and pnpm

### 🚨 **Security & Risk Assessment**
- **Criticality Rating**: Assigns HIGH/MEDIUM/LOW criticality ratings to dependencies
- **Security Vulnerability Detection**: Identifies potentially vulnerable packages
- **Transitive Dependency Analysis**: Uses package manager commands (`yarn why`, `npm ls`, `pnpm why`) to understand dependency trees

### 📊 **Performance Optimization**
- **Bundle Size Impact**: Identifies heavy dependencies affecting bundle size
- **Tree-shaking Opportunities**: Finds unused imports and dead code
- **Dynamic Import Recommendations**: Suggests opportunities for code splitting

### 🎯 **Actionable Recommendations**
- **Immediate Actions**: Critical issues requiring immediate attention
- **Short-term Improvements**: Optimizations for next sprint/release
- **Long-term Architecture**: Strategic improvements for technical debt

## Usage

### Basic Analysis

```typescript
import { dependencyAnalysisAgent } from '@sentry/evergreen-ai-agents';

const result = await dependencyAnalysisAgent.text({
  messages: [
    {
      role: 'user',
      content: `Please analyze the dependencies in my project and provide:
      1. Security vulnerability assessment
      2. Bundle size optimization opportunities  
      3. Recommendations for improving dependency management
      
      Focus on actionable insights I can implement immediately.`
    }
  ]
});

console.log(result);
```

### Security-Focused Analysis

```typescript
const securityAnalysis = await dependencyAnalysisAgent.text({
  messages: [
    {
      role: 'user',
      content: `Perform a security-focused dependency analysis:
      
      1. Identify packages with known vulnerabilities
      2. Find over-privileged dependencies
      3. Check for outdated packages that should be updated
      4. Review transitive dependencies for security issues
      
      Provide a risk assessment with specific remediation steps.`
    }
  ]
});
```

### Bundle Optimization Analysis

```typescript
const bundleAnalysis = await dependencyAnalysisAgent.text({
  messages: [
    {
      role: 'user',
      content: `Analyze for bundle size optimization:
      
      1. Identify the heaviest dependencies
      2. Find opportunities for dynamic imports
      3. Detect tree-shaking opportunities
      4. Recommend lighter alternatives
      
      Include potential savings and implementation difficulty for each recommendation.`
    }
  ]
});
```

### Monorepo Analysis

```typescript
const monorepoAnalysis = await dependencyAnalysisAgent.text({
  messages: [
    {
      role: 'user',
      content: `Analyze this monorepo for dependency management issues:
      
      1. Identify duplicate dependencies across packages
      2. Find dependencies that should be hoisted to the root
      3. Detect version mismatches between packages
      4. Check for proper peer dependency management
      
      Provide workspace optimization strategies.`
    }
  ]
});
```

## Agent Capabilities

### 🧠 **Expert Knowledge**
- **JavaScript/TypeScript Ecosystem**: Deep understanding of modern JS/TS patterns
- **Package Management**: Expertise in npm, yarn, pnpm workflows
- **Bundle Optimization**: Knowledge of webpack, Vite, Rollup optimization strategies
- **Security Best Practices**: Awareness of supply chain security concerns

### 🔧 **Analysis Types**
- **Static Analysis**: Parses source code to understand import patterns
- **Dynamic Analysis**: Uses package manager commands to understand dependency trees
- **Pattern Recognition**: Identifies common anti-patterns and optimization opportunities
- **Risk Assessment**: Evaluates security and performance implications

### 📈 **Output Structure**

```typescript
interface DependencyAnalysisResult {
  summary: string;
  criticalFindings: string[];
  securityConcerns: string[];
  optimizationOpportunities: string[];
  bestPracticesViolations: string[];
  detailedAnalysis: {
    highCriticalityDependencies: Array<{
      name: string;
      reason: string;
      recommendation: string;
    }>;
    unusedDependencies: string[];
    misplacedDependencies: Array<{
      name: string;
      currentLocation: 'dependencies' | 'devDependencies' | 'peerDependencies';
      suggestedLocation: 'dependencies' | 'devDependencies' | 'peerDependencies';
      reason: string;
    }>;
    bundleSizeImpact: {
      heavyDependencies: string[];
      dynamicImportOpportunities: string[];
    };
  };
  recommendations: {
    immediate: string[];
    shortTerm: string[];
    longTerm: string[];
  };
}
```

## Advanced Features

### 🔍 **Import Pattern Detection**
Detects and analyzes all import types:
- ES6 static imports: `import React from 'react'`
- Named imports: `import { useState } from 'react'`
- Namespace imports: `import * as React from 'react'`
- Dynamic imports: `import('./module')`
- CommonJS: `require('module')`
- Type-only imports: `import type { User } from './types'`
- Side-effect imports: `import './styles.css'`
- Re-exports: `export { default } from 'module'`

### 📊 **Criticality Assessment**
Assigns criticality based on:
- **Usage Frequency**: How often the dependency is imported
- **Dependency Type**: Production vs development dependencies
- **Framework Impact**: Core framework dependencies get higher priority
- **Runtime Usage**: Type-only vs runtime dependencies
- **Bundle Impact**: Size and performance implications

### 🛠 **Package Manager Integration**
- **npm**: Uses `npm ls` to understand dependency trees
- **yarn**: Uses `yarn why` to trace dependency reasons
- **pnpm**: Uses `pnpm why` for dependency analysis
- **Monorepo Support**: Handles npm workspaces, pnpm workspaces, Lerna, Nx

## Example Output

```
📊 Dependency Analysis Summary
Total Dependencies: 45 (32 direct, 13 transitive)
Security Risk Level: MEDIUM
Bundle Size Impact: HIGH

🚨 Critical Findings:
- 3 dependencies with known security vulnerabilities
- 2 production dependencies only used for types
- Large bundle impact from 'moment' (use 'date-fns' instead)

🔧 Immediate Actions:
1. Update 'lodash' to v4.17.21 (security vulnerability)
2. Move '@types/node' to devDependencies (type-only usage)
3. Replace 'moment' with 'date-fns' (92% smaller bundle)

📈 Short-term Improvements:
1. Dynamic import 'heavy-chart-library' (reduce initial bundle by 45KB)
2. Remove unused 'axios' dependency (zero imports found)
3. Consolidate duplicate functionality (both 'lodash' and 'ramda' present)
```

## Best Practices

1. **Regular Analysis**: Run dependency analysis before major releases
2. **Security First**: Address HIGH criticality security issues immediately
3. **Bundle Monitoring**: Track bundle size impact of new dependencies
4. **Monorepo Hygiene**: Keep dependencies consistent across packages
5. **Type Safety**: Properly separate runtime and type dependencies

## Integration

The agent integrates seamlessly with:
- **CI/CD Pipelines**: Add dependency analysis to your build process
- **Code Reviews**: Get dependency insights during PR reviews
- **Development Workflow**: Regular health checks of your dependency tree
- **Security Scanning**: Complement existing security tools with AI analysis