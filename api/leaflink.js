const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const LEAFLINK_API_URL = 'https://www.leaflink.com/api/v2';
const ENCRYPTION_KEY = process.env.API_KEY_ENCRYPTION_SECRET || 'default-dev-key-change-in-prod!!';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

let supabase = null;
if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

function decryptApiKey(encryptedData) {
    try {
        const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
        const [ivHex, authTagHex, encrypted] = encryptedData.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) {
        console.error('Decryption error:', error.message);
        return null;
    }
}

async function getBusinessBySlug(slug) {
    if (!supabase) return null;
    const { data, error } = await supabase
        .from('businesses')
        .select('*')
        .eq('slug', slug)
        .eq('is_active', true)
        .single();
    if (error) {
        console.error('Error fetching business:', error.message);
        return null;
    }
    return data;
}

async function getBusinessApiKey(businessId, service = 'leaflink') {
    if (!supabase) return null;
    const { data, error } = await supabase
        .from('business_api_keys')
        .select('api_key_encrypted')
        .eq('business_id', businessId)
        .eq('service', service)
        .eq('is_active', true)
        .single();
    if (error || !data) {
        console.error('Error fetching API key:', error?.message);
        return null;
    }
    return decryptApiKey(data.api_key_encrypted);
}

function getProxyBaseUrl(req, businessSlug) {
    const host = req.headers.host;
    const protocol = host.includes('localhost') ? 'http' : 'https';
    return `${protocol}://${host}/api/business/${businessSlug}`;
}

function rewritePaginationUrls(data, proxyBase) {
    if (data.next) {
        data.next = data.next.replace(LEAFLINK_API_URL, proxyBase);
    }
    if (data.previous) {
        data.previous = data.previous.replace(LEAFLINK_API_URL, proxyBase);
    }
    return data;
}

module.exports = async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Parse the URL: /api/leaflink?slug=xxx&endpoint=xxx
    const { slug, endpoint } = req.query;

    if (!slug || !endpoint) {
        return res.status(400).json({ error: 'Missing slug or endpoint parameter' });
    }

    try {
        const business = await getBusinessBySlug(slug);
        if (!business) {
            return res.status(404).json({ error: 'Business not found' });
        }

        const apiKey = await getBusinessApiKey(business.id, 'leaflink');
        if (!apiKey) {
            return res.status(400).json({ error: 'LeafLink not configured for this business' });
        }

        // Build query params (exclude our custom params)
        const queryParams = new URLSearchParams();
        for (const [key, value] of Object.entries(req.query)) {
            if (key !== 'slug' && key !== 'endpoint') {
                if (Array.isArray(value)) {
                    value.forEach(v => queryParams.append(key, v));
                } else {
                    queryParams.append(key, value);
                }
            }
        }

        if (req.method === 'GET') {
            // LeafLink API requires trailing slash
            const cleanEndpoint = endpoint.endsWith('/') ? endpoint : endpoint + '/';
            const url = `${LEAFLINK_API_URL}/${cleanEndpoint}${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
            console.log(`[${business.slug}] Fetching: ${url}`);

            const response = await fetch(url, {
                headers: {
                    'Authorization': `App ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`LeafLink API error: ${response.status}`);
            }

            const data = await response.json();
            const proxyBase = getProxyBaseUrl(req, slug);
            rewritePaginationUrls(data, proxyBase);

            return res.status(200).json(data);
        }

        if (req.method === 'POST') {
            const url = `${LEAFLINK_API_URL}/${endpoint}/`;
            console.log(`[${business.slug}] POST to: ${url}`);

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `App ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(req.body)
            });

            const data = await response.json();
            if (!response.ok) {
                console.error('LeafLink POST error:', response.status, data);
                return res.status(response.status).json(data);
            }

            console.log(`[${business.slug}] POST success:`, data.id || data);
            return res.status(response.status).json(data);
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (error) {
        console.error('Proxy error:', error);
        return res.status(500).json({ error: error.message });
    }
};
