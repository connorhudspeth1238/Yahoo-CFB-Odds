import puppeteer from 'puppeteer';
import fs from 'fs';

async function scrapeYahooScores() {
    console.log("Launching headless browser...");
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'] // Helps it run smoothly on servers / GitHub Actions
    });
    
    const page = await browser.newPage();

    // Set a realistic user agent so Yahoo doesn't block the scraper
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log("Navigating to Yahoo Sports Scoreboard...");
    // You can change this URL to nfl/scoreboard or college-football/scoreboard depending on what you want
    await page.goto('https://sports.yahoo.com/college-football/scoreboard/?leagueFilter=divisionIds_1', { 
        waitUntil: 'networkidle2',
        timeout: 60000 
    });

    console.log("Extracting game cards...");
    const games = await page.evaluate(() => {
        // Selects every individual game card container on the Yahoo scoreboard
        const gameCards = document.querySelectorAll('div[id^="ncaaf.g."], div[id^="nfl.g."]');
        let results = [];

        gameCards.forEach(card => {
            // Grab team names
            const teamNames = card.querySelectorAll('._ys_159h2dm');
            const awayTeamName = teamNames[0] ? teamNames[0].innerText : '';
            const homeTeamName = teamNames[1] ? teamNames[1].innerText : '';

            // Grab scores 
            const scores = card.querySelectorAll('._ys_1lqk2dn');
            const awayScore = scores[0] ? scores[0].innerText : '0';
            const homeScore = scores[1] ? scores[1].innerText : '0';

            // Grab logos
            const logos = card.querySelectorAll('img._ys_14fh01c');
            const awayLogo = logos[0] ? logos[0].src : '';
            const homeLogo = logos[1] ? logos[1].src : '';

            // Grab time / status
            const timeElement = card.querySelector('._ys_qoenog');
            const status = timeElement ? timeElement.innerText : 'UPCOMING';

            // Grab betting odds if available
            const oddsElement = card.querySelector('._ys_ea8nnj');
            const odds = oddsElement ? oddsElement.innerText : '';

            results.push({
                status,
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
