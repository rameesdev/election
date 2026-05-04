const express = require('express');
// Polyfill for 'File is not defined' error in older Node.js versions
if (typeof File === 'undefined') {
    const { Blob } = require('buffer');
    if (typeof Blob !== 'undefined') {
        global.File = class File extends Blob {
            constructor(parts, filename, options = {}) {
                super(parts, options);
                this.name = filename;
                this.lastModified = options.lastModified || Date.now();
            }
        };
    }
}
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());


const BASE_URL = 'https://results.eci.gov.in/ResultAcGenMay2026/';
const PARTYWISE_URL = `${BASE_URL}partywiseresult-S11.htm`;

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9,ml;q=0.8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Host': 'results.eci.gov.in',
    'Pragma': 'no-cache',
    'Referer': 'https://results.eci.gov.in/',
    'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
};

app.get('/api/results', async (req, res) => {
    try {
        console.log(`Fetching data from: ${PARTYWISE_URL}`);
        const response = await axios.get(PARTYWISE_URL, { headers: HEADERS, timeout: 15000 });
        const html = response.data;
        const $ = cheerio.load(html);
        
        const parties = [];
        $('table tr').each((i, row) => {
            const cells = $(row).find('td');
            if (cells.length < 3) return;
            const partyName = $(cells[0]).text().trim();
            if (!partyName || partyName.toLowerCase() === 'total' || partyName.toLowerCase() === 'party') return;
            const won = parseInt($(cells[1]).text().trim()) || 0;
            const leading = parseInt($(cells[2]).text().trim()) || 0;
            const total = parseInt($(cells[3]).text().trim()) || (won + leading);
            parties.push({ partyName, won, leading, total });
        });

        const bodyText = $('body').text();
        const m = bodyText.match(/Last Updated.*?(\d{2}:\d{2}\s*[AP]M.*)/i);
        const updatedAt = m ? m[1].trim() : 'Just now';

        res.json({ parties, updatedAt });
    } catch (error) {
        console.error('Error fetching ECI data:', error.message);
        res.status(500).json({ error: 'Failed to fetch data from ECI', details: error.message });
    }
});

app.get('/api/constituency/:id', async (req, res) => {
    const constId = req.params.id; // e.g. S11115
    const url = `${BASE_URL}Constituencywise${constId}.htm`;
    try {
        console.log(`Fetching constituency data from: ${url}`);
        const response = await axios.get(url, { headers: HEADERS, timeout: 15000 });
        const html = response.data;
        const $ = cheerio.load(html);
        
        // ECI constituency pages usually have a table with candidates
        const candidates = [];
        
        $('table tr').each((i, row) => {
            const cells = $(row).find('td');
            // ECI usually has 5-6 columns: S.No, Candidate, Party, EVM Votes, Postal Votes, Total Votes, % of Votes
            if (cells.length < 4) return;
            
            const candidate = $(cells[1]).text().trim();
            const party = $(cells[2]).text().trim();
            const votesText = $(cells[5]).text().trim() || $(cells[3]).text().trim(); // Try Total column first, then EVM
            const votes = parseInt(votesText.replace(/,/g, '')) || 0;
            let status = $(cells[6]).text().trim() || $(cells[4]).text().trim(); // Try Status column or next available
            
            if (candidate && party && !candidate.toLowerCase().includes('candidate')) {
                candidates.push({ candidate, party, votes, status });
            }
        });

        // Sort by votes descending
        candidates.sort((a, b) => b.votes - a.votes);

        // If status is empty or '0', mark the top one as 'Leading'
        if (candidates.length > 0) {
            candidates.forEach((c, idx) => {
                if (!c.status || c.status === '0' || /^\d+$/.test(c.status)) {
                    c.status = (idx === 0) ? 'Leading' : 'Trailing';
                }
            });
        }

        const constName = $('h2 span strong').text().trim() || constId;
        res.json({ constName, candidates });
    } catch (error) {
        console.error('Error fetching constituency data:', error.message);
        res.status(500).json({ error: 'Failed to fetch constituency data', details: error.message });
    }
});

// Export the app for Vercel
module.exports = app;

if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running at http://0.0.0.0:${PORT}`);
    });
}
