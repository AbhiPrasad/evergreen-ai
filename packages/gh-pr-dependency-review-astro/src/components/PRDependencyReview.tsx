import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import './PRDependencyReview.css';

interface AnalysisStep {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  result?: any;
  error?: string;
}

interface DependencyInfo {
  isDependencyUpgrade: boolean;
  ecosystem?: 'javascript' | 'java' | 'go' | 'python' | 'ruby' | 'unknown';
  dependencyName?: string;
  oldVersion?: string;
  newVersion?: string;
  changeType?: 'major' | 'minor' | 'patch' | 'unknown';
}

interface AnalysisResponse {
  success?: boolean;
  error?: string;
  steps: AnalysisStep[];
  dependencyInfo?: DependencyInfo;
  recommendation?: any;
}

const PRDependencyReview: React.FC = () => {
  const [prUrl, setPrUrl] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [error, setError] = useState<string>('');

  const handleAnalyze = async () => {
    if (!prUrl.trim()) {
      setError('Please enter a GitHub PR URL');
      return;
    }

    // Validate GitHub PR URL format
    const prUrlPattern = /^https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/\d+/;
    if (!prUrlPattern.test(prUrl.trim())) {
      setError('Please enter a valid GitHub PR URL (e.g., https://github.com/owner/repo/pull/123)');
      return;
    }

    setLoading(true);
    setError('');
    setAnalysis(null);

    try {
      console.log('prUrl', prUrl);
      const response = await fetch(`/api/analyze-pr?prUrl=${encodeURIComponent(prUrl.trim())}`, {
        method: 'GET',
      });

      console.log('response', response);

      const data: AnalysisResponse = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Analysis failed');
      }

      setAnalysis(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze PR');
      console.error('Analysis error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !loading) {
      handleAnalyze();
    }
  };

  const getStepIcon = (status: AnalysisStep['status']) => {
    switch (status) {
      case 'completed':
        return '✅';
      case 'running':
        return '⏳';
      case 'error':
        return '❌';
      default:
        return '⏸️';
    }
  };

  const getEcosystemIcon = (ecosystem?: string) => {
    switch (ecosystem) {
      case 'javascript':
        return '📦 JavaScript/TypeScript';
      case 'java':
        return '☕ Java';
      case 'go':
        return '🐹 Go';
      case 'python':
        return '🐍 Python';
      case 'ruby':
        return '💎 Ruby';
      default:
        return '❓ Unknown';
    }
  };

  return (
    <div className="pr-dependency-review">
      <div className="main-layout">
        <div className="left-panel">
          <div className="input-section">
            <div className="form-group">
              <label htmlFor="pr-url">GitHub PR URL:</label>
              <div className="input-wrapper">
                <input
                  id="pr-url"
                  type="url"
                  value={prUrl}
                  onChange={e => setPrUrl(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="https://github.com/owner/repo/pull/123"
                  className="form-input"
                  disabled={loading}
                />
                <button
                  onClick={handleAnalyze}
                  disabled={loading || !prUrl.trim()}
                  className="analyze-button"
                  type="button"
                >
                  {loading ? 'Analyzing...' : 'Analyze'}
                </button>
              </div>
            </div>

            {error && (
              <div className="error-message">
                <strong>Error:</strong> {error}
              </div>
            )}
          </div>

          {analysis && (
            <div className="analysis-steps">
              <h3>Analysis Progress</h3>
              <div className="steps-list">
                {analysis.steps.map(step => (
                  <div key={step.id} className={`step-item ${step.status}`}>
                    <div className="step-header">
                      <span className="step-icon">{getStepIcon(step.status)}</span>
                      <span className="step-name">{step.name}</span>
                    </div>
                    {step.error && <div className="step-error">Error: {step.error}</div>}
                  </div>
                ))}
              </div>

              {analysis.dependencyInfo && (
                <div className="dependency-info">
                  <h4>Dependency Information</h4>
                  <div className="info-grid">
                    <div className="info-item">
                      <strong>Is Dependency Upgrade:</strong>
                      <span className={analysis.dependencyInfo.isDependencyUpgrade ? 'positive' : 'negative'}>
                        {analysis.dependencyInfo.isDependencyUpgrade ? 'Yes' : 'No'}
                      </span>
                    </div>
                    {analysis.dependencyInfo.ecosystem && (
                      <div className="info-item">
                        <strong>Ecosystem:</strong>
                        <span>{getEcosystemIcon(analysis.dependencyInfo.ecosystem)}</span>
                      </div>
                    )}
                    {analysis.dependencyInfo.dependencyName && (
                      <div className="info-item">
                        <strong>Dependency:</strong>
                        <span>{analysis.dependencyInfo.dependencyName}</span>
                      </div>
                    )}
                    {analysis.dependencyInfo.oldVersion && analysis.dependencyInfo.newVersion && (
                      <div className="info-item">
                        <strong>Version Change:</strong>
                        <span>
                          {analysis.dependencyInfo.oldVersion} → {analysis.dependencyInfo.newVersion}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="right-panel">
          {!analysis && !loading && (
            <div className="empty-state">
              <div className="empty-content">
                <h3>🔍 Analyze GitHub PR Dependencies</h3>
                <p>Enter a GitHub Pull Request URL to get AI-powered analysis of dependency upgrades including:</p>
                <ul>
                  <li>Dependency upgrade detection</li>
                  <li>Ecosystem identification</li>
                  <li>Git diff analysis</li>
                  <li>Changelog summary</li>
                  <li>Security and compatibility assessment</li>
                  <li>Upgrade recommendations</li>
                </ul>
              </div>
            </div>
          )}

          {loading && (
            <div className="loading-state">
              <div className="loading-spinner"></div>
              <p>Analyzing PR... This may take a moment.</p>
            </div>
          )}

          {analysis?.recommendation && (
            <div className="recommendation-section">
              <h3>🎯 Dependency Upgrade Recommendation</h3>
              <div className="recommendation-content">
                <ReactMarkdown className="markdown-content">
                  {typeof analysis.recommendation === 'string'
                    ? analysis.recommendation
                    : JSON.stringify(analysis.recommendation, null, 2)}
                </ReactMarkdown>
              </div>
            </div>
          )}

          {analysis && !analysis.dependencyInfo?.isDependencyUpgrade && (
            <div className="not-dependency-upgrade">
              <h3>ℹ️ Not a Dependency Upgrade</h3>
              <p>
                This PR does not appear to be a dependency upgrade based on its title, labels, and content. This tool is
                specifically designed to analyze dependency upgrade PRs.
              </p>
            </div>
          )}

          {analysis?.error && (
            <div className="analysis-error">
              <h3>❌ Analysis Error</h3>
              <p>{analysis.error}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PRDependencyReview;
