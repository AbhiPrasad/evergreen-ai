import type { APIRoute } from 'astro';
import { changelogSummaryAgent } from '@sentry/evergreen-ai-agents';

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const selectedSDK = url.searchParams.get('selectedSDK');
    const startVersion = url.searchParams.get('startVersion');
    const endVersion = url.searchParams.get('endVersion');

    if (!selectedSDK || !startVersion || !endVersion) {
      return new Response(
        JSON.stringify({
          error: 'Missing required parameters: selectedSDK, startVersion, and endVersion are required',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    // Get the SDK info first to get the repo URL
    const sdkResponse = await fetch('https://release-registry.services.sentry.io/sdks');
    if (!sdkResponse.ok) {
      throw new Error('Failed to fetch SDK information');
    }
    const sdkData = await sdkResponse.json();
    const selectedSDKData = sdkData[selectedSDK];

    if (!selectedSDKData) {
      return new Response(
        JSON.stringify({
          error: `SDK ${selectedSDK} not found`,
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    // Prepare the prompt for the changelog summary agent
    const prompt = `Analyze the changelog for ${selectedSDK} from version ${startVersion} to ${endVersion}. 
    Repository URL: ${selectedSDKData.repo_url}
    
    Please provide a comprehensive summary of the changes, focusing on:
    - Breaking changes
    - New features
    - Bug fixes
    - Performance improvements
    - Security updates
    - Dependencies updates
    
    Make sure to include version numbers and any important migration notes.`;

    // Call the changelog summary agent
    const result = await changelogSummaryAgent.generate(prompt);

    return new Response(
      JSON.stringify({
        summary: result.text,
        sdk: selectedSDK,
        startVersion,
        endVersion,
        repoUrl: selectedSDKData.repo_url,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    console.error('Error generating changelog summary:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to generate changelog summary',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
};
