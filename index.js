// index.js
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason 
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const P = require("pino");
const fs = require("fs");
const qrcode = require("qrcode-terminal");
const http = require("http");
const config = require("./config");

// ---- CONTINUOUS PORT HEALTH CHECK BINDING FOR RENDER SERVER KEEPALIVE ----
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Core Infrastructure Health Check Engine Active and Running\n");
}).listen(PORT, "0.0.0.0", () => {
    console.log(`[SYSTEM] Live keep-alive architecture port binding established on connection rule: ${PORT}`);
});
// -------------------------------------------------------------------------

// Local persistent filesystem database initialization 
const DB_FILE = "./database.json";
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: {} }, null, 2));
}

function getDatabase() {
    try {
        return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
    } catch (e) {
        return { users: {} };
    }
}

function saveDatabase(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

async function startBot() {
    // Preemptively ensure auth session folder structures are created cleanly
    if (!fs.existsSync("./auth_session")) {
        fs.mkdirSync("./auth_session", { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState("auth_session");

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // Prevents core terminal deprecation crash faults
        logger: P({ level: "silent" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Clean manual QR text generation interpreter block
        if (qr) {
            console.log("\n==========================================================================");
            console.log("📷 SCAN THIS HIGH-CONTRAST QR CODE VIA WHATSAPP LINKED DEVICES MANAGER:");
            console.log("==========================================================================\n");
            qrcode.generate(qr, { small: true });
        }

        if (connection === "close") {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom) 
                ? lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut 
                : true;
            console.log(`[NETWATCH] Network link detached. Reconnection status loop: ${shouldReconnect}`);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === "open") {
            console.log(`\n==================================================\n[SUCCESS] ${config.botName} RUNNING STABLY IN PRODUCTION!\n==================================================\n`);
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

            // ---- ECONOMY ENGINE COMMAND IMPLEMENTATIONS ----
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

            // ---- ADMINISTRATIVE FUNCTION COMMAND IMPLEMENTATIONS ----
            else if (command === "kick") {
                if (!isGroup) return reply("This administrative action is strictly restricted to valid group layouts.");

                const groupMetadata = await sock.groupMetadata(from);
                const isSenderAdmin = groupMetadata.participants.find(p => p.id === sender)?.admin;
                
                if (sender !== config.ownerNumber && !isSenderAdmin) {
                    return reply("Failed to kick user(s): not-authorized");
                }

                let target = "";
                const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
                
                if (mentions && mentions.length > 0) {
                    target = String(mentions[0]); // Safe extraction mapping from array
                } else if (args.length > 0) {
                    const rawNum = String(args[0]).replace(/[^0-9]/g, ""); // Safe validation parsing text string
                    if (rawNum.length > 5) {
                        target = `${rawNum}@s.whatsapp.net`;
                    }
                }

                if (!target || target.length < 15) {
                    return reply("⚠️ Error: Please mention a valid user tag (@user) or provide their full phone number configuration.");
                }
                
                await sock.groupParticipantsUpdate(from, [target], "remove");
                await reply("Target profile successfully ejected from this chat thread ecosystem context.");
            }

        } catch (err) {
            console.error("[CRITICAL CAPTURE RUNTIME FAULT]: ", err);
        }
    });
}

startBot();
