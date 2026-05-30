const { Telegraf, Markup } = require("telegraf");
const admin = require("firebase-admin");
require("dotenv").config();

/* =========================
   BOT CONFIG
========================= */

const bot = new Telegraf(process.env.BOT_TOKEN);

const ADMIN_ID = 8750197296;

const ADMIN_CHAT_ID = "@seoulflix_baza";

const CHANNELS = [
    "@seoulflixorg",
    "@sengaatalganlari"
];

/* =========================
   FIREBASE
========================= */

const serviceAccount = JSON.parse(
    Buffer.from(
        process.env.GOOGLE_APPLICATION_CREDENTIALS,
        "base64"
    ).toString("utf8")
);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

/* =========================
   STATES
========================= */

const userStates = {};
const advData = {};

/* =========================
   SUBSCRIPTION CHECK
========================= */

async function checkSubscription(ctx) {

    const userId = ctx.from.id;

    let notSubscribed = [];

    for (const channel of CHANNELS) {

        try {

            const member =
                await bot.telegram.getChatMember(
                    channel,
                    userId
                );

            if (
                ["left", "kicked"]
                    .includes(member.status)
            ) {
                notSubscribed.push(channel);
            }

        } catch (err) {

            console.log(
                "Subscription Error:",
                err.message
            );

            return false;
        }
    }

    if (notSubscribed.length > 0) {

        const buttons =
            notSubscribed.map((ch, i) => [
                Markup.button.url(
                    `${i + 1} - Kanal`,
                    `https://t.me/${ch.replace("@", "")}`
                )
            ]);

        buttons.push([
            Markup.button.callback(
                "✅ Tekshirish",
                "check_membership"
            )
        ]);

        await ctx.reply(
            "❌ Botdan foydalanish uchun rasmiy kanalimizga obuna bo‘ling 👇",
            Markup.inlineKeyboard(buttons)
        );

        return false;
    }

    return true;
}

/* =========================
   START
========================= */

bot.start(async (ctx) => {

    const userId =
        ctx.from.id.toString();

    const userRef =
        db.collection("users")
            .doc(userId);

    const userDoc =
        await userRef.get();

    if (!userDoc.exists) {

        await userRef.set({
            userId: ctx.from.id,
            firstName:
                ctx.from.first_name || "",
            username:
                ctx.from.username || "",
            joinedAt:
                admin.firestore.Timestamp.now(),
        });
    }

    const subscribed =
        await checkSubscription(ctx);

    if (!subscribed) return;

    const keyboard = [
        [
            "📜 Drama ro‘yxati",
            "🔍 Drama izlash"
        ]
    ];

    if (ctx.from.id === ADMIN_ID) {

        keyboard.push([
            "📢 Reklama yuborish",
            "👥 Obunachilar soni"
        ]);
    }

    await ctx.reply(
        "🎬 SeoulFlix botiga xush kelibsiz!\n\nDrama kodini yuboring yoki menyudan foydalaning 👇",
        Markup.keyboard(keyboard)
            .resize()
    );
});

/* =========================
   MEMBERSHIP BUTTON
========================= */

bot.action(
    "check_membership",
    async (ctx) => {

        const subscribed =
            await checkSubscription(ctx);

        if (subscribed) {

            await ctx.reply(
                "✅ Obuna tasdiqlandi!\n\nEndi botdan foydalanishingiz mumkin 🎉"
            );
        }

        await ctx.answerCbQuery();
    }
);

/* =========================
   DRAMA LIST
========================= */

bot.hears(
    "📜 Drama ro‘yxati",
    async (ctx) => {

        const subscribed =
            await checkSubscription(ctx);

        if (!subscribed) return;

        const snapshot =
            await db
                .collection("films")
                .get();

        if (snapshot.empty) {

            return ctx.reply(
                "❌ Hozircha drama mavjud emas."
            );
        }

        let text =
            "🎬 SeoulFlix Drama Bazasi\n";

        snapshot.forEach((doc) => {

            const film =
                doc.data();

            text +=
                `\n🎞 ${film.title} — ${doc.id}`;
        });

        await ctx.reply(text);
    }
);

/* =========================
   SEARCH BUTTON
========================= */

bot.hears(
    "🔍 Drama izlash",
    async (ctx) => {

        const subscribed =
            await checkSubscription(ctx);

        if (!subscribed) return;

        await ctx.reply(
            "🔎 Drama kodini yuboring 👇"
        );
    }
);

/* =========================
   USER COUNT
========================= */

bot.hears(
    "👥 Obunachilar soni",
    async (ctx) => {

        if (
            ctx.from.id !== ADMIN_ID
        ) return;

        const users =
            await db
                .collection("users")
                .get();

        await ctx.reply(
            `👥 Foydalanuvchilar: ${users.size}`
        );
    }
);

/* =========================
   VIDEO FILE ID
========================= */

bot.on(
    "video",
    async (ctx) => {

        if (
            ctx.from.id !== ADMIN_ID
        ) return;

        const fileId =
            ctx.message.video.file_id;

        await ctx.reply(
            `📁 FILE ID:\n\n<code>${fileId}</code>`,
            {
                parse_mode: "HTML"
            }
        );
    }
);

/* =========================
   ADVERTISING
========================= */

bot.hears(
    "📢 Reklama yuborish",
    async (ctx) => {

        if (
            ctx.from.id !== ADMIN_ID
        ) return;

        userStates[
            ctx.from.id
        ] = "waiting_adv";

        await ctx.reply(
            "📝 Reklama matnini yuboring"
        );
    }
);

bot.action(
    "confirm_adv",
    async (ctx) => {

        if (
            ctx.from.id !== ADMIN_ID
        ) return;

        const users =
            await db
                .collection("users")
                .get();

        let success = 0;
        let failed = 0;

        for (
            const doc
            of users.docs
        ) {

            const user =
                doc.data();

            try {

                await bot.telegram
                    .sendMessage(
                        user.userId,
                        advData[
                        ctx.from.id
                        ]
                    );

                success++;

            } catch {

                failed++;
            }
        }

        await ctx.reply(
            `✅ Reklama yuborildi\n\n🟢 ${success}\n🔴 ${failed}`
        );

        delete userStates[
            ctx.from.id
        ];

        delete advData[
            ctx.from.id
        ];
    }
);

bot.action(
    "cancel_adv",
    async (ctx) => {

        delete userStates[
            ctx.from.id
        ];

        delete advData[
            ctx.from.id
        ];

        await ctx.reply(
            "❌ Bekor qilindi"
        );
    }
);

/* =========================
   TEXT HANDLER
========================= */

bot.on(
    "text",
    async (ctx) => {

        const text =
            ctx.message.text.trim();

        const userId =
            ctx.from.id;

        if (
            text ===
            "📜 Drama ro‘yxati"
        ) return;

        if (
            text ===
            "🔍 Drama izlash"
        ) return;

        if (
            text ===
            "📢 Reklama yuborish"
        ) return;

        if (
            text ===
            "👥 Obunachilar soni"
        ) return;

        if (
            userStates[userId] ===
            "waiting_adv"
        ) {

            advData[userId] =
                text;

            userStates[userId] =
                null;

            return ctx.reply(
                "❓ Reklamani yuborasizmi?",
                Markup.inlineKeyboard([
                    [
                        Markup.button.callback(
                            "✅ Ha",
                            "confirm_adv"
                        ),
                        Markup.button.callback(
                            "❌ Yo‘q",
                            "cancel_adv"
                        )
                    ]
                ])
            );
        }

        const subscribed =
            await checkSubscription(ctx);

        if (!subscribed) return;

        const filmDoc =
            await db
                .collection("films")
                .doc(text)
                .get();

        if (filmDoc.exists) {

            const film =
                filmDoc.data();

            let caption = "";

            if (film.title)
                caption +=
                    `🎬 ${film.title}\n`;

            if (film.episode)
                caption +=
                    `🎞 Qism: ${film.episode}\n`;

            if (film.year)
                caption +=
                    `📅 ${film.year}\n`;

            if (film.genre)
                caption +=
                    `📄 ${film.genre}\n`;

            if (film.description)
                caption +=
                    `\n${film.description}`;

            return ctx.replyWithVideo(
                film.video_link,
                {
                    caption,
                    protect_content: true
                }
            );
        }

        await db
            .collection("requests")
            .add({
                title: text,
                requestedAt:
                    admin.firestore.Timestamp.now()
            });

        await ctx.reply(
            "⏳ Drama topilmadi.\n\nSo‘rovingiz yuborildi."
        );

        try {

            await bot.telegram
                .sendMessage(
                    ADMIN_CHAT_ID,
                    `📌 Yangi drama so‘rovi:\n\n🎬 ${text}`
                );

        } catch (err) {

            console.log(
                "Admin Channel Error:",
                err.message
            );
        }
    }
);

/* =========================
   ERROR HANDLING
========================= */

bot.catch(
    async (err) => {

        console.log(
            "BOT ERROR:",
            err
        );
    }
);

process.on(
    "unhandledRejection",
    (err) => {

        console.log(
            "Unhandled:",
            err
        );
    }
);

process.on(
    "uncaughtException",
    (err) => {

        console.log(
            "Exception:",
            err
        );
    }
);

/* =========================
   LAUNCH
========================= */

bot.launch();

process.once(
    "SIGINT",
    () => bot.stop("SIGINT")
);

process.once(
    "SIGTERM",
    () => bot.stop("SIGTERM")
);

console.log(
    "🚀 SeoulFlix Bot ishga tushdi!"
);
