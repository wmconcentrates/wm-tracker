# White Mousse Blog Setup

## 1. Create the Blog Posts Table in Supabase

Go to your Supabase dashboard → SQL Editor → Run this:

```sql
-- Create blog posts table
CREATE TABLE wm_blog_posts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    excerpt TEXT,
    content TEXT,
    category TEXT NOT NULL,
    author TEXT,
    emoji TEXT DEFAULT '📝',
    image_url TEXT,
    batch_id UUID REFERENCES wm_batches(id),
    status TEXT DEFAULT 'draft',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE wm_blog_posts ENABLE ROW LEVEL SECURITY;

-- Allow public to read published posts
CREATE POLICY "Public can read published posts"
ON wm_blog_posts FOR SELECT
USING (status = 'published');

-- Allow authenticated users to manage posts (for admin)
CREATE POLICY "Allow all operations for now"
ON wm_blog_posts FOR ALL
USING (true)
WITH CHECK (true);

-- Create index for faster queries
CREATE INDEX idx_blog_posts_status ON wm_blog_posts(status);
CREATE INDEX idx_blog_posts_category ON wm_blog_posts(category);
CREATE INDEX idx_blog_posts_created ON wm_blog_posts(created_at DESC);
```

## 2. Deploy the Blog

Option A: **Vercel (Recommended)**
1. Push this repo to GitHub
2. Connect to Vercel
3. Set the blog folder as a separate project, or host at `/blog` path

Option B: **Same domain as tracker**
The blog is at `/blog/index.html` - it will work alongside your tracker

## 3. Set Up Custom Domain (Optional)

To use `blog.whitemousse.com`:
1. In Vercel, add the custom domain
2. In Squarespace DNS, add a CNAME record:
   - Name: `blog`
   - Value: `cname.vercel-dns.com`

## 4. Link from Main Site

Add a link in Squarespace navigation pointing to your blog URL.

---

## Features

- **Electric Forest theme** matching your tracker
- **Auto-generate posts** from completed batches
- **Staff Portal** for employees to write/edit posts (uses same PINs as tracker)
- **Categories**: New Drops, Strain Spotlight, Education, Behind the Scenes, News
- **SEO optimized** with meta tags, Open Graph, and schema.org markup
- **Real-time updates** via Supabase
- **Batch data integration** - link posts to production batches
