require('dotenv').config({ path: '.env.local' });
require('dotenv').config(); // fallback to .env
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');
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

// Google Drive Service Account Configuration
let googleDrive = null;
const GOOGLE_SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
if (GOOGLE_SERVICE_ACCOUNT_KEY) {
    try {
        // Fix for Railway/Heroku: env vars convert \n to actual newlines, breaking JSON
        // Always escape any actual newlines or carriage returns before parsing
        const keyToParse = GOOGLE_SERVICE_ACCOUNT_KEY
            .replace(/\r\n/g, '\\n')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\n');

        const credentials = JSON.parse(keyToParse);

        // Ensure private_key has actual newlines for the crypto library
        if (credentials.private_key) {
            credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
        }

        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/drive.readonly']
        });
        googleDrive = google.drive({ version: 'v3', auth });
        console.log('Google Drive service account initialized');
    } catch (error) {
        console.warn('Google Drive service account not configured:', error.message);
    }
} else {
    console.warn('GOOGLE_SERVICE_ACCOUNT_KEY not set - COA sync will not work');
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
// LEAFLINK PRODUCT MAPPING ENDPOINTS
// ============================================

// Sync LeafLink products for a business
app.post('/api/internal/businesses/:id/leaflink/sync', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Database not configured' });

    try {
        // Get business
        const { data: business, error: bizError } = await supabase
            .from('businesses')
            .select('*')
            .eq('id', req.params.id)
            .single();
        if (bizError || !business) {
            return res.status(404).json({ error: 'Business not found' });
        }

        // Get API key
        const apiKey = await getBusinessApiKey(business.id, 'leaflink');
        if (!apiKey) {
            return res.status(400).json({ error: 'LeafLink not configured for this business' });
        }

        // Fetch products from LeafLink (all pages)
        let allProducts = [];
        let nextUrl = `${LEAFLINK_API_URL}/products/?page_size=100`;
        let pageCount = 0;

        while (nextUrl && pageCount < 20) {
            const response = await fetch(nextUrl, {
                headers: {
                    'Authorization': `App ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            });
            if (!response.ok) {
                throw new Error(`LeafLink API error: ${response.status}`);
            }
            const data = await response.json();
            allProducts = allProducts.concat(data.results || []);
            nextUrl = data.next;
            pageCount++;
        }

        // Fetch product lines from LeafLink
        let allProductLines = [];
        nextUrl = `${LEAFLINK_API_URL}/product-lines/?page_size=100`;
        pageCount = 0;

        while (nextUrl && pageCount < 10) {
            const response = await fetch(nextUrl, {
                headers: {
                    'Authorization': `App ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            });
            if (!response.ok) {
                throw new Error(`LeafLink API error: ${response.status}`);
            }
            const data = await response.json();
            allProductLines = allProductLines.concat(data.results || []);
            nextUrl = data.next;
            pageCount++;
        }

        // Clear old cache for this business
        await supabase.from('leaflink_products_cache').delete().eq('business_id', business.id);
        await supabase.from('leaflink_product_lines_cache').delete().eq('business_id', business.id);

        // Insert products into cache
        if (allProducts.length > 0) {
            const productRows = allProducts.map(p => ({
                business_id: business.id,
                leaflink_id: p.id,
                name: p.name,
                sku: p.sku,
                category_id: p.category?.id || p.category,
                category_name: p.category?.name,
                product_line_id: p.product_line?.id || p.product_line,
                product_line_name: p.product_line?.name,
                parent_id: p.parent?.id || p.parent,
                seller_id: p.seller?.id || p.seller,
                brand_id: p.brand?.id || p.brand,
                license_id: p.license?.id || p.license,
                unit_of_measure: p.unit_of_measure,
                unit_denomination_id: p.unit_denomination?.id || p.unit_denomination,
                raw_data: p,
                cached_at: new Date().toISOString()
            }));

            const { error: insertError } = await supabase
                .from('leaflink_products_cache')
                .insert(productRows);
            if (insertError) console.error('Error caching products:', insertError);
        }

        // Insert product lines into cache
        if (allProductLines.length > 0) {
            const lineRows = allProductLines.map(pl => ({
                business_id: business.id,
                leaflink_id: pl.id,
                name: pl.name,
                raw_data: pl,
                cached_at: new Date().toISOString()
            }));

            const { error: insertError } = await supabase
                .from('leaflink_product_lines_cache')
                .insert(lineRows);
            if (insertError) console.error('Error caching product lines:', insertError);
        }

        res.json({
            success: true,
            products_synced: allProducts.length,
            product_lines_synced: allProductLines.length
        });

    } catch (error) {
        console.error('Sync error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get cached LeafLink products for a business
app.get('/api/internal/businesses/:id/leaflink/products', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Database not configured' });

    try {
        const { data, error } = await supabase
            .from('leaflink_products_cache')
            .select('*')
            .eq('business_id', req.params.id)
            .order('name');

        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('Error fetching cached products:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get cached LeafLink product lines for a business
app.get('/api/internal/businesses/:id/leaflink/product-lines', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Database not configured' });

    try {
        const { data, error } = await supabase
            .from('leaflink_product_lines_cache')
            .select('*')
            .eq('business_id', req.params.id)
            .order('name');

        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('Error fetching cached product lines:', error);
        res.status(500).json({ error: error.message });
    }
});

// Suggest mappings based on cached products
app.get('/api/internal/businesses/:id/leaflink/suggest-mappings', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Database not configured' });

    try {
        // Get cached product lines
        const { data: productLines, error } = await supabase
            .from('leaflink_product_lines_cache')
            .select('*')
            .eq('business_id', req.params.id);

        if (error) throw error;

        // Get all cached products to find parent products
        const { data: allProducts } = await supabase
            .from('leaflink_products_cache')
            .select('*')
            .eq('business_id', req.params.id);

        const sampleProduct = allProducts?.[0];

        // Auto-detect mappings based on product line names
        // Prices are per CASE (10 units)
        const suggestions = [];
        const appProductTypes = [
            // Solventless products (check specific matches first)
            { type: 'Bubble Hash', keywords: ['bubble hash', 'bubble'], excludeKeywords: ['brick'], category: 'concentrate', categoryId: 5, price: 80 },
            { type: 'Hash Hits', keywords: ['hash hits', 'hash hit'], category: 'concentrate', categoryId: 5, price: 100 },
            { type: 'Brick Hash 1g', keywords: ['brick hash 1g', 'brick hash 1 gram', 'brick 1g'], category: 'concentrate', categoryId: 5, price: 80 },
            { type: 'Brick Hash 4g', keywords: ['brick hash 4g', 'brick hash 4 gram', 'brick 4g'], category: 'concentrate', categoryId: 5, price: 280 },
            { type: 'Brick Hash', keywords: ['brick hash', 'brick'], excludeKeywords: ['1g', '4g', '1 gram', '4 gram'], category: 'concentrate', categoryId: 5, price: 80 },
            { type: 'Rosin', keywords: ['rosin'], excludeKeywords: ['disposable', 'aio', 'cart'], category: 'concentrate', categoryId: 5, price: 100 },
            // BHO/Hydrocarbon products
            { type: 'Sugar Wax', keywords: ['sugar wax', 'sugar'], category: 'concentrate', categoryId: 5, price: 60 },
            { type: 'Wax', keywords: ['wax'], excludeKeywords: ['sugar'], category: 'concentrate', categoryId: 5, price: 60 },
            { type: 'Shatter', keywords: ['shatter'], category: 'concentrate', categoryId: 5, price: 60 },
            { type: 'Badder', keywords: ['badder', 'batter'], category: 'concentrate', categoryId: 5, price: 60 },
            { type: 'Diamonds', keywords: ['diamond'], category: 'concentrate', categoryId: 5, price: 80 },
            { type: 'Sauce', keywords: ['sauce'], category: 'concentrate', categoryId: 5, price: 60 },
            // Vapes
            { type: 'Live Resin Carts', keywords: ['cart', 'cartridge'], excludeKeywords: ['rosin'], category: 'cart', categoryId: 1, price: 150 },
            { type: 'Live Resin AIOs', keywords: ['all in one', 'aio', 'disposable', 'all-in-one'], category: 'cart', categoryId: 1, price: 220 }
        ];

        for (const appType of appProductTypes) {
            let matchedLine = null;
            let confidence = 0;

            for (const line of (productLines || [])) {
                const lineName = line.name.toLowerCase();

                // Check exclude keywords first
                if (appType.excludeKeywords && appType.excludeKeywords.some(kw => lineName.includes(kw))) {
                    continue;
                }

                // Check include keywords
                const matchedKeywords = appType.keywords.filter(kw => lineName.includes(kw));
                if (matchedKeywords.length > 0) {
                    const newConfidence = matchedKeywords.length / appType.keywords.length;
                    if (newConfidence > confidence) {
                        matchedLine = line;
                        confidence = newConfidence;
                    }
                }
            }

            // Find a parent product for this product line (a product with no parent that belongs to this line)
            let parentProduct = null;
            if (matchedLine && allProducts) {
                // Look for a product in this product line that has no parent (is itself a parent)
                // Cached products use product_line_id and parent_id fields
                parentProduct = allProducts.find(p => {
                    const hasNoParent = !p.parent_id;
                    const matchesLine = p.product_line_id == matchedLine.leaflink_id;
                    return hasNoParent && matchesLine;
                });

                // If no parent-less product found, just use any product from this line
                if (!parentProduct) {
                    parentProduct = allProducts.find(p => p.product_line_id == matchedLine.leaflink_id);
                }
            }

            // Get unit info from parent product's raw_data
            const parentRaw = parentProduct?.raw_data || {};
            const sampleRaw = sampleProduct?.raw_data || {};

            suggestions.push({
                app_product_type: appType.type,
                app_category: appType.category,
                leaflink_category_id: appType.categoryId,
                price_per_unit: appType.price,
                suggested_product_line: matchedLine ? {
                    id: matchedLine.leaflink_id,
                    name: matchedLine.name
                } : null,
                suggested_parent_id: parentProduct?.leaflink_id || null,
                confidence: matchedLine ? confidence : 0,
                // Include config from matched product (for correct unit settings) or sample
                leaflink_seller_id: parentProduct?.seller_id || sampleProduct?.seller_id,
                leaflink_brand_id: parentProduct?.brand_id || sampleProduct?.brand_id,
                leaflink_license_id: parentProduct?.license_id || sampleProduct?.license_id,
                leaflink_unit_denomination_id: parentProduct?.unit_denomination_id || sampleProduct?.unit_denomination_id,
                leaflink_unit_of_measure: parentProduct?.unit_of_measure || (appType.category === 'cart' ? 'Unit' : 'Gram'),
                // Unit configuration from raw_data
                unit_multiplier: parentRaw.unit_multiplier || sampleRaw.unit_multiplier || 10,
                sell_in_unit_of_measure: parentRaw.sell_in_unit_of_measure || sampleRaw.sell_in_unit_of_measure || 'Case',
                grams_per_unit: parentRaw.unit_denomination?.value ? parseFloat(parentRaw.unit_denomination.value) : 1
            });
        }

        res.json(suggestions);

    } catch (error) {
        console.error('Error suggesting mappings:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get saved mappings for a business
app.get('/api/internal/businesses/:id/leaflink/mappings', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Database not configured' });

    try {
        const { data, error } = await supabase
            .from('leaflink_product_mappings')
            .select('*')
            .eq('business_id', req.params.id)
            .eq('is_active', true);

        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('Error fetching mappings:', error);
        res.status(500).json({ error: error.message });
    }
});

// Save/update mappings for a business
app.post('/api/internal/businesses/:id/leaflink/mappings', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Database not configured' });

    try {
        const mappings = req.body.mappings;
        if (!Array.isArray(mappings)) {
            return res.status(400).json({ error: 'mappings must be an array' });
        }

        const businessId = req.params.id;

        // Upsert each mapping
        for (const mapping of mappings) {
            const upsertData = {
                business_id: businessId,
                app_product_type: mapping.app_product_type,
                app_category: mapping.app_category,
                leaflink_product_line_id: mapping.leaflink_product_line_id,
                leaflink_parent_id: mapping.leaflink_parent_id,
                leaflink_category_id: mapping.leaflink_category_id,
                price_per_unit: mapping.price_per_unit,
                leaflink_seller_id: mapping.leaflink_seller_id,
                leaflink_brand_id: mapping.leaflink_brand_id,
                leaflink_license_id: mapping.leaflink_license_id,
                leaflink_unit_of_measure_id: mapping.leaflink_unit_of_measure_id,
                leaflink_unit_denomination_id: mapping.leaflink_unit_denomination_id,
                leaflink_product_line_name: mapping.leaflink_product_line_name,
                is_active: true,
                updated_at: new Date().toISOString()
            };

            // Add unit config fields if provided (requires DB columns)
            if (mapping.leaflink_unit_of_measure) upsertData.leaflink_unit_of_measure = mapping.leaflink_unit_of_measure;
            if (mapping.unit_multiplier) upsertData.unit_multiplier = mapping.unit_multiplier;
            if (mapping.sell_in_unit_of_measure) upsertData.sell_in_unit_of_measure = mapping.sell_in_unit_of_measure;
            if (mapping.grams_per_unit) upsertData.grams_per_unit = mapping.grams_per_unit;

            const { error } = await supabase
                .from('leaflink_product_mappings')
                .upsert(upsertData, {
                    onConflict: 'business_id,app_product_type'
                });

            if (error) {
                console.error('Error upserting mapping:', error);
            }
        }

        res.json({ success: true, mappings_saved: mappings.length });

    } catch (error) {
        console.error('Error saving mappings:', error);
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

// ============================================
// GOOGLE DRIVE COA ENDPOINTS
// ============================================

// List COA PDF files from Google Drive
app.get('/api/google-drive/list-coas/:slug', async (req, res) => {
    if (!googleDrive) {
        return res.status(503).json({ error: 'Google Drive not configured. Set GOOGLE_SERVICE_ACCOUNT_KEY in .env.local' });
    }

    try {
        const { slug } = req.params;
        const folderName = req.query.folder || 'COAs';

        // Find the COAs folder
        const folderResponse = await googleDrive.files.list({
            q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
            fields: 'files(id, name)',
            pageSize: 1
        });

        if (!folderResponse.data.files || folderResponse.data.files.length === 0) {
            return res.status(404).json({
                error: `Folder "${folderName}" not found. Make sure it's shared with the service account.`
            });
        }

        const folderId = folderResponse.data.files[0].id;

        // List PDF files in the folder
        const filesResponse = await googleDrive.files.list({
            q: `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`,
            fields: 'files(id, name, createdTime, modifiedTime)',
            orderBy: 'modifiedTime desc',
            pageSize: 100
        });

        res.json({
            folderId,
            folderName,
            files: filesResponse.data.files || []
        });
    } catch (error) {
        console.error('Google Drive list error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Download a COA PDF file from Google Drive
app.get('/api/google-drive/download/:slug/:fileId', async (req, res) => {
    if (!googleDrive) {
        return res.status(503).json({ error: 'Google Drive not configured' });
    }

    try {
        const { fileId } = req.params;

        // Get file content
        const response = await googleDrive.files.get({
            fileId,
            alt: 'media'
        }, {
            responseType: 'arraybuffer'
        });

        // Return as base64 for frontend parsing
        const base64 = Buffer.from(response.data).toString('base64');
        res.json({
            fileId,
            data: base64,
            contentType: 'application/pdf'
        });
    } catch (error) {
        console.error('Google Drive download error:', error);
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
