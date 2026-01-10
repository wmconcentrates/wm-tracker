require('dotenv').config({ path: '.env.local' });
require('dotenv').config(); // fallback to .env
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const app = express();

// Environment variables
const LEAFLINK_API_URL = 'https://www.leaflink.com/api/v2';
const ENCRYPTION_KEY = process.env.API_KEY_ENCRYPTION_SECRET || 'default-dev-key-change-in-prod!!';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Legacy single API key (for backwards compatibility during migration)
const LEGACY_LEAFLINK_API_KEY = process.env.LEAFLINK_API_KEY;

// Initialize Supabase client with service role (for accessing encrypted keys)
let supabase = null;
if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    console.log('Supabase client initialized');
} else {
    console.warn('Supabase credentials not configured - using legacy mode');
}

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Serve static files
const staticDir = process.cwd();
app.use(express.static(staticDir));

// ============================================
// ENCRYPTION UTILITIES
// ============================================
function encryptApiKey(apiKey) {
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(apiKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
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

// ============================================
// BUSINESS LOOKUP HELPERS
// ============================================
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

async function getAllBusinesses() {
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('businesses')
        .select('id, name, slug, display_name, logo_url, primary_color, is_active')
        .order('name');
    if (error) {
        console.error('Error fetching businesses:', error.message);
        return [];
    }
    return data;
}

// ============================================
// HELPER FUNCTIONS
// ============================================
function getProxyBaseUrl(req, businessSlug = null) {
    const host = req.get('host');
    const protocol = host.includes('localhost') ? 'http' : 'https';
    if (businessSlug) {
        return `${protocol}://${host}/api/business/${businessSlug}`;
    }
    return `${protocol}://${host}/api`;
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

// ============================================
// ADMIN ENDPOINTS (Business Management)
// ============================================

// List all businesses
app.get('/api/internal/businesses', async (req, res) => {
    try {
        const businesses = await getAllBusinesses();
        res.json(businesses);
    } catch (error) {
        console.error('Error listing businesses:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single business
app.get('/api/internal/businesses/:id', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { data, error } = await supabase
            .from('businesses')
            .select('*')
            .eq('id', req.params.id)
            .single();
        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('Error fetching business:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create business
app.post('/api/internal/businesses', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { name, slug, display_name, logo_url, primary_color } = req.body;
        if (!name || !slug || !display_name) {
            return res.status(400).json({ error: 'name, slug, and display_name are required' });
        }
        const { data, error } = await supabase
            .from('businesses')
            .insert({ name, slug, display_name, logo_url, primary_color })
            .select()
            .single();
        if (error) throw error;
        res.status(201).json(data);
    } catch (error) {
        console.error('Error creating business:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update business
app.put('/api/internal/businesses/:id', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { name, slug, display_name, logo_url, primary_color, is_active } = req.body;
        const { data, error } = await supabase
            .from('businesses')
            .update({ name, slug, display_name, logo_url, primary_color, is_active, updated_at: new Date().toISOString() })
            .eq('id', req.params.id)
            .select()
            .single();
        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('Error updating business:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add/Update API key for business
app.post('/api/internal/businesses/:id/api-key', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { service, api_key } = req.body;
        if (!service || !api_key) {
            return res.status(400).json({ error: 'service and api_key are required' });
        }
        const encrypted = encryptApiKey(api_key);
        const hint = '...' + api_key.slice(-4);
        const { data, error } = await supabase
            .from('business_api_keys')
            .upsert({
                business_id: req.params.id,
                service,
                api_key_encrypted: encrypted,
                api_key_hint: hint,
                is_active: true,
                updated_at: new Date().toISOString()
            }, { onConflict: 'business_id,service' })
            .select('id, business_id, service, api_key_hint, is_active')
            .single();
        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('Error saving API key:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get API key status for business (not the actual key)
app.get('/api/internal/businesses/:id/api-keys', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { data, error } = await supabase
            .from('business_api_keys')
            .select('id, service, api_key_hint, is_active, created_at')
            .eq('business_id', req.params.id);
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('Error fetching API keys:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// BUSINESS-AWARE LEAFLINK PROXY
// ============================================

// GET /api/leaflink?slug=xxx&endpoint=xxx (unified endpoint for frontend)
app.get('/api/leaflink', async (req, res) => {
    const { slug, endpoint } = req.query;

    // Debug endpoint
    if (slug === 'debug') {
        return res.json({
            supabase_configured: !!supabase,
            encryption_key_set: !!process.env.API_KEY_ENCRYPTION_SECRET,
            encryption_key_hint: ENCRYPTION_KEY ? ENCRYPTION_KEY.substring(0, 10) + '...' : 'NOT SET'
        });
    }

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
            const errorBody = await response.text();
            console.error(`[${business.slug}] LeafLink error ${response.status}:`, errorBody);
            throw new Error(`LeafLink API error: ${response.status}`);
        }

        const data = await response.json();
        // Rewrite pagination URLs to use the new format
        // Use x-forwarded-proto header or default to https for production
        const protocol = req.get('x-forwarded-proto') || (req.get('host').includes('localhost') ? 'http' : 'https');
        const baseUrl = `${protocol}://${req.get('host')}/api/leaflink?slug=${slug}&endpoint=`;
        if (data.next) {
            data.next = data.next.replace(LEAFLINK_API_URL, baseUrl).replace('/?', '&');
        }
        if (data.previous) {
            data.previous = data.previous.replace(LEAFLINK_API_URL, baseUrl).replace('/?', '&');
        }
        res.json(data);
    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/leaflink?slug=xxx&endpoint=xxx
app.post('/api/leaflink', async (req, res) => {
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
        res.status(response.status).json(data);
    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/business/:slug/orders
app.get('/api/business/:slug/orders', async (req, res) => {
    try {
        const business = await getBusinessBySlug(req.params.slug);
        if (!business) {
            return res.status(404).json({ error: 'Business not found' });
        }
        const apiKey = await getBusinessApiKey(business.id, 'leaflink');
        if (!apiKey) {
            return res.status(400).json({ error: 'LeafLink not configured for this business' });
        }
        const queryParams = new URLSearchParams(req.query).toString();
        const url = `${LEAFLINK_API_URL}/orders-received/?${queryParams}`;
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
        const proxyBase = getProxyBaseUrl(req, req.params.slug);
        rewritePaginationUrls(data, proxyBase);
        res.json(data);
    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/business/:slug/* (create products, etc.)
app.post('/api/business/:slug/*', async (req, res) => {
    try {
        const business = await getBusinessBySlug(req.params.slug);
        if (!business) {
            return res.status(404).json({ error: 'Business not found' });
        }
        const apiKey = await getBusinessApiKey(business.id, 'leaflink');
        if (!apiKey) {
            return res.status(400).json({ error: 'LeafLink not configured for this business' });
        }
        const endpoint = req.params[0];
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
        res.status(response.status).json(data);
    } catch (error) {
        console.error('POST proxy error:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/business/:slug/* (generic proxy)
app.get('/api/business/:slug/*', async (req, res) => {
    try {
        const business = await getBusinessBySlug(req.params.slug);
        if (!business) {
            return res.status(404).json({ error: 'Business not found' });
        }
        const apiKey = await getBusinessApiKey(business.id, 'leaflink');
        if (!apiKey) {
            return res.status(400).json({ error: 'LeafLink not configured for this business' });
        }
        const endpoint = req.params[0];
        const queryParams = new URLSearchParams(req.query).toString();
        const url = `${LEAFLINK_API_URL}/${endpoint}${queryParams ? '?' + queryParams : ''}`;
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
        const proxyBase = getProxyBaseUrl(req, req.params.slug);
        rewritePaginationUrls(data, proxyBase);
        res.json(data);
    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// LEGACY ROUTES (backwards compatibility)
// ============================================

// Debug endpoint
app.get('/debug', (req, res) => {
    const fs = require('fs');
    const files = fs.readdirSync(staticDir);
    res.json({
        cwd: staticDir,
        dirname: __dirname,
        files: files,
        multiTenantEnabled: !!supabase
    });
});

// Legacy: GET /api/orders (uses env var API key)
app.get('/api/orders', async (req, res) => {
    if (!LEGACY_LEAFLINK_API_KEY) {
        return res.status(400).json({ error: 'LEAFLINK_API_KEY not configured. Use /api/business/:slug/orders instead.' });
    }
    try {
        const queryParams = new URLSearchParams(req.query).toString();
        const url = `${LEAFLINK_API_URL}/orders-received/?${queryParams}`;
        console.log(`[legacy] Fetching: ${url}`);
        const response = await fetch(url, {
            headers: {
                'Authorization': `App ${LEGACY_LEAFLINK_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) {
            throw new Error(`LeafLink API error: ${response.status}`);
        }
        const data = await response.json();
        const proxyBase = getProxyBaseUrl(req);
        rewritePaginationUrls(data, proxyBase);
        res.json(data);
    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Legacy: POST /api/* (uses env var API key)
app.post('/api/*', async (req, res) => {
    if (!LEGACY_LEAFLINK_API_KEY) {
        return res.status(400).json({ error: 'LEAFLINK_API_KEY not configured. Use /api/business/:slug/* instead.' });
    }
    try {
        const endpoint = req.params[0];
        const url = `${LEAFLINK_API_URL}/${endpoint}/`;
        console.log(`[legacy] POST to: ${url}`);
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `App ${LEGACY_LEAFLINK_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(req.body)
        });
        const data = await response.json();
        if (!response.ok) {
            console.error('LeafLink POST error:', response.status, data);
            return res.status(response.status).json(data);
        }
        console.log('[legacy] POST success:', data.id || data);
        res.status(response.status).json(data);
    } catch (error) {
        console.error('POST proxy error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Legacy: GET /api/* (uses env var API key)
app.get('/api/*', async (req, res) => {
    if (!LEGACY_LEAFLINK_API_KEY) {
        return res.status(400).json({ error: 'LEAFLINK_API_KEY not configured. Use /api/business/:slug/* instead.' });
    }
    try {
        const endpoint = req.params[0];
        const queryParams = new URLSearchParams(req.query).toString();
        const url = `${LEAFLINK_API_URL}/${endpoint}${queryParams ? '?' + queryParams : ''}`;
        console.log(`[legacy] Fetching: ${url}`);
        const response = await fetch(url, {
            headers: {
                'Authorization': `App ${LEGACY_LEAFLINK_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) {
            throw new Error(`LeafLink API error: ${response.status}`);
        }
        const data = await response.json();
        const proxyBase = getProxyBaseUrl(req);
        rewritePaginationUrls(data, proxyBase);
        res.json(data);
    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`WM-Tracker server running on port ${PORT}`);
    console.log('Multi-tenant mode:', supabase ? 'ENABLED' : 'DISABLED (legacy mode)');
    console.log('Serving app and LeafLink proxy!');
});
