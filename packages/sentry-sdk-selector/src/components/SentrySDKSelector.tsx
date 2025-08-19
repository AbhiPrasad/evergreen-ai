import React, { useState, useEffect } from 'react';
import './SentrySDKSelector.css';

interface SDK {
  name: string;
  displayName: string;
  version: string;
  repo_url: string;
  main_docs_url?: string;
}

interface ApiSDKResponse {
  [key: string]: {
    name: string;
    version: string;
    main_docs_url?: string;
    repo_url: string;
    [key: string]: any;
  };
}

interface ApiVersionResponse {
  latest: {
    version: string;
    [key: string]: any;
  };
  versions: string[];
}

const SentrySDKSelector: React.FC = () => {
  const [sdks, setSdks] = useState<SDK[]>([]);
  const [selectedSDK, setSelectedSDK] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [filteredSDKs, setFilteredSDKs] = useState<SDK[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [versions, setVersions] = useState<string[]>([]);
  const [startVersion, setStartVersion] = useState<string>('');
  const [endVersion, setEndVersion] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  // Fetch available SDKs on component mount
  useEffect(() => {
    const fetchSDKs = async () => {
      try {
        setLoading(true);
        const response = await fetch('https://release-registry.services.sentry.io/sdks');
        if (!response.ok) {
          throw new Error('Failed to fetch SDKs');
        }
        const data: ApiSDKResponse = await response.json();

        // Convert object to array and sort by display name
        const sdkArray: SDK[] = Object.entries(data)
          .map(([key, value]) => ({
            name: key,
            displayName: key
              .split('.')
              .filter(n => n !== 'sentry')
              .join(' '),
            version: value.version,
            main_docs_url: value.main_docs_url,
            repo_url: value.repo_url,
          }))
          .sort((a, b) => a.displayName.localeCompare(b.displayName));

        setSdks(sdkArray);
        setFilteredSDKs(sdkArray);
      } catch (err) {
        setError('Failed to load SDKs. Please try again.');
        console.error('Error fetching SDKs:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchSDKs();
  }, []);

  // Fetch versions when SDK is selected
  useEffect(() => {
    if (!selectedSDK) {
      setVersions([]);
      setStartVersion('');
      setEndVersion('');
      return;
    }

    const fetchVersions = async () => {
      try {
        setLoading(true);
        setError('');
        const response = await fetch(`https://release-registry.services.sentry.io/sdks/${selectedSDK}/versions`);
        if (!response.ok) {
          throw new Error('Failed to fetch versions');
        }
        const data: ApiVersionResponse = await response.json();

        // Sort versions by semantic versioning (newest first)
        const sortedVersions = [...data.versions].sort((a, b) => {
          return b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' });
        });

        setVersions(sortedVersions);

        // Set default end version to latest
        if (data.latest && data.latest.version) {
          setEndVersion(data.latest.version);
        } else if (sortedVersions.length > 0) {
          setEndVersion(sortedVersions[0]);
        }
      } catch (err) {
        setError('Failed to load versions. Please try again.');
        console.error('Error fetching versions:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchVersions();
  }, [selectedSDK]);

  // Filter SDKs based on search term
  useEffect(() => {
    if (!searchTerm) {
      setFilteredSDKs(sdks);
    } else {
      const filtered = sdks.filter(
        sdk =>
          sdk.displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
          sdk.name.toLowerCase().includes(searchTerm.toLowerCase()),
      );
      setFilteredSDKs(filtered);
    }
    setHighlightedIndex(-1);
  }, [searchTerm, sdks]);

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(event.target.value);
    setIsDropdownOpen(true);
  };

  const handleSDKSelect = (sdk: SDK) => {
    setSelectedSDK(sdk.name);
    setSearchTerm(sdk.displayName);
    setIsDropdownOpen(false);
  };

  const handleInputFocus = () => {
    setIsDropdownOpen(true);
  };

  const handleInputBlur = () => {
    // Delay closing to allow for clicks on dropdown items
    setTimeout(() => setIsDropdownOpen(false), 150);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setIsDropdownOpen(false);
      setHighlightedIndex(-1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex(prev => (prev < filteredSDKs.length - 1 ? prev + 1 : prev));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex(prev => (prev > 0 ? prev - 1 : -1));
    } else if (event.key === 'Enter' && highlightedIndex >= 0) {
      event.preventDefault();
      if (filteredSDKs[highlightedIndex]) {
        handleSDKSelect(filteredSDKs[highlightedIndex]);
      }
    }
  };

  const handleStartVersionChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setStartVersion(event.target.value);
  };

  const handleEndVersionChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setEndVersion(event.target.value);
  };

  if (loading && sdks.length === 0) {
    return (
      <div className="sdk-selector">
        <div className="loading">Loading SDKs...</div>
      </div>
    );
  }

  return (
    <div className="sdk-selector">
      {error && <div className="error-message">{error}</div>}

      <div className="form-group">
        <label htmlFor="sdk-search">Select Sentry SDK:</label>
        <div className="input-dropdown">
          <div className="input-wrapper">
            <input
              id="sdk-search"
              type="text"
              value={searchTerm}
              onChange={handleSearchChange}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
              onKeyDown={handleKeyDown}
              placeholder="Search for an SDK..."
              className="form-input"
              autoComplete="off"
            />
            {searchTerm && (
              <button
                type="button"
                className="clear-button"
                onMouseDown={e => {
                  e.preventDefault();
                  setSearchTerm('');
                  setSelectedSDK('');
                  setIsDropdownOpen(false);
                }}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>
          {isDropdownOpen && (
            <div className="dropdown-list">
              {filteredSDKs.length > 0 ? (
                filteredSDKs.map((sdk, index) => (
                  <div
                    key={sdk.name}
                    className={`dropdown-item ${index === highlightedIndex ? 'highlighted' : ''}`}
                    onMouseDown={() => handleSDKSelect(sdk)}
                    onMouseEnter={() => setHighlightedIndex(index)}
                  >
                    <div className="sdk-name">{sdk.displayName}</div>
                    <div className="sdk-key">{sdk.name}</div>
                  </div>
                ))
              ) : (
                <div className="dropdown-item no-results">No SDKs found matching "{searchTerm}"</div>
              )}
            </div>
          )}
        </div>
      </div>

      {selectedSDK && (
        <div className="version-selectors">
          <div className="form-group">
            <label htmlFor="start-version">Starting Version:</label>
            <select
              id="start-version"
              value={startVersion}
              onChange={handleStartVersionChange}
              className="form-select"
              disabled={loading}
            >
              <option value="">Select starting version...</option>
              {versions.map(version => (
                <option key={version} value={version}>
                  {version}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="end-version">Target Version:</label>
            <select
              id="end-version"
              value={endVersion}
              onChange={handleEndVersionChange}
              className="form-select"
              disabled={loading}
            >
              <option value="">Select target version...</option>
              {versions.map(version => (
                <option key={version} value={version}>
                  {version}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {loading && selectedSDK && <div className="loading">Loading versions...</div>}

      {startVersion && endVersion && (
        <div className="comparison-result">
          <h3>Version Comparison</h3>
          <div className="version-info">
            <div className="version-card">
              <h4>Starting Version</h4>
              <span className="version-number">{startVersion}</span>
            </div>
            <div className="arrow">→</div>
            <div className="version-card">
              <h4>Target Version</h4>
              <span className="version-number">{endVersion}</span>
            </div>
          </div>
          <div className="sdk-info">
            <strong>SDK:</strong> {sdks.find(sdk => sdk.name === selectedSDK)?.name || selectedSDK}
          </div>
        </div>
      )}
    </div>
  );
};

export default SentrySDKSelector;
