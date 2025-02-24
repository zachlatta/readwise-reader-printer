class ReadwiseReader {
    constructor(accessToken) {
        this.accessToken = accessToken;
        this.baseUrl = 'https://readwise.io/api/v3';
    }

    /**
     * Fetches documents from Readwise Reader API
     * @param {Object} options - Optional parameters
     * @param {string} options.updatedAfter - ISO 8601 date string to filter documents updated after this date
     * @param {string} options.location - Filter by location (new, later, shortlist, archive, feed)
     * @param {string} options.category - Filter by category (article, email, rss, highlight, note, pdf, epub, tweet, video)
     * @param {boolean} options.withHtmlContent - Include HTML content in response
     * @returns {Promise<Array>} Array of documents
     */
    async getDocuments(options = {}) {
        const fullData = [];
        let nextPageCursor = null;

        try {
            do {
                // Build query parameters
                const queryParams = new URLSearchParams();
                if (nextPageCursor) {
                    queryParams.append('pageCursor', nextPageCursor);
                }
                if (options.updatedAfter) {
                    queryParams.append('updatedAfter', options.updatedAfter);
                }
                if (options.location) {
                    queryParams.append('location', options.location);
                }
                if (options.category) {
                    queryParams.append('category', options.category);
                }
                if (options.withHtmlContent) {
                    queryParams.append('withHtmlContent', 'true');
                }

                const response = await fetch(`${this.baseUrl}/list/?${queryParams.toString()}`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Token ${this.accessToken}`,
                        'Content-Type': 'application/json',
                    },
                });

                if (!response.ok) {
                    if (response.status === 429) {
                        const retryAfter = response.headers.get('Retry-After');
                        throw new Error(`Rate limit exceeded. Retry after ${retryAfter} seconds`);
                    }
                    throw new Error(`API request failed with status ${response.status}`);
                }

                const data = await response.json();
                fullData.push(...data.results);
                nextPageCursor = data.nextPageCursor;

            } while (nextPageCursor);

            return fullData;

        } catch (error) {
            throw new Error(`Failed to fetch documents: ${error.message}`);
        }
    }
}

export default ReadwiseReader;
