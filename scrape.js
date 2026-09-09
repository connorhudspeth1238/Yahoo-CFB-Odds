import puppeteer from 'puppeteer';
import fs from 'fs';

async function scrapeYahooScores() {
    // Launch headless browser
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    // Go to Yahoo NFL Scoreboard (you can make this dynamic later for CFB)
    await page.goto('https://sports.yahoo.com/nfl/scoreboard/', { waitUntil: 'networkidle2' });

    // Wait for game elements to load on the page
    // Note: You'll inspect Yahoo's actual class names once, but here's the logical loop:
    const games = await page.evaluate(() => {
        const gameCards = document.querySelectorAll('.game-card'); // Replace with Yahoo's actual container class
        let results = [];

        gameCards.forEach(card => {
            const status = card.querySelector('.game-status')?.innerText || 'LIVE';
            const awayTeam = card.querySelector('.away-team-name')?.innerText || 'Team A';
            const awayScore = card.querySelector('.away-score')?.innerText || '0';
            const awayLogo = card.querySelector('.away-logo img')?.src || '';

            const homeTeam = card.querySelector('.home-team-name')?.innerText || 'Team B';
            const homeScore = card.querySelector('.home-score')?.innerText || '0';
            const homeLogo = card.querySelector('.home-logo img')?.src || '';

            results.push({
                status,
                awayTeam: { name: awayTeam, score: awayScore, logo: awayLogo },
                homeTeam: { name: homeTeam, score: homeScore, logo: homeLogo }
            });
        });

        return results;
    });

    // Save data to games.json
    fs.writeFileSync('games.json', JSON.stringify(games, null, 2));
    console.log(`Successfully scraped ${games.length} games!`);

    await browser.close();
}

scrapeYahooScores();
