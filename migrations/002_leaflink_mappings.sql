-- LeafLink Product Mapping System
-- Run this in Supabase SQL Editor

-- Table to store per-business LeafLink product mappings
CREATE TABLE IF NOT EXISTS leaflink_product_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

    -- App-side identifiers
    app_product_type TEXT NOT NULL,     -- 'Sugar Wax', 'Wax', 'Shatter', etc.
    app_category TEXT,                   -- 'concentrate', 'cart'

    -- LeafLink identifiers
    leaflink_product_line_id INTEGER,    -- Product line ID from LeafLink
    leaflink_parent_id INTEGER,          -- Parent product ID for varieties
    leaflink_category_id INTEGER,        -- LeafLink category (5=Concentrates, 1=Vaporizers)

    -- Pricing
    price_per_unit DECIMAL(10,2),        -- Wholesale price per gram/unit

    -- LeafLink config (fetched from their products)
    leaflink_seller_id INTEGER,
    leaflink_brand_id INTEGER,
    leaflink_license_id INTEGER,
    leaflink_unit_of_measure_id INTEGER,
    leaflink_unit_denomination_id INTEGER,

    -- Metadata
    leaflink_product_line_name TEXT,     -- Name from LeafLink for reference
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(business_id, app_product_type)
);

-- Cache table for LeafLink products (for selection UI)
CREATE TABLE IF NOT EXISTS leaflink_products_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

    leaflink_id INTEGER NOT NULL,        -- Product ID in LeafLink
    name TEXT NOT NULL,
    sku TEXT,
    category_id INTEGER,
    category_name TEXT,
    product_line_id INTEGER,
    product_line_name TEXT,
    parent_id INTEGER,

    -- Config values to extract
    seller_id INTEGER,
    brand_id INTEGER,
    license_id INTEGER,
    unit_of_measure TEXT,
    unit_denomination_id INTEGER,

    raw_data JSONB,                      -- Full LeafLink response
    cached_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(business_id, leaflink_id)
);

-- Cache table for LeafLink product lines
CREATE TABLE IF NOT EXISTS leaflink_product_lines_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

    leaflink_id INTEGER NOT NULL,        -- Product Line ID in LeafLink
    name TEXT NOT NULL,

    raw_data JSONB,
    cached_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(business_id, leaflink_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_leaflink_mappings_business ON leaflink_product_mappings(business_id);
CREATE INDEX IF NOT EXISTS idx_leaflink_products_cache_business ON leaflink_products_cache(business_id);
CREATE INDEX IF NOT EXISTS idx_leaflink_product_lines_cache_business ON leaflink_product_lines_cache(business_id);

-- Enable RLS
ALTER TABLE leaflink_product_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaflink_products_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaflink_product_lines_cache ENABLE ROW LEVEL SECURITY;

-- RLS policies (allow all for service role, read for anon)
CREATE POLICY "Allow all for service role" ON leaflink_product_mappings FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON leaflink_products_cache FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON leaflink_product_lines_cache FOR ALL USING (true);

-- Seed White Mousse mappings (migrate from hardcoded values)
-- Using the White Mousse business ID
INSERT INTO leaflink_product_mappings (
    business_id, app_product_type, app_category,
    leaflink_parent_id, leaflink_category_id, price_per_unit,
    leaflink_product_line_name
) VALUES
    ('11111111-1111-1111-1111-111111111111', 'Sugar Wax', 'concentrate', 215740, 5, 6.00, 'Sugar Wax - 1 Gram'),
    ('11111111-1111-1111-1111-111111111111', 'Sugar Wax 4g', 'concentrate', 215740, 5, 6.00, 'Sugar Wax - 4 Gram'),
    ('11111111-1111-1111-1111-111111111111', 'Wax', 'concentrate', 215673, 5, 6.00, 'Wax - 1 Gram'),
    ('11111111-1111-1111-1111-111111111111', 'Wax 4g', 'concentrate', 215673, 5, 6.00, 'Wax - 4 Gram'),
    ('11111111-1111-1111-1111-111111111111', 'Shatter', 'concentrate', 215669, 5, 6.00, 'Shatter'),
    ('11111111-1111-1111-1111-111111111111', 'Live Resin Carts', 'cart', 1040719, 1, 15.00, '100% Live Resin Cartridges 1g'),
    ('11111111-1111-1111-1111-111111111111', 'Live Resin AIOs', 'cart', 1252729, 1, 22.00, '100% Live Resin All-In-One'),
    ('11111111-1111-1111-1111-111111111111', 'Brick Hash', 'concentrate', 2568608, 5, 8.00, 'Brick Hash')
ON CONFLICT (business_id, app_product_type) DO NOTHING;

SELECT 'Migration complete. Created tables: leaflink_product_mappings, leaflink_products_cache, leaflink_product_lines_cache' as status;
