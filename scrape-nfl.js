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

                const metaEls = card.querySelectorAll('._ys_qoenog, ._ys_aug67i, div[class*="_ys_"]');
                let rawDate = '';
                let rawTime = '';

                metaEls.forEach(el => {
                    const text = el.innerText.trim();
                    const lower = text.toLowerCase();

                    if (!text || text.length > 20 || text.includes('O/U') || text.includes('-') || text === text.toUpperCase() && text.length <= 4) {
                        return;
                    }

                    if ((text.includes(':') || lower.includes('pm') || lower.includes('am')) && !rawTime) {
                        rawTime = text;
                    }
                    else if ((text.includes('/') || lower.includes('thu') || lower.includes('fri') || lower.includes('sat') || lower.includes('sun') || lower.includes('mon') || lower.includes('tue') || lower.includes('wed') || lower.includes('sep') || lower.includes('oct') || lower.includes('nov') || lower.includes('dec') || lower.includes('jan')) && !rawDate) {
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
                const isLiveOrFinal = isFinal || isLive;

                let gameStatus = isFinal ? 'FINAL' : (isLive ? 'LIVE' : 'UPCOMING');

                const extractTeamData = (container) => {
                    const nameEl = container.querySelector('._ys_159h2dm');
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

                    if (isLiveOrFinal) {
                        const scoreEl = container.querySelector('._ys_1lqk2dn');
                        score = scoreEl ? scoreEl.innerText.trim() : '';
                    }

                    return { name, record, score };
                };

                const awayTeam = extractTeamData(teamContainers[0]);
                const homeTeam = extractTeamData(teamContainers[1]);

                if (!awayTeam.name || !homeTeam.name) return;

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
                        record: awayTeam.record, 
                        score: awayTeam.score, 
                        logo: awayLogo 
                    },
                    homeTeam: { 
                        name: homeTeam.name, 
                        record: homeTeam.record, 
                        score: homeTeam.score, 
                        logo: homeLogo 
                    }
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
        if (browser) {
            await browser.close();
        }
    }
}

scrapeNflScores();
