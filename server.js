const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

const LEAFLINK_API_KEY = '1029b2e9f60c4a50ecf1e918bacbd2c1eb49197877481115a7bd4495a96aea20';
const LEAFLINK_API_URL = 'https://www.leaflink.com/api/v2';

// Enable CORS for all origins
app.use(cors());
app.use(express.json());

// Serve static files from current directory (the main app)
app.use(express.static(__dirname));

// Helper to get proxy base URL
function getProxyBaseUrl(req) {
    const host = req.get('host');
    // Use https for production (Railway), http for localhost
    const protocol = host.includes('localhost') ? 'http' : 'https';
    return `${protocol}://${host}/api`;
}

// Proxy endpoint for LeafLink orders
app.get('/api/orders', async (req, res) => {
    try {
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
        const proxyBase = getProxyBaseUrl(req);

        // Rewrite next/previous URLs to go through proxy
        if (data.next) {
            data.next = data.next.replace(LEAFLINK_API_URL, proxyBase);
        }
        if (data.previous) {
            data.previous = data.previous.replace(LEAFLINK_API_URL, proxyBase);
        }

        res.json(data);
    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Generic proxy for any LeafLink endpoint
app.get('/api/*', async (req, res) => {
    try {
        const endpoint = req.params[0];
        const queryParams = new URLSearchParams(req.query).toString();
        const url = `${LEAFLINK_API_URL}/${endpoint}${queryParams ? '?' + queryParams : ''}`;

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
        const proxyBase = getProxyBaseUrl(req);

        // Rewrite next/previous URLs to go through proxy
        if (data.next) {
            data.next = data.next.replace(LEAFLINK_API_URL, proxyBase);
        }
        if (data.previous) {
            data.previous = data.previous.replace(LEAFLINK_API_URL, proxyBase);
        }

        res.json(data);
    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`White Mousse server running on port ${PORT}`);
    console.log('Serving app and LeafLink proxy!');
});
