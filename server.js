const express = require('express');
const axios = require('axios');
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

/**
 * Normalizes URLs to bypass aggressive bot blocks (e.g., Reddit)
 */
function prepareUrl(url) {
  let target = url;
  
  // Convert standard Reddit URLs to old.reddit.com to bypass network security blocks
  if (target.includes('reddit.com') && !target.includes('old.reddit.com')) {
    target = target.replace('www.reddit.com', 'old.reddit.com').replace('reddit.com', 'old.reddit.com');
  }
  
  return target;
}

async function scrapeToMarkdown(inputUrl) {
  const targetUrl = prepareUrl(inputUrl);

  // Strategy 1: Direct Fetch via Mobile User-Agent + Readability
  try {
    const response = await axios.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 10000
    });

    const dom = new JSDOM(response.data, { url: targetUrl });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (article && article.content) {
      const markdown = turndownService.turndown(article.content);
      if (markdown.trim().length > 100 && !markdown.includes("You've been blocked")) {
        return {
          title: article.title || '',
          byline: article.byline || null,
          excerpt: article.excerpt || '',
          siteName: article.siteName || '',
          length: markdown.length,
          markdown: markdown
        };
      }
    }
  } catch (err) {
    // Direct fetch failed; fall through to fallback
  }

  // Strategy 2: Fallback to Jina Reader
  try {
    const fallbackRes = await axios.get(`https://r.jina.ai/${targetUrl}`, {
      headers: { 'Accept': 'application/json' },
      timeout: 15000
    });

    const data = fallbackRes.data.data;
    return {
      title: data.title || '',
      byline: null,
      excerpt: data.description || '',
      siteName: '',
      length: data.content.length,
      markdown: data.content
    };
  } catch (fallbackErr) {
    throw new Error('Target site blocked automated requests.');
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
  console.log(`scrapi listening on port ${PORT}`);
});
