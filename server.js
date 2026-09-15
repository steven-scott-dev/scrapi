const express = require('express');
const puppeteer = require('puppeteer');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const TurndownService = require('turndown');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Turndown service for HTML -> Markdown conversion
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced'
});

// Remove unnecessary elements prior to rendering Markdown
turndownService.remove(['script', 'style', 'noscript', 'iframe', 'img']);

/**
 * Core Scraper Function
 */
async function scrapeToMarkdown(targetUrl) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    
    // Set a realistic User-Agent to prevent simple bot blocks
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );

    // Navigate to page, wait until network is idle (max 30s)
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    const html = await page.content();
    await browser.close();

    // Parse HTML with JSDOM & Readability
    const dom = new JSDOM(html, { url: targetUrl });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.content) {
      throw new Error('Failed to extract readable content from target URL.');
    }

    // Convert cleaned article HTML to Markdown
    const markdown = turndownService.turndown(article.content);

    return {
      title: article.title || '',
      byline: article.byline || null,
      excerpt: article.excerpt || '',
      siteName: article.siteName || '',
      length: markdown.length,
      markdown: markdown
    };
  } catch (error) {
    if (browser) await browser.close();
    throw error;
  }
}

/**
 * POST /api/scrape
 * Body: { "url": "https://example.com" }
 */
app.post('/api/scrape', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'Missing "url" in request body.' });
  }

  try {
    const result = await scrapeToMarkdown(url);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to scrape URL',
      details: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Web-to-Markdown API listening on port ${PORT}`);
});
