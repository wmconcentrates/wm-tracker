const LEAFLINK_API_KEY = process.env.LEAFLINK_API_KEY;
const LEAFLINK_API_URL = 'https://www.leaflink.com/api/v2';

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Build query string from request
        const queryParams = new URLSearchParams(req.query).toString();
        const url = `${LEAFLINK_API_URL}/orders-received/?${queryParams}`;

        console.log(`Fetching: ${url}`);

        const response = await fetch(url, {
            headers: {
                'Authorization': `App ${LEAFLINK_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`LeafLink API error: ${response.status}`);
        }

        const data = await response.json();

        // Get the host for URL rewriting
        const host = req.headers.host;
        const protocol = host.includes('localhost') ? 'http' : 'https';
        const proxyBase = `${protocol}://${host}/api`;

        // Rewrite next/previous URLs to go through proxy
        if (data.next) {
            data.next = data.next.replace(LEAFLINK_API_URL, proxyBase);
        }
        if (data.previous) {
            data.previous = data.previous.replace(LEAFLINK_API_URL, proxyBase);
        }

        res.status(200).json(data);
    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({ error: error.message });
    }
}
