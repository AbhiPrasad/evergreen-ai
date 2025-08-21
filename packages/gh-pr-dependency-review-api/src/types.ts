export interface AnalysisStep {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  result?: any;
  error?: string;
}

export interface DependencyInfo {
  isDependencyUpgrade: boolean;
  ecosystem?: 'javascript' | 'java' | 'go' | 'python' | 'ruby' | 'unknown';
  dependencyName?: string;
  oldVersion?: string;
  newVersion?: string;
  changeType?: 'major' | 'minor' | 'patch' | 'unknown';
}

export interface AnalysisResponse {
  success?: boolean;
  error?: string;
  steps: AnalysisStep[];
  dependencyInfo?: DependencyInfo;
  recommendation?: any;
}