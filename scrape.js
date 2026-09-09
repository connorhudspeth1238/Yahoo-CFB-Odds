import puppeteer from 'puppeteer';
import fs from 'fs';

async function scrapeYahooScores() {
    console.log("Launching headless browser...");
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();

    // Set a realistic user agent to avoid being blocked
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log("Navigating to Yahoo Sports Scoreboard...");
    await page.goto('https://sports.yahoo.com/college-football/scoreboard/?leagueFilter=divisionIds_1', { 
        waitUntil: 'networkidle2',
        timeout: 60000 
    });

    console.log("Extracting game cards...");
    const games = await page.evaluate(() => {
        const gameCards = document.querySelectorAll('div[id^="ncaaf.g."], div[id^="nfl.g."]');
        let results = [];

        gameCards.forEach(card => {
            // Team Names
            const teamNames = card.querySelectorAll('._ys_159h2dm');
            const awayTeamName = teamNames[0] ? teamNames[0].innerText : '';
            const homeTeamName = teamNames[1] ? teamNames[1].innerText : '';

            // Logos
            const logos = card.querySelectorAll('img._ys_14fh01c');
            const awayLogo = logos[0] ? logos[0].src : '';
            const homeLogo = logos[1] ? logos[1].src : '';

            // Status / Time / Date
            const statusEls = card.querySelectorAll('._ys_qoenog');
            let timeText = '';
            let dateText = '';
            if (statusEls.length >= 2) {
                timeText = statusEls[0].innerText;
                dateText = statusEls[1].innerText;
            } else if (statusEls.length === 1) {
                timeText = statusEls[0].innerText;
            }

            // Check if game is active or final to safely grab scores
            const scoreElements = card.querySelectorAll('span._ys_1lqk2dn');
            let awayScore = '';
            let homeScore = '';
            
            const fullCardText = card.innerText.toLowerCase();
            const isLiveOrFinal = fullCardText.includes('final') || fullCardText.includes('q') || fullCardText.includes('half') || fullCardText.includes('et');

            if (isLiveOrFinal && scoreElements.length >= 2) {
                awayScore = scoreElements[0].innerText;
                homeScore = scoreElements[1].innerText;
            }

            // Betting Odds
            const oddsElement = card.querySelector('._ys_ea8nnj');
            const odds = oddsElement ? oddsElement.innerText : '';

            results.push({
                time: timeText,
                date: dateText,
                status: isLiveOrFinal ? timeText : 'UPCOMING',
                odds,
                awayTeam: { name: awayTeamName, score: awayScore, logo: awayLogo },
                homeTeam: { name: homeTeamName, score: homeScore, logo: homeLogo }
            });
        });

        return results;
    });

    // Save data to games.json in the root directory
    fs.writeFileSync('games.json', JSON.stringify(games, null, 2));
    console.log(`Successfully scraped and saved ${games.length} games to games.json!`);

    await browser.close();
}

scrapeYahooScores();
