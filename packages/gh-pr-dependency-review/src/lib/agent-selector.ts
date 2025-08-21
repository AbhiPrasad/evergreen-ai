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
      return javascriptTypeScriptDependencyAnalysisAgent;
    case 'java':
      return javaDependencyAnalysisAgent;
    case 'go':
      return goDependencyAnalysisAgent;
    case 'python':
      return pythonDependencyAnalysisAgent;
    case 'ruby':
      return rubyDependencyAnalysisAgent;
    default:
      return null;
  }
}
