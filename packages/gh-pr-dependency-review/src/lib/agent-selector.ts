import {
  javascriptTypeScriptDependencyAnalysisAgent,
  javaDependencyAnalysisAgent,
  goDependencyAnalysisAgent,
  pythonDependencyAnalysisAgent,
  rubyDependencyAnalysisAgent,
} from '@sentry/evergreen-ai-agents';

export function getDependencyAnalysisAgent(ecosystem: string): any {
  switch (ecosystem) {
    case 'javascript':
    case 'typescript':
      return javascriptTypeScriptDependencyAnalysisAgent;
    case 'java':
    case 'kotlin':
      return javaDependencyAnalysisAgent;
    case 'go':
      return goDependencyAnalysisAgent;
    case 'python':
      return pythonDependencyAnalysisAgent;
    case 'ruby':
      return rubyDependencyAnalysisAgent;
    case 'rust':
    case 'php':
    case 'csharp':
    case 'swift':
      // For now, these ecosystems will fall back to null
      // Can be extended when specific agents are available
      return null;
    default:
      return null;
  }
}
