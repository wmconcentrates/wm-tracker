const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const ENCRYPTION_KEY = process.env.API_KEY_ENCRYPTION_SECRET || 'default-dev-key-change-in-prod!!';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

let supabase = null;
if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

function encryptApiKey(apiKey) {
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(apiKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (!supabase) {
        return res.status(500).json({ error: 'Database not configured' });
    }

    const { id } = req.query;

    if (req.method === 'POST') {
        try {
            const { service, api_key } = req.body;

            if (!api_key || !service) {
                return res.status(400).json({ error: 'Missing api_key or service' });
            }

            const encrypted = encryptApiKey(api_key);
            const hint = api_key.slice(-4);

            // Upsert the API key
            const { data, error } = await supabase
                .from('business_api_keys')
                .upsert({
                    business_id: id,
                    service: service,
                    api_key_encrypted: encrypted,
                    api_key_hint: hint,
                    is_active: true
                }, {
                    onConflict: 'business_id,service'
                })
                .select()
                .single();

            if (error) throw error;
            return res.status(200).json({ success: true, hint: hint });
        } catch (error) {
            console.error('Error saving API key:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
