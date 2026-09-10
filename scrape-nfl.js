import puppeteer from 'puppeteer';
import fs from 'fs';

async function scrapeNflScores() {
    console.log("Launching headless browser for NFL...");
    let browser;
    try {
        browser = await puppeteer.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        await page.emulateTimezone('America/Chicago');
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        console.log("Navigating to Yahoo NFL Scoreboard...");
        await page.goto('https://sports.yahoo.com/nfl/scoreboard/', { 
            waitUntil: 'domcontentloaded',
            timeout: 60000 
        });

        console.log("Waiting for NFL game cards to load...");
        await page.waitForSelector('div[id^="nfl.g."]', { timeout: 15000 });

        console.log("Extracting NFL game cards...");
        const games = await page.evaluate(() => {
            const gameCards = document.querySelectorAll('div[id^="nfl.g."]');
            let results = [];
            let seenGames = new Set();

            gameCards.forEach(card => {
                const cardId = card.id || '';
                const teamContainers = card.querySelectorAll('div._ys_1gde6sj');
                if (teamContainers.length < 2) return;

                const textNodes = [];
                const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT, null, false);
                let node;
                while (node = walker.nextNode()) {
                    const val = node.nodeValue.trim();
                    if (val) textNodes.push(val);
                }

                let rawTime = '';
                let rawDate = '';

                textNodes.forEach(text => {
                    const timeRegex = /^[0-9]{1,2}:[0-9]{2}\s*(?:AM|PM|am|pm)?$/;
                    if (timeRegex.test(text) && !rawTime) {
                        rawTime = text.toUpperCase();
                    }
                    const dateRegex = /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s*(?:[A-Za-z]+\s+[0-9]{1,2}|[0-9]{1,2}\/[0-9]{1,2})|[A-Za-z]+\s+[0-9]{1,2}|[0-9]{1,2}\/[0-9]{1,2}/;
                    if (dateRegex.test(text) && !rawDate && text.length < 15 && !text.includes('-')) {
                        rawDate = text;
                    }
                });

                if (!rawDate && rawTime) {
                    const options = { timeZone: 'America/Chicago', weekday: 'short', month: 'numeric', day: 'numeric' };
                    rawDate = new Intl.DateTimeFormat('en-US', options).format(new Date());
                }

                let dateTimeDisplay = [rawDate, rawTime].filter(Boolean).join(', ');
                if (dateTimeDisplay && !dateTimeDisplay.includes('CDT')) {
                    dateTimeDisplay += ' CDT';
                }

                const fullCardText = card.innerText.toLowerCase();
                const isFinal = fullCardText.includes('final');
                const isLive = fullCardText.includes('q1') || fullCardText.includes('q2') || fullCardText.includes('q3') || fullCardText.includes('q4') || fullCardText.includes('half') || fullCardText.includes('ot');
                let gameStatus = isFinal ? 'FINAL' : (isLive ? 'LIVE' : 'UPCOMING');

                const extractTeamData = (container) => {
                    const nameEl = container.querySelector('._ys_159h2dm') || container.querySelector('div');
                    const name = nameEl ? nameEl.innerText.trim() : '';
                    
                    const allSpans = Array.from(container.querySelectorAll('span'));
                    let record = '';
                    let score = '';
                    
                    allSpans.forEach(span => {
                        const txt = span.innerText.trim();
                        if (/^[0-9]+-[0-9]+(-[0-9]+)?$/.test(txt)) {
                            record = txt;
                        }
                    });

                    if (isFinal || isLive) {
                        const scoreEl = container.querySelector('._ys_1lqk2dn') || allSpans[allSpans.length - 1];
                        score = scoreEl ? scoreEl.innerText.trim() : '';
                    }

                    return { name, mascot: '', record, score, rank: '' };
                };

                const awayTeam = extractTeamData(teamContainers[0]);
                const homeTeam = extractTeamData(teamContainers[1]);

                if (!awayTeam.name || !homeTeam.name) return;

                const logos = card.querySelectorAll('img');
                const awayLogo = logos[0] ? logos[0].src : '';
                const homeLogo = logos[1] ? logos[1].src : '';

                const uniqueKey = cardId ? cardId : `${awayTeam.name}-${homeTeam.name}`;
                if (seenGames.has(uniqueKey)) return;
                seenGames.add(uniqueKey);

                results.push({
                    datetime: dateTimeDisplay,
                    status: gameStatus,
                    odds: '',
                    awayTeam,
                    homeTeam
                });
            });

            return results;
        });

        fs.writeFileSync('nfl-games.json', JSON.stringify(games, null, 2));
        console.log(`Successfully scraped and saved ${games.length} NFL games to nfl-games.json!`);

    } catch (error) {
        console.error("CRITICAL NFL SCRAPE ERROR:", error);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
    }
}

scrapeNflScores();
