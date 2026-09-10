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

                const allSpansOrDivs = card.querySelectorAll('div, span');
                let rawTime = '';
                let rawDate = '';
                let odds = '';

                allSpansOrDivs.forEach(el => {
                    if (el.children.length > 0) return; // Leaf nodes only
                    const text = el.innerText.trim();
                    if (!text) return;

                    // Detect Odds (e.g., "-3.5", "+7", "O/U 54.5")
                    if (text.includes('O/U') || /^[+-][0-9]+(\.[0-9]+)?$/.test(text) || text.includes('EVEN') || text.includes('PK')) {
                        if (!odds) odds = text;
                    }

                    // Strict Time Extraction (e.g., "7:00 PM")
                    const timeMatch = text.match(/[0-9]{1,2}:[0-9]{2}\s*(?:AM|PM|am|pm)?/);
                    if (timeMatch && !rawTime) {
                        rawTime = timeMatch[0].toUpperCase();
                    }

                    // Strict Date Extraction (e.g., "Thu, 9/10" or "Sep 10")
                    const dateMatch = text.match(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s*(?:[A-Za-z]+\s+[0-9]{1,2}|[0-9]{1,2}\/[0-9]{1,2})|[A-Za-z]+\s+[0-9]{1,2}|[0-9]{1,2}\/[0-9]{1,2}/);
                    if (dateMatch && !rawDate) {
                        rawDate = dateMatch[0];
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

                    return { name, mascot: mascot === name ? '' : mascot, record, score, rank };
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

                results.push({
                    datetime: dateTimeDisplay,
                    status: gameStatus,
                    odds: odds,
                    awayTeam: { 
                        name: awayTeam.name, 
                        mascot: awayTeam.mascot, 
                        rank: awayTeam.rank, 
                        record: awayTeam.record, 
                        score: awayTeam.score, 
                        logo: awayLogo 
                    },
                    homeTeam: { 
                        name: homeTeam.name, 
                        mascot: homeTeam.mascot, 
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
