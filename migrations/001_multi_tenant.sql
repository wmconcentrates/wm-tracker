-- Multi-Tenant Migration for WM-Tracker
-- Run this in Supabase SQL Editor

-- ============================================
-- STEP 1: Create businesses table
-- ============================================
CREATE TABLE IF NOT EXISTS businesses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    logo_url TEXT,
    primary_color TEXT DEFAULT '#bf00ff',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- STEP 2: Create business_api_keys table
-- ============================================
CREATE TABLE IF NOT EXISTS business_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    service TEXT NOT NULL,
    api_key_encrypted TEXT NOT NULL,
    api_key_hint TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(business_id, service)
);

-- ============================================
-- STEP 3: Seed initial businesses
-- ============================================
INSERT INTO businesses (id, name, slug, display_name, primary_color)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'White Mousse', 'white-mousse', 'White Mousse', '#bf00ff'),
    ('22222222-2222-2222-2222-222222222222', 'Bubblman', 'bubblman', 'Bubblman', '#00bfff')
ON CONFLICT (slug) DO NOTHING;

-- ============================================
-- STEP 4: Add business_id column to all tables
-- ============================================

-- wm_batches
ALTER TABLE wm_batches
ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);

-- wm_employees
ALTER TABLE wm_employees
ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);

-- wm_machines
ALTER TABLE wm_machines
ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);

-- wm_product_types
ALTER TABLE wm_product_types
ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);

-- wm_material_types
ALTER TABLE wm_material_types
ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);

-- wm_machine_status
ALTER TABLE wm_machine_status
ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);

-- wm_inventory
ALTER TABLE wm_inventory
ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);

-- wm_inventory_transactions
ALTER TABLE wm_inventory_transactions
ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);

-- wm_login_history
ALTER TABLE wm_login_history
ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);

-- sales_data_cache
ALTER TABLE sales_data_cache
ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);

-- drop_calendar_cache
ALTER TABLE drop_calendar_cache
ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);

-- ============================================
-- STEP 5: Migrate existing data to White Mousse
-- ============================================
UPDATE wm_batches SET business_id = '11111111-1111-1111-1111-111111111111' WHERE business_id IS NULL;
UPDATE wm_employees SET business_id = '11111111-1111-1111-1111-111111111111' WHERE business_id IS NULL;
UPDATE wm_machines SET business_id = '11111111-1111-1111-1111-111111111111' WHERE business_id IS NULL;
UPDATE wm_product_types SET business_id = '11111111-1111-1111-1111-111111111111' WHERE business_id IS NULL;
UPDATE wm_material_types SET business_id = '11111111-1111-1111-1111-111111111111' WHERE business_id IS NULL;
UPDATE wm_machine_status SET business_id = '11111111-1111-1111-1111-111111111111' WHERE business_id IS NULL;
UPDATE wm_inventory SET business_id = '11111111-1111-1111-1111-111111111111' WHERE business_id IS NULL;
UPDATE wm_inventory_transactions SET business_id = '11111111-1111-1111-1111-111111111111' WHERE business_id IS NULL;
UPDATE wm_login_history SET business_id = '11111111-1111-1111-1111-111111111111' WHERE business_id IS NULL;
UPDATE sales_data_cache SET business_id = '11111111-1111-1111-1111-111111111111' WHERE business_id IS NULL;
UPDATE drop_calendar_cache SET business_id = '11111111-1111-1111-1111-111111111111' WHERE business_id IS NULL;

-- ============================================
-- STEP 6: Create indexes for performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_wm_batches_business ON wm_batches(business_id);
CREATE INDEX IF NOT EXISTS idx_wm_employees_business ON wm_employees(business_id);
CREATE INDEX IF NOT EXISTS idx_wm_machines_business ON wm_machines(business_id);
CREATE INDEX IF NOT EXISTS idx_wm_product_types_business ON wm_product_types(business_id);
CREATE INDEX IF NOT EXISTS idx_wm_material_types_business ON wm_material_types(business_id);
CREATE INDEX IF NOT EXISTS idx_wm_inventory_business ON wm_inventory(business_id);
CREATE INDEX IF NOT EXISTS idx_sales_data_cache_business ON sales_data_cache(business_id);

-- ============================================
-- STEP 7: Enable RLS on businesses table
-- ============================================
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_api_keys ENABLE ROW LEVEL SECURITY;

-- Allow read access to businesses for authenticated users
CREATE POLICY "Allow read businesses" ON businesses
    FOR SELECT USING (true);

-- API keys only accessible via service role (server-side)
CREATE POLICY "API keys server only" ON business_api_keys
    FOR ALL USING (false);

-- ============================================
-- VERIFICATION QUERIES (run these after migration)
-- ============================================
-- SELECT * FROM businesses;
-- SELECT COUNT(*), business_id FROM wm_batches GROUP BY business_id;
-- SELECT COUNT(*), business_id FROM wm_employees GROUP BY business_id;
