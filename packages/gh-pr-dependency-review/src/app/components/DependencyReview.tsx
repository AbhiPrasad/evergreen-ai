'use client';

import React, { useState } from 'react';
import clsx from 'clsx';

interface PRAnalysis {
  prNumber: number;
  title: string;
  state: string;
  repository: {
    owner: string;
    name: string;
    fullName: string;
  };
  author: {
    login: string;
    type: string;
  };
  stats: {
    commits: number;
    additions: number;
    deletions: number;
    changedFiles: number;
  };
  labels: Array<{
    name: string;
    color: string;
    description?: string;
  }>;
}

interface AnalysisResult {
  isDependencyUpgrade: boolean;
  ecosystem?: string;
  prAnalysis: PRAnalysis;
  gitDiffSummary?: string;
  changelogSummary?: string;
  dependencyAnalysis?: string;
  recommendation?: string;
  error?: string;
}

const DependencyReview = () => {
  const [prUrl, setPrUrl] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string>('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!prUrl.trim()) {
      setError('Please enter a GitHub PR URL');
      return;
    }

    // Validate GitHub PR URL format
    const githubPRPattern = /^https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/\d+/;
    if (!githubPRPattern.test(prUrl)) {
      setError('Please enter a valid GitHub PR URL (e.g., https://github.com/owner/repo/pull/123)');
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const response = await fetch(`/api/analyze-pr?prUrl=${encodeURIComponent(prUrl.trim())}`, {
        method: 'GET',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to analyze PR');
      }

      const analysisResult: AnalysisResult = await response.json();
      setResult(analysisResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze PR');
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setPrUrl('');
    setResult(null);
    setError('');
  };

  return (
    <div className="dependency-review">
      <div className="container">
        <div className="header">
          <h1>GitHub PR Dependency Review</h1>
          <p>Analyze GitHub Pull Requests for dependency upgrades and get AI-powered recommendations.</p>
        </div>

        <div className="main-content">
          <div className="input-section">
            <form onSubmit={handleSubmit} className="pr-form">
              <div className="form-group">
                <label htmlFor="pr-url">GitHub PR URL:</label>
                <div className="input-wrapper">
                  <input
                    id="pr-url"
                    type="url"
                    value={prUrl}
                    onChange={e => setPrUrl(e.target.value)}
                    placeholder="https://github.com/owner/repo/pull/123"
                    className="form-input"
                    disabled={loading}
                  />
                  {prUrl && (
                    <button type="button" className="clear-button" onClick={handleClear} aria-label="Clear URL">
                      ×
                    </button>
                  )}
                </div>
              </div>

              <button type="submit" className={clsx('analyze-button', { loading })} disabled={loading || !prUrl.trim()}>
                {loading ? (
                  <>
                    <span className="spinner"></span>
                    Analyzing...
                  </>
                ) : (
                  'Analyze PR'
                )}
              </button>
            </form>

            {error && (
              <div className="error-message">
                <strong>Error:</strong> {error}
              </div>
            )}
          </div>

          {result && (
            <div className="results-section">
              {/* PR Basic Info */}
              <div className="pr-info-card">
                <h2>PR Information</h2>
                <div className="pr-details">
                  <div className="pr-header">
                    <h3>
                      #{result.prAnalysis.prNumber}: {result.prAnalysis.title}
                    </h3>
                    <div className="pr-meta">
                      <span className={`status ${result.prAnalysis.state}`}>{result.prAnalysis.state}</span>
                      <span className="repository">{result.prAnalysis.repository.fullName}</span>
                      <span className="author">by {result.prAnalysis.author.login}</span>
                    </div>
                  </div>

                  <div className="pr-stats">
                    <div className="stat">
                      <span className="stat-value">{result.prAnalysis.stats.commits}</span>
                      <span className="stat-label">commits</span>
                    </div>
                    <div className="stat">
                      <span className="stat-value">{result.prAnalysis.stats.changedFiles}</span>
                      <span className="stat-label">files</span>
                    </div>
                    <div className="stat additions">
                      <span className="stat-value">+{result.prAnalysis.stats.additions}</span>
                      <span className="stat-label">additions</span>
                    </div>
                    <div className="stat deletions">
                      <span className="stat-value">-{result.prAnalysis.stats.deletions}</span>
                      <span className="stat-label">deletions</span>
                    </div>
                  </div>

                  {result.prAnalysis.labels.length > 0 && (
                    <div className="pr-labels">
                      {result.prAnalysis.labels.map((label, index) => (
                        <span key={index} className="label" style={{ backgroundColor: `#${label.color}` }}>
                          {label.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Dependency Analysis Result */}
              <div className="dependency-status-card">
                <h2>Dependency Analysis</h2>
                <div className="dependency-status">
                  <div
                    className={clsx('status-indicator', {
                      'is-dependency': result.isDependencyUpgrade,
                      'not-dependency': !result.isDependencyUpgrade,
                    })}
                  >
                    {result.isDependencyUpgrade ? (
                      <>
                        <span className="status-icon">✅</span>
                        <span className="status-text">Dependency Upgrade Detected</span>
                      </>
                    ) : (
                      <>
                        <span className="status-icon">ℹ️</span>
                        <span className="status-text">Not a Dependency Upgrade</span>
                      </>
                    )}
                  </div>

                  {result.ecosystem && (
                    <div className="ecosystem-info">
                      <strong>Ecosystem:</strong> {result.ecosystem}
                    </div>
                  )}
                </div>
              </div>

              {/* Analysis Results (only show if it's a dependency upgrade) */}
              {result.isDependencyUpgrade && (
                <div className="analysis-results">
                  {result.gitDiffSummary && (
                    <div className="analysis-section">
                      <h3>📋 Git Diff Analysis</h3>
                      <div className="analysis-content">{result.gitDiffSummary}</div>
                    </div>
                  )}

                  {result.changelogSummary && (
                    <div className="analysis-section">
                      <h3>📝 Changelog Summary</h3>
                      <div className="analysis-content">{result.changelogSummary}</div>
                    </div>
                  )}

                  {result.dependencyAnalysis && (
                    <div className="analysis-section">
                      <h3>🔍 Dependency Analysis</h3>
                      <div className="analysis-content">{result.dependencyAnalysis}</div>
                    </div>
                  )}

                  {result.recommendation && (
                    <div className="analysis-section recommendation">
                      <h3>💡 Recommendation</h3>
                      <div className="analysis-content">{result.recommendation}</div>
                    </div>
                  )}
                </div>
              )}

              {!result.isDependencyUpgrade && (
                <div className="not-dependency-message">
                  <p>This PR does not appear to be a dependency upgrade. The analysis has been stopped.</p>
                  <p>
                    Dependency upgrades are typically identified by keywords like &quot;bump&quot;, &quot;update&quot;,
                    &quot;upgrade&quot;, or labels like &quot;dependencies&quot; in the PR title or labels.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DependencyReview;
