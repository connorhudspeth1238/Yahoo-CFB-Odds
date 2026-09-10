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
            waitUntil: 'networkidle2',
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

                const metaElements = card.querySelectorAll('._ys_qoenog, ._ys_aug67i');
                let rawTime = '';
                let rawDate = '';
                let broadcastChannel = '';

                metaElements.forEach(el => {
                    const text = el.innerText.trim();
                    const lower = text.toLowerCase();

                    if (text.includes('O/U') || (text.includes('-') && (text.includes('.') || text.length > 5))) {
                        return;
                    }

                    if ((text.includes(':') || lower.includes('pm') || lower.includes('am')) && !lower.includes('thu') && !lower.includes('fri') && !lower.includes('sat') && !lower.includes('sun') && !lower.includes('mon')) {
                        rawTime = text;
                    } else if (text.includes('/') || lower.includes('thu') || lower.includes('fri') || lower.includes('sat') || lower.includes('sun') || lower.includes('mon') || lower.includes('tue') || lower.includes('wed')) {
                        rawDate = text;
                    } else if (text.length > 0 && text.length <= 6 && text === text.toUpperCase() && !text.includes('-') && !text.includes('/')) {
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
                const isLiveOrFinal = isFinal || isLive;

                let gameStatus = isFinal ? 'FINAL' : (isLive ? 'LIVE' : 'UPCOMING');

                const extractTeamData = (container) => {
                    const nameEl = container.querySelector('._ys_159h2dm');
                    const name = nameEl ? nameEl.innerText.trim() : '';
                    
                    const allSpans = Array.from(container.querySelectorAll('span'));
                    let mascot = '';
                    const textSpans = allSpans.map(s => s.innerText.trim());
                    for (let t of textSpans) {
                        if (t && t !== name && !/^[0-9]+$/.test(t) && !t.includes('-') && t.length > 2 && !/^(?:#)?[0-9]+$/.test(t)) {
                            mascot = t;
                            break;
                        }
                    }

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

                    return { name, mascot: mascot === name ? '' : mascot, record, score, rank: '' };
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
                let odds = '';
                if (oddsElement) {
                    const text = oddsElement.innerText.trim();
                    if (text.length > 0) {
                        odds = text;
                    }
                }

                results.push({
                    datetime: dateTimeDisplay,
                    status: gameStatus,
                    odds: odds,
                    tv: broadcastChannel,
                    awayTeam: { name: awayTeam.name, mascot: awayTeam.mascot, rank: awayTeam.rank, record: awayTeam.record, score: awayTeam.score, logo: awayLogo },
                    homeTeam: { name: homeTeam.name, mascot: homeTeam.mascot, rank: homeTeam.rank, record: homeTeam.record, score: homeTeam.score, logo: homeLogo }
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
