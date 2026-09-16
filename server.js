const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const TurndownService = require('turndown');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced'
});

turndownService.remove(['script', 'style', 'noscript', 'iframe', 'img']);

async function scrapeToMarkdown(targetUrl) {
  let browser;
  try {
    // Configure executable path for Vercel/Serverless envs vs local
    const executablePath = await chromium.executablePath();

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: executablePath,
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );

    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    const html = await page.content();
    await browser.close();

    const dom = new JSDOM(html, { url: targetUrl });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.content) {
      throw new Error('Failed to extract readable content from target URL.');
    }

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
