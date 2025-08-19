# Sentry SDK Selector

A modern web application built with Astro and React that allows users to select Sentry SDKs and compare versions using the Sentry Release Registry API.

## Features

- **Smart SDK Search**: Searchable input dropdown with real-time filtering
- **Keyboard Navigation**: Full keyboard support with arrow keys and Enter
- **Version Comparison**: Select starting and target versions for comparison
- **Live Data**: Fetches real-time data from the Sentry Release Registry
- **Modern UI**: Beautiful, responsive design with glassmorphism effects
- **Fast Performance**: Built with Astro for optimal loading speeds
- **Accessibility**: Screen reader friendly with proper ARIA labels

## API Integration

This app integrates with the Sentry Release Registry API:

- **SDK List**: `https://release-registry.services.sentry.io/sdks`
- **Version List**: `https://release-registry.services.sentry.io/sdks/{sdk-name}/versions`

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Clean build artifacts
npm run clean
```

The development server will start at `http://localhost:4321`.

### From Workspace Root

You can also run commands from the workspace root:

```bash
# Start development server
npm run dev --workspace=sentry-sdk-selector

# Build the package
npm run build --workspace=sentry-sdk-selector
```

## Usage

1. **Search for an SDK**: Type in the search box to filter available Sentry SDKs
   - Search by SDK display name (e.g., "Python", "JavaScript")
   - Search by internal SDK key (e.g., "sentry.python", "sentry.javascript")
   - Use arrow keys to navigate through filtered results
   - Press Enter to select or click on an SDK

2. **Choose Versions**: Select your starting version and target version
   - Starting version: Pick the version you're upgrading from
   - Target version: Choose the version you want to upgrade to (defaults to latest)

3. **Compare**: View the version comparison results
   - Clear button (×) to reset your selection and start over

### Keyboard Shortcuts
- **Arrow Up/Down**: Navigate through SDK search results
- **Enter**: Select the highlighted SDK
- **Escape**: Close the dropdown without selecting

The target version automatically defaults to the latest available version for the selected SDK.

## Technology Stack

- **Astro**: Static site generator with partial hydration
- **React**: Interactive UI components
- **TypeScript**: Type-safe development
- **CSS**: Modern styling with CSS Grid and Flexbox
- **Sentry Release Registry API**: Real-time SDK and version data

## Project Structure

```
src/
├── components/
│   ├── SentrySDKSelector.tsx    # Main React component
│   └── SentrySDKSelector.css    # Component styles
├── layouts/
│   └── Layout.astro             # Base layout
├── pages/
│   └── index.astro              # Home page
public/
└── favicon.svg                  # Site icon
```