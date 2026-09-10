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

                // Grab all text pieces inside the card to safely extract time, date, and TV
                const allElements = card.querySelectorAll('div, span');
                let rawTime = '';
                let rawDate = '';
                let broadcastChannel = '';

                allElements.forEach(el => {
                    if (el.children.length > 0) return; // Leaf nodes only
                    const text = el.innerText.trim();
                    const lower = text.toLowerCase();

                    if (!text || text.includes('O/U') || text.includes('Spread') || text.length > 30) return;

                    // Match time (e.g., "6:00 PM", "11:30 AM")
                    if ((text.includes(':') || lower.includes('pm') || lower.includes('am')) && 
                        !lower.includes('thu') && !lower.includes('fri') && !lower.includes('sat') && 
                        !lower.includes('sun') && !lower.includes('mon') && !lower.includes('tue') && !lower.includes('wed') &&
                        !text.includes('-') && !rawTime) {
                        rawTime = text;
                    } 
                    // Match date strings or days
                    else if ((text.includes('/') || lower.includes('thu') || lower.includes('fri') || lower.includes('sat') || lower.includes('sun') || lower.includes('mon') || lower.includes('tue') || lower.includes('wed') || text.includes('Sep') || text.includes('Oct') || text.includes('Nov')) && !rawDate && text.length < 15) {
                        rawDate = text;
                    } 
                    // Match standard TV networks
                    else if (['ESPN', 'ESPN2', 'ABC', 'FOX', 'FS1', 'FS2', 'CBS', 'SEC_N', 'ACCN', 'NBC', 'PEACOCK'].includes(text) && !broadcastChannel) {
                        broadcastChannel = text;
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
                    let rank = '';

                    allSpans.forEach(span => {
                        const txt = span.innerText.trim();
                        if (/^[0-9]+-[0-9]+$/.test(txt)) {
                            record = txt;
                        } else if (/^(?:#)?([1-2]?[0-9])$/.test(txt) && !txt.includes('-')) {
                            const val = parseInt(txt.replace('#', ''), 10);
                            if (val >= 1 && val <= 25) rank = val.toString();
                        }
                    });

                    if (isFinal || isLive) {
                        const scoreEl = container.querySelector('._ys_1lqk2dn') || allSpans[allSpans.length - 1];
                        score = scoreEl ? scoreEl.innerText.trim() : '';
                    }

                    return { name, mascot: '', record, score, rank };
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
                    tv: broadcastChannel,
                    awayTeam,
                    homeTeam
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
        if (browser) await browser.close();
    }
}

scrapeYahooScores();
