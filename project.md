LearnWealthX SEO Agent — Product Flow
The Big Picture
You have two products:

learnwealthx.in — your course platform (the site being optimized)
SEO Agent (localhost:3000) — the tool that monitors and improves learnwealthx.in
How It All Connects
learnwealthx.in (Next.js on Vercel)
        ↑ reads blog posts
        ↑ GA4 tracking sends data
        
SEO Agent (localhost:3000)
        ↓ crawls learnwealthx.in
        ↓ publishes blog posts via GitHub
        ↓ reads GA4 + GSC data
        
GitHub (harshprasad06/learnwealthx_frontend)
        ↑ SEO agent commits blog posts here
        ↓ Vercel auto-deploys on push
        
PostgreSQL (local, port 5432)
        ← SEO agent stores all data here
        
Google APIs (GSC + GA4 + PageSpeed)
        ← SEO agent reads data from here
        
Serper.dev
        ← SEO agent checks keyword rankings + backlinks here
        
Gemini / Groq
        ← SEO agent uses AI for blog writing, reports, emails
Daily Flow (What Happens When You Click "Start Agent")
You click ▶ Start Agent
    │
    ▼
[1] Check keywords table
    → Empty? Seed from SITE_SEED_KEYWORDS env
    → Has data? Skip
    │
    ▼
[2] Crawl learnwealthx.in
    → Fetch sitemap.xml
    → Visit each page (courses, blog, about, etc.)
    → Extract: title, meta description, H1, viewport, status code
    → Save to: pages + page_crawl_results tables
    → Detect issues → save to: recommendations table
    │
    ▼
[3] Track keyword rankings
    → For each keyword in DB, call Serper
    → Check if learnwealthx.in appears in top 100 Google results
    → Update: current_position, previous_position, intent_cluster
    │
    ▼
[4] Discover new keywords
    → Has GSC data? → Find queries with 10+ impressions not yet tracked
    → No GSC data? → AI reads homepage → generates 15 relevant keywords
    → Add new keywords to DB
    │
    ▼
[5] Sync Google Search Console
    → Fetch clicks, impressions, CTR, position for last 7 days
    → Save to: gsc_data_points table
    │
    ▼
[6] Sync Google Analytics 4
    → Fetch organic sessions per page per day
    → Save to: ga_data_points table
    → Shows as bar chart on dashboard
    │
    ▼
[7] Sync backlinks
    → Serper: link:learnwealthx.in
    → Find who links to you
    → Detect lost high-DA links
    → Save to: backlinks table
    │
    ▼
[8] Monitor competitors
    → For each competitor (realwealth.com, skillindiadigital.gov.in, etc.)
    → Serper: site:competitor.com
    → Track their top pages as keywords
    → Save to: competitor_keywords table
    │
    ▼
[9] Find outreach prospects
    → Search for sites linking to competitors
    → Search for "write for us" guest post opportunities
    → Scrape contact emails from their /contact pages
    → Save to: outreach_opportunities table
    │
    ▼
[10] Check follow-up reminders
    → Find prospects contacted 7+ days ago
    → Log warning in dashboard
    │
    ▼
[11] CRO audit
    → Fetch each page
    → Score: CTA presence, social proof, trust signals, word count
    → Low score? → Create recommendation
    │
    ▼
[12] CTR optimizer
    → Find pages with 50+ impressions but <3% CTR in GSC
    → AI generates better title + meta description
    → Create recommendation
    │
    ▼
[13] Internal link audit
    → Scan pages for keyword mentions that could link to other pages
    → Create "add internal link" recommendations
    │
    ▼
[14] Schema audit
    → Find pages without JSON-LD structured data
    → Generate WebPage / Article / Organization schema
    → Create recommendation
    │
    ▼
[15] PageSpeed audit
    → Google PageSpeed Insights API for each page
    → Measure LCP, INP, CLS (Core Web Vitals)
    → Poor score? → Create recommendation
    → Save to: cwv_results table
    │
    ▼
[16] Generate blog posts
    → Check daily limit (max 3/day)
    → AI generates blog post targeting a keyword
    → Inject internal links automatically
    → Add Unsplash featured image
    → Save as draft to: blog_posts table
    │
    ▼
Agent complete ✓
What You Do After Agent Runs
Dashboard → Action Queue
    → See pending recommendations
    → Approve → auto-fix applied via GitHub PR
    → Reject → suppressed 30 days

Blog Posts page
    → Review AI drafts
    → Edit if needed
    → Click "🚀 Publish Directly"
        → Commits MDX to GitHub
        → Vercel deploys
        → learnwealthx.in/blog/{slug} goes live
        → Google sitemap pinged

Backlinks → Outreach Pipeline
    → See prospects with contact emails
    → Click "✉ Draft Email" → AI writes personalized email
    → Copy → send from your Gmail
    → Update status: contacted → followed up → link acquired

Competitors page
    → Click "🧠 Analyze My Site" → AI reads your site
    → Click "🔍 Find Competitors" → discovers similar sites
    → Add relevant ones → agent tracks their keywords

Reports page
    → Generate daily/weekly/monthly report
    → AI writes executive summary
    → See traffic charts, keyword changes, backlink gains
The GitHub Connection

SEO Agent approves a blog post
    ↓
GitHub API: PUT /repos/harshprasad06/learnwealthx_frontend/contents/app/blog/{slug}/page.mdx
    ↓
File committed to main branch
    ↓
Vercel detects push → auto-deploys
    ↓
https://www.learnwealthx.in/blog/{slug} is live
    ↓
Google sitemap ping sent → Google re-crawls sitemap