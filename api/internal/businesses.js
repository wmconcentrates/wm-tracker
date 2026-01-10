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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (!supabase) {
        return res.status(500).json({ error: 'Database not configured' });
    }

    if (req.method === 'GET') {
        try {
            const { data, error } = await supabase
                .from('businesses')
                .select('id, name, slug, display_name, logo_url, primary_color, is_active')
                .order('name');
            if (error) throw error;
            return res.status(200).json(data);
        } catch (error) {
            console.error('Error listing businesses:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    if (req.method === 'POST') {
        try {
            const { name, slug, display_name, logo_url, primary_color } = req.body;
            const { data, error } = await supabase
                .from('businesses')
                .insert([{ name, slug, display_name, logo_url, primary_color }])
                .select()
                .single();
            if (error) throw error;
            return res.status(201).json(data);
        } catch (error) {
            console.error('Error creating business:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
