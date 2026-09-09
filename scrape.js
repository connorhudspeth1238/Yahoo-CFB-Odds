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
        
        // Force the browser to use US Central time
        await page.emulateTimezone('America/Chicago');
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        console.log("Navigating to Yahoo Sports Scoreboard...");
        await page.goto('https://sports.yahoo.com/college-football/scoreboard/?leagueFilter=divisionIds_1', { 
            waitUntil: 'networkidle2',
            timeout: 60000 
        });

        console.log("Waiting for game cards to load...");
        await page.waitForSelector('div[id^="ncaaf.g."], div[id^="nfl.g."]', { timeout: 15000 });

        console.log("Extracting game cards...");
        const games = await page.evaluate(() => {
            const gameCards = document.querySelectorAll('div[id^="ncaaf.g."], div[id^="nfl.g."]');
            let results = [];
            let seenGames = new Set();

            gameCards.forEach(card => {
                const teamNames = card.querySelectorAll('._ys_159h2dm');
                const awayTeamName = teamNames[0] ? teamNames[0].innerText : '';
                const homeTeamName = teamNames[1] ? teamNames[1].innerText : '';

                if (!awayTeamName || !homeTeamName) return;

                const parseRank = (teamElement) => {
                    if (!teamElement) return '';
                    const row = teamElement.closest('div');
                    if (!row) return '';
                    const text = row.innerText.trim();
                    const lines = text.split('\n').map(l => l.trim());
                    for (let line of lines) {
                        if (/^(?:#)?[1-2]?[0-9]$/.test(line)) {
                            return line.replace('#', '');
                        }
                    }
                    return '';
                };

                const awayRanking = parseRank(teamNames[0]);
                const homeRanking = parseRank(teamNames[1]);

                const logos = card.querySelectorAll('img._ys_14fh01c');
                const awayLogo = logos[0] ? logos[0].src : '';
                const homeLogo = logos[1] ? logos[1].src : '';

                const metaElements = card.querySelectorAll('._ys_qoenog, ._ys_aug67i');
                let gameTime = '';
                let gameDate = '';
                let broadcastChannel = '';

                metaElements.forEach(el => {
                    const text = el.innerText.trim();
                    const lower = text.toLowerCase();

                    if ((text.includes(':') || lower.includes('pm') || lower.includes('am')) && !lower.includes('thu') && !lower.includes('fri') && !lower.includes('sat')) {
                        gameTime = text;
                    } else if (text.includes('/') || lower.includes('thu') || lower.includes('fri') || lower.includes('sat') || lower.includes('sun') || lower.includes('mon') || lower.includes('tue') || lower.includes('wed')) {
                        gameDate = text;
                    } else if (text.length > 0 && text.length <= 6 && text === text.toUpperCase() && !text.includes('-')) {
                        broadcastChannel = text;
                    }
                });

                const uniqueKey = `${awayTeamName}-${homeTeamName}-${gameDate || gameTime}`;
                if (seenGames.has(uniqueKey)) return;
                seenGames.add(uniqueKey);

                const fullCardText = card.innerText.toLowerCase();
                const isLiveOrFinal = fullCardText.includes('final') || fullCardText.includes('q1') || fullCardText.includes('q2') || fullCardText.includes('q3') || fullCardText.includes('q4') || fullCardText.includes('half');
                
                let gameStatus = 'UPCOMING';
                if (isLiveOrFinal) {
                    gameStatus = fullCardText.includes('final') ? 'FINAL' : 'LIVE';
                } else if (broadcastChannel) {
                    gameStatus = broadcastChannel;
                }

                const scoreElements = card.querySelectorAll('span._ys_1lqk2dn');
                let awayScore = '';
                let homeScore = '';

                if (isLiveOrFinal && scoreElements.length >= 2) {
                    awayScore = scoreElements[0].innerText;
                    homeScore = scoreElements[1].innerText;
                }

                const oddsElement = card.querySelector('._ys_ea8nnj');
                let odds = '';
                if (oddsElement) {
                    const text = oddsElement.innerText;
                    if (text.includes('-') || text.includes('+') || text.includes('O/U')) {
                        odds = text;
                    }
                }

                results.push({
                    time: gameTime,
                    date: gameDate,
                    status: gameStatus,
                    odds,
                    awayTeam: { name: awayTeamName, rank: awayRanking, score: awayScore, logo: awayLogo },
                    homeTeam: { name: homeTeamName, rank: homeRanking, score: homeScore, logo: homeLogo }
                });
            });

            return results;
        });

        fs.writeFileSync('games.json', JSON.stringify(games, null, 2));
        console.log(`Successfully scraped and saved ${games.length} unique games to games.json!`);

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
