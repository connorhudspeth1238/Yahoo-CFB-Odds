import puppeteer from 'puppeteer';
import fs from 'fs';

async function scrapeYahooScores() {
    console.log("Launching headless browser...");
    let browser;
    try {
        browser = await puppeteer.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        
        await page.emulateTimezone('America/Chicago');
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        console.log("Navigating to Yahoo Sports Scoreboard...");
        await page.goto('https://sports.yahoo.com/college-football/scoreboard/?leagueFilter=divisionIds_1', { 
            waitUntil: 'domcontentloaded',
            timeout: 60000 
        });

        console.log("Waiting for game cards to load...");
        await page.waitForSelector('div[id^="ncaaf.g."]', { timeout: 15000 });

        console.log("Extracting game cards...");
        const games = await page.evaluate(() => {
            const gameCards = document.querySelectorAll('div[id^="ncaaf.g."]');
            let results = [];
            let seenGames = new Set();

            gameCards.forEach(card => {
                const cardId = card.id || '';
                const teamContainers = card.querySelectorAll('div._ys_1gde6sj');
                if (teamContainers.length < 2) return;

                // Extract team names first so we can explicitly skip them from being parsed as dates
                const extractTeamData = (container, isLiveOrFinal) => {
                    const nameEl = container.querySelector('._ys_159h2dm');
                    const name = nameEl ? nameEl.innerText.trim() : '';
                    
                    const allSpans = Array.from(container.querySelectorAll('span'));
                    let record = '';
                    let score = '';
                    
                    allSpans.forEach(span => {
                        const txt = span.innerText.trim();
                        if (/^[0-9]+-[0-9]+$/.test(txt)) {
                            record = txt;
                        }
                    });

                    if (isLiveOrFinal) {
                        const scoreEl = container.querySelector('._ys_1lqk2dn');
                        score = scoreEl ? scoreEl.innerText.trim() : '';
                    }

                    let rank = '';
                    allSpans.forEach(span => {
                        const txt = span.innerText.trim();
                        if (/^(?:#)?([1-2]?[0-9])$/.test(txt) && !txt.includes('-')) {
                            const val = parseInt(txt.replace('#', ''), 10);
                            if (val >= 1 && val <= 25) {
                                rank = val.toString();
                            }
                        }
                    });

                    return { name, record, score, rank };
                };

                const fullCardText = card.innerText.toLowerCase();
                const isFinal = fullCardText.includes('final');
                const isLive = fullCardText.includes('q1') || fullCardText.includes('q2') || fullCardText.includes('q3') || fullCardText.includes('q4') || fullCardText.includes('half') || fullCardText.includes('ot');
                const isLiveOrFinal = isFinal || isLive;

                const awayTeam = extractTeamData(teamContainers[0], isLiveOrFinal);
                const homeTeam = extractTeamData(teamContainers[1], isLiveOrFinal);
                if (!awayTeam.name || !homeTeam.name) return;

                // Strict Date & Time Parsing: Check all small text blocks
                const allTextElements = Array.from(card.querySelectorAll('div, span')).map(el => el.innerText.trim()).filter(Boolean);
                let rawDate = '';
                let rawTime = '';

                for (let text of allTextElements) {
                    const lower = text.toLowerCase();

                    // Skip team names, records, scores, odds, and networks
                    if (text === awayTeam.name || text === homeTeam.name || text.includes('O/U') || text.includes('-') || /^[0-9]+-[0-9]+$/.test(text) || text.length > 25) {
                        continue;
                    }

                    // Match time format (e.g., "7:00 PM")
                    if (!rawTime && (text.includes(':') || lower.includes('pm') || lower.includes('am')) && text.length < 10) {
                        rawTime = text;
                    }
                    // Match date format (e.g., "Thu, 9/10", "Fri 9/11", or month names)
                    else if (!rawDate && (text.includes('/') || lower.includes('thu') || lower.includes('fri') || lower.includes('sat') || lower.includes('sun') || lower.includes('mon') || lower.includes('tue') || lower.includes('wed') || lower.includes('sep') || lower.includes('oct') || lower.includes('nov') || lower.includes('dec') || lower.includes('jan'))) {
                        if (text.length < 15 && !text.includes(':')) {
                            rawDate = text;
                        }
                    }
                }

                // If game is today and shows only a time, inject today's date automatically
                if (!rawDate && rawTime) {
                    const options = { timeZone: 'America/Chicago', weekday: 'short', month: 'numeric', day: 'numeric' };
                    rawDate = new Intl.DateTimeFormat('en-US', options).format(new Date());
                }

                let dateTimeDisplay = [rawDate, rawTime].filter(Boolean).join(', ');
                if (dateTimeDisplay && !dateTimeDisplay.includes('CDT')) {
                    dateTimeDisplay += ' CDT';
                }

                let gameStatus = isFinal ? 'FINAL' : (isLive ? 'LIVE' : 'UPCOMING');

                const logos = card.querySelectorAll('img._ys_14fh01c');
                const awayLogo = logos[0] ? logos[0].src : '';
                const homeLogo = logos[1] ? logos[1].src : '';

                const uniqueKey = cardId ? cardId : `${awayTeam.name}-${homeTeam.name}`;
                if (seenGames.has(uniqueKey)) return;
                seenGames.add(uniqueKey);

                const oddsElement = card.querySelector('._ys_ea8nnj');
                let odds = oddsElement ? oddsElement.innerText.trim() : '';

                results.push({
                    datetime: dateTimeDisplay,
                    status: gameStatus,
                    odds: odds,
                    awayTeam: { 
                        name: awayTeam.name, 
                        rank: awayTeam.rank, 
                        record: awayTeam.record, 
                        score: awayTeam.score, 
                        logo: awayLogo 
                    },
                    homeTeam: { 
                        name: homeTeam.name, 
                        rank: homeTeam.rank, 
                        record: homeTeam.record, 
                        score: homeTeam.score, 
                        logo: homeLogo 
                    }
                });
            });

            return results;
        });

        fs.writeFileSync('games.json', JSON.stringify(games, null, 2));
        console.log(`Successfully scraped and saved ${games.length} games to games.json!`);

    } catch (error) {
        console.error("CRITICAL SCRAPE ERROR:", error);
        process.exit(1);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

scrapeYahooScores();
