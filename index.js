// index.js
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason,
    delay
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const P = require("pino");
const fs = require("fs");
const http = require("http");
const config = require("./config");

// ---- LIVE WEB PORT SERVICE BINDING FOR RENDER SERVER KEEPALIVE ----
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Core Infrastructure Platform Active\n");
}).listen(PORT, "0.0.0.0", () => {
    console.log(`[SYSTEM] Live keep-alive architecture port binding established on connection rule: ${PORT}`);
});
// -------------------------------------------------------------------------

const DB_FILE = "./database.json";
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: {} }, null, 2));
}

function getDatabase() {
    try { return JSON.parse(fs.readFileSync(DB_FILE, "utf-8")); } 
    catch (e) { return { users: {} }; }
}

function saveDatabase(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

async function startBot() {
    if (!fs.existsSync("./auth_session")) {
        fs.mkdirSync("./auth_session", { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState("auth_session");

    // Re-engineered to explicitly pass a custom text device profile (Skips headless chrome browser download)
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: P({ level: "silent" }),
        browser: ["Chrome (Linux)", "Chrome", "114.0.5735.198"]
    });

    // ---- DIRECT TEXT-BASED PAIRING PROTOCOL METHOD ----
    if (!sock.authState.creds.registered) {
        // Strip out trailing server characters to get your clean mobile number
        const phoneNumberOnly = config.ownerNumber.split("@")[0]; 
        console.log(`\n[PAIRING] Requesting pairing token from WhatsApp for: +${phoneNumberOnly}\n`);
        
        await delay(6000); // Give Render network time to establish socket handshakes
        try {
            const code = await sock.requestPairingCode(phoneNumberOnly);
            console.log("\n==================================================");
            console.log(`🔑 YOUR WHATSAPP BOT PAIRING CODE IS: ${code}`);
            console.log("==================================================\n");
        } catch (error) {
            console.log("[PAIRING ERROR] Failed to fetch code token. Retrying on next loop cycle.");
        }
    }
    // --------------------------------------------------

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "close") {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom) 
                ? lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut 
                : true;
            console.log(`[NETWATCH] Connection cycling. Re-attempting handshake: ${shouldReconnect}`);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === "open") {
            console.log(`\n==================================================\n[SUCCESS] ${config.botName} IS ONLINE AND LINKED!\n==================================================\n`);
        }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        try {
            if (type !== "notify") return;
            const msg = messages[0];
            if (!msg || !msg.message || msg.key.fromMe) return;

            const from = msg.key.remoteJid;
            if (!from) return;
            
            const isGroup = from.endsWith("@g.us");
            const sender = isGroup ? msg.key.participant : from;
            if (!sender) return;
            
            const body = msg.message.conversation || 
                         msg.message.extendedTextMessage?.text || 
                         msg.message.imageMessage?.caption || "";
                         
            if (!body.startsWith(config.prefix)) return;

            const args = body.slice(config.prefix.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            let db = getDatabase();
            if (!db.users[sender]) {
                db.users[sender] = { wallet: 15991, bank: 0, lastDaily: 0 };
            }
            let user = db.users[sender];

            const reply = async (text) => {
                await sock.sendMessage(from, { text: text }, { quoted: msg });
            };

            if (command === "bal" || command === "balance") {
                const totalAssets = user.wallet + user.bank;
                const balLayout = `

| 🏛️ WISTORIA ECONOMY
|
| 💵 Wallet: ${config.currencySymbol}${user.wallet.toLocaleString()}

| 🏛️ Wistoria: ${config.currencySymbol}${user.bank.toLocaleString()}
| 💎 Assets: ${config.currencySymbol}${totalAssets.toLocaleString()}
|

| 💠 Wistoria Economy Bot Platform
`;
                await reply(balLayout.trim());
            }

            else if (command === "daily") {
                const now = Date.now();
                const cooldown = 24 * 60 * 60 * 1000;

                if (now - user.lastDaily < cooldown) {
                    return reply("⚠️ Daily balance collection is currently locked! Please check back tomorrow.");
                }

                user.wallet += config.dailyPayout;
                user.lastDaily = now;
                saveDatabase(db);
                await reply(`💰 DAILY REWARD DISPENSED\n+${config.currencySymbol}${config.dailyPayout.toLocaleString()} has been safely loaded into your active balance account!`);
            }

            else if (command === "kick") {
                if (!isGroup) return reply("This administrative action is restricted to groups.");

                const groupMetadata = await sock.groupMetadata(from);
                const isSenderAdmin = groupMetadata.participants.find(p => p.id === sender)?.admin;
                
                if (sender !== config.ownerNumber && !isSenderAdmin) {
                    return reply("Failed to kick user(s): not-authorized");
                }

                let target = "";
                const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
                
                if (mentions && mentions.length > 0) {
                    target = String(mentions[0]);
                } else if (args.length > 0) {
                    const rawNum = String(args[0]).replace(/[^0-9]/g, "");
                    if (rawNum.length > 5) {
                        target = `${rawNum}@s.whatsapp.net`;
                    }
                }

                if (!target || target.length < 15) {
                    return reply("⚠️ Error: Please mention a valid user tag (@user) or provide their full phone number.");
                }
                
                await sock.groupParticipantsUpdate(from, [target], "remove");
                await reply("Target profile successfully ejected from this chat thread.");
            }

        } catch (err) {
            console.error("[CRITICAL CAPTURE RUNTIME FAULT]: ", err);
        }
    });
}

startBot();
