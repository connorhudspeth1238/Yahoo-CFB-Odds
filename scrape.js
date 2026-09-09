import puppeteer from 'puppeteer';
import fs from 'fs';

async function scrapeYahooScores() {
    console.log("Launching headless browser...");
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log("Navigating to Yahoo Sports Scoreboard...");
    await page.goto('https://sports.yahoo.com/college-football/scoreboard/?leagueFilter=divisionIds_1', { 
        waitUntil: 'networkidle2',
        timeout: 60000 
    });

    // Give it a brief pause for dynamic elements to render
    await new Promise(resolve => setTimeout(resolve, 3000));

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

            // Time and Date using exact Yahoo class matching
            const timeDateEls = card.querySelectorAll('._ys_qoenog');
            const gameTime = timeDateEls[0] ? timeDateEls[0].innerText : '';
            const gameDate = timeDateEls[1] ? timeDateEls[1].innerText : '';

            // Status check
            const fullCardText = card.innerText.toLowerCase();
            const isLiveOrFinal = fullCardText.includes('final') || fullCardText.includes('q1') || fullCardText.includes('q2') || fullCardText.includes('q3') || fullCardText.includes('q4') || fullCardText.includes('half');
            
            let gameStatus = isLiveOrFinal ? (fullCardText.includes('final') ? 'FINAL' : 'LIVE') : 'UPCOMING';

            // Scores (Only extract if game is live or final)
            const scoreElements = card.querySelectorAll('span._ys_1lqk2dn');
            let awayScore = '';
            let homeScore = '';

            if (isLiveOrFinal && scoreElements.length >= 2) {
                awayScore = scoreElements[0].innerText;
                homeScore = scoreElements[1].innerText;
            }

            // Betting Odds
            const oddsElement = card.querySelector('._ys_ea8nnj');
            const odds = oddsElement ? oddsElement.innerText : '';

            results.push({
                time: gameTime,
                date: gameDate,
                status: gameStatus,
                odds,
                awayTeam: { name: awayTeamName, score: awayScore, logo: awayLogo },
                homeTeam: { name: homeTeamName, score: homeScore, logo: homeLogo }
            });
        });

        return results;
    });

    fs.writeFileSync('games.json', JSON.stringify(games, null, 2));
    console.log(`Successfully scraped and saved ${games.length} games to games.json!`);

    await browser.close();
}

scrapeYahooScores();
