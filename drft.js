const fs = require('fs');
const path = require('path');
const axios = require('axios');
const readline = require('readline');
const colors = require('colors');
const WebSocket = require('ws');
const { DateTime } = require('luxon');

class Drft {
    constructor() {
        this.ws = null;
        this.config = {
            baseUrl: 'https://drftparty.fibrum.com',
            claimInterval: 24 * 60 * 60,
            bufferTime: 5 * 60
        };
    }

    headers(token) {
        return {
            "Accept": "*/*",
            "Accept-Encoding": "gzip, deflate, br",
            "Accept-Language": "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
            "Referer": "https://drftparty.fibrum.com/game?tgWebAppStartParam=376905749",
            "Sec-Ch-Ua": '"Not/A)Brand";v="99", "Google Chrome";v="115", "Chromium";v="115"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            "Token": token,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
        };
    }

    log(msg) {
        console.log(`[*] ${msg}`);
    }

    async waitWithCountdown(seconds) {
        for (let i = seconds; i >= 0; i--) {
            readline.cursorTo(process.stdout, 0);
            process.stdout.write(`[*] Chờ ${i} giây để tiếp tục...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        console.log('');
    }

    async auth() {
        const dataFile = path.join(__dirname, 'data.txt');
        const data = fs.readFileSync(dataFile, 'utf8')
            .replace(/\r/g, '')
            .split('\n')
            .filter(Boolean);

        for (let no = 0; no < data.length; no++) {
            const token = data[no];
            try {
                const url = `${this.config.baseUrl}/api/auth`;
                const headers = this.headers(token);
                const response = await axios.get(url, { headers });

                const { first_name, drft, last_claim_drft_time, last_claim_task_time } = response.data;
                const currentTime = Math.floor(Date.now() / 1000);

                console.log(`\n========== Tài khoản ${no + 1} | ${first_name.green} ==========`);
                this.log(`${'DRFT:'.green} ${drft}`);

                await this.handleClaim(token, 'DRFT', last_claim_drft_time, currentTime, '201');
                await this.handleClaim(token, 'Daily', last_claim_task_time, currentTime, '101');

                await this.connectWebSocket(token);

                await this.waitWithCountdown(5);
                await this.closeWebSocket();
            } catch (error) {
                this.log(`Lỗi khi xử lý token ${token}: ${error.message}`);
            }
        }

        await this.waitWithCountdown(1 * 60);
        await this.auth();
    }

    async handleClaim(token, claimType, lastClaimTime, currentTime, taskId) {
        const headers = this.headers(token);
        if (currentTime > lastClaimTime + this.config.bufferTime &&
            currentTime - lastClaimTime >= this.config.claimInterval) {
            const claimUrl = `${this.config.baseUrl}/api/set-task?task_id=${taskId}&`;
            await axios.get(claimUrl, { headers });
            this.log(`Claim ${claimType} thành công`);

            const userInfoUrl = `${this.config.baseUrl}/api/get-user`;
            const userInfoResponse = await axios.get(userInfoUrl, { headers });
            const updatedLastClaimTime = userInfoResponse.data[`last_claim_${claimType.toLowerCase()}_time`];

            const formattedTime = DateTime.fromSeconds(parseInt(updatedLastClaimTime, 10)).toLocaleString(DateTime.DATETIME_MED);
            this.log(`Thời gian claim ${claimType} tiếp theo: ${formattedTime}`);
        } else {
            const formattedNextClaimTime = DateTime.fromSeconds(parseInt(lastClaimTime, 10) + this.config.claimInterval).toLocaleString(DateTime.DATETIME_MED);
            this.log(`Thời gian claim ${claimType} tiếp theo: ${formattedNextClaimTime}`);
        }
    }

    async connectWebSocket(token) {
        const encodedToken = Buffer.from(token).toString('base64');
        const wsUrl = `wss://drftparty.fibrum.com/?token=${encodedToken}`;
        this.ws = new WebSocket(wsUrl);

        this.ws.on('open', () => {
            console.log(`${'\n[*] Bắt đầu kết nối game!'.green}`);
        });

        this.ws.on('message', (data) => {
            try {
                const parsedMessage = JSON.parse(data);
                const nestedData = JSON.parse(parsedMessage.data);
                this.displayData(nestedData);
                this.sendInitialMessage(nestedData);
            } catch (error) {
                this.log(`${'Error parsing message:'.red} ${error}`);
            }
        });

        this.ws.on('error', (error) => {
            this.log(`${'WebSocket error:'.red} ${error}`);
        });

        this.ws.on('close', () => {
            this.log(`${'Ngắt kết nối game!'.yellow}`);
        });
    }

    async sendInitialMessage(nestedData) {
        let maxLevel = Math.max(...nestedData._grid.map(item => item.level));
        const positions = [0, 1, 2, 7, 4, 5, 6, 3, 8, 9, 10, 11];

        for (let i = 0; i < 100; i++) {
            const grid = positions.map(position => ({
                position,
                level: maxLevel + i + 1,
                state: 1
            }));

            const message = {
                command: "set",
                data: JSON.stringify({
                    _grid: grid,
                    carPurchases: [0, 9, 3],
                    mergesCount: 96000,
                    currentTime: Math.floor(Date.now() / 1000),
                    lastFixedTime: Math.floor(Date.now() / 1000),
                    lastDropTime: Date.now(),
                    _boosts: [
                        { isActive: true, timeUntil: 1723099046, timeThenUnlock: 1723505046, koeff: 2.0 },
                        { isActive: true, timeUntil: 1723099046, timeThenUnlock: 1723505046, koeff: 2.0 },
                        { isActive: true, timeUntil: 1723099046, timeThenUnlock: 1723505046, koeff: 2.0 }
                    ],
                    airDropsQueue: [],
                    cash: 99999999999999999999999999999999999999999999999999999999999999999999999.0,
                    settings: { sfx: true, music: true, haptics: true }
                })
            };
            this.sendMessage(message);
        }
    }

    sendMessage(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));

            const parsedMessage = JSON.parse(message.data);
            const levels = parsedMessage._grid.map(item => item.level);
            const maxLevel = Math.max(...levels);

            this.log(`${'Tăng cấp xe thành công lên level:'.green} ${maxLevel}`);
        } else {
            this.log(`${'WebSocket is not connected.'.red}`);
        }
    }

    displayData(data) {
        if (!data) {
            this.log(`${'No data to display.'.yellow}`);
            return;
        }

        const { cash, mergesCount, _grid } = data;

        this.log(`Cash: ${cash !== undefined ? cash.toFixed(2) : 'Not available'}`);
        this.log(`Merges Count: ${mergesCount !== undefined ? mergesCount : 'Not available'}`);

        if (_grid && Array.isArray(_grid)) {
            this.log('\nGrid State:');
            console.log(' Position | Level | State ');
            console.log('------------------------');

            _grid.forEach(item => {
                console.log(` ${item.position.toString().padEnd(8)} | ${item.level.toString().padEnd(5)} | ${item.state}`);
            });
        } else {
            console.log(`${'Grid data is not available or not in expected format.'.yellow}`);
        }
    }

    async main() {
        await this.auth();
    }

    closeWebSocket() {
        return new Promise((resolve) => {
            if (this.ws) {
                this.ws.on('close', () => {
                    resolve();
                });
                this.ws.close();
            } else {
                resolve();
            }
        });
    }
}

if (require.main === module) {
    const dancay = new Drft();
    dancay.main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}