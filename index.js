const { Telegraf, Markup } = require("telegraf");
const admin = require("firebase-admin");
require("dotenv").config();

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = 8750197296;
const ADMIN_CHAT_ID = "@seoulflix_baza";

const serviceAccount = JSON.parse(
    Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS, "base64").toString("utf-8")
);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const userStates = {};
const advData = {};

const CHECK_CHANNELS = ["@seoulflixorg", "@sf17_fls"];
const SHOW_CHANNELS = [
    { name: "1 - Asosiy kanal", url: "https://t.me/seoulflixorg" },
    { name: "2 - Asosiy kanal", url: "https://t.me/sf17_fls" },
];

// ─────────────────────────────────────────────
// YORDAMCHI FUNKSIYALAR
// ─────────────────────────────────────────────

async function checkSubscription(ctx) {
    const userId = ctx.from.id;
    for (const ch of CHECK_CHANNELS) {
        try {
            const member = await bot.telegram.getChatMember(ch, userId);
            if (["left", "kicked"].includes(member.status)) {
                const buttons = SHOW_CHANNELS.map(ch => [Markup.button.url(ch.name, ch.url)]);
                buttons.push([Markup.button.callback("✅ Tekshirish", "check_membership")]);
                await ctx.reply(
                    "❌ Botdan foydalanish uchun quyidagi kanallarga obuna bo'ling 👇",
                    Markup.inlineKeyboard(buttons)
                );
                return false;
            }
        } catch (err) {
            console.log("checkSubscription error:", err.message);
            return false;
        }
    }
    return true;
}

async function incrementViewCount(filmId) {
    const filmRef = db.collection("films").doc(filmId);
    await filmRef.update({ views: admin.firestore.FieldValue.increment(1) });
}

// Reklamani barcha foydalanuvchilarga yuborish
async function sendAdvToAll(ctx, adv) {
    const usersSnapshot = await db.collection("users").get();
    let success = 0, failed = 0;

    for (const docSnap of usersSnapshot.docs) {
        const user = docSnap.data();
        const uid = user.userId;
        try {
            if (adv.type === "text") {
                await bot.telegram.sendMessage(uid, adv.text, { parse_mode: "HTML" });

            } else if (adv.type === "photo") {
                await bot.telegram.sendPhoto(uid, adv.fileId, {
                    caption: adv.caption || "",
                    parse_mode: "HTML"
                });

            } else if (adv.type === "video") {
                await bot.telegram.sendVideo(uid, adv.fileId, {
                    caption: adv.caption || "",
                    parse_mode: "HTML"
                });

            } else if (adv.type === "animation") {
                await bot.telegram.sendAnimation(uid, adv.fileId, {
                    caption: adv.caption || "",
                    parse_mode: "HTML"
                });
            }
            success++;
        } catch (error) {
            if (error.response?.error_code === 403) {
                await db.collection("users").doc(uid.toString()).delete().catch(() => { });
                console.log(`${uid} bazadan o'chirildi (bloklagan)`);
            }
            failed++;
        }
    }

    await ctx.reply(
        `✅ Reklama yuborish yakunlandi!\n\n🟢 Muvaffaqiyatli: ${success} ta\n🔴 Xatolik: ${failed} ta`
    );
}

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────

bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const userRef = db.collection("users").doc(userId.toString());
    const doc = await userRef.get();

    if (!doc.exists) {
        await userRef.set({
            userId,
            firstName: ctx.from.first_name || "",
            lastName: ctx.from.last_name || "",
            username: ctx.from.username || "",
            joinedAt: admin.firestore.Timestamp.now(),
        });
    }

    const keyboard = [["📜 Kino roʻyxati", "🔍 Kino izlash"]];
    if (userId === ADMIN_ID) {
        keyboard.push(["📢 Reklama yuborish", "👥 Obunachilar soni"]);
    }

    try {
        await ctx.reply(
            "🎬 SeoulFlix botiga xush kelibsiz!\n\nQuyidagi tugmalar orqali istagan dramangizni topishingiz yoki drama kodini yuborishingiz mumkin 👇",
            Markup.keyboard(keyboard).resize()
        );

        const buttons = SHOW_CHANNELS.map(ch => [Markup.button.url(ch.name, ch.url)]);
        buttons.push([Markup.button.callback("✅ Tekshirish", "check_membership")]);
        await ctx.reply(
            "❌ Botdan foydalanish uchun quyidagi kanallarga obuna bo'ling 👇",
            Markup.inlineKeyboard(buttons)
        );
    } catch (err) {
        if (err.response?.error_code === 403) {
            console.log(`${userId} botni bloklagan.`);
            await userRef.delete().catch(() => { });
        } else {
            console.error("START ERROR:", err);
        }
    }
});

// ─────────────────────────────────────────────
// OBUNA TEKSHIRISH
// ─────────────────────────────────────────────

bot.action("check_membership", async (ctx) => {
    const userId = ctx.from.id;
    const notSubscribed = [];

    for (const ch of CHECK_CHANNELS) {
        try {
            const res = await bot.telegram.getChatMember(ch, userId);
            if (["left", "kicked"].includes(res.status)) notSubscribed.push(ch);
        } catch {
            notSubscribed.push(ch);
        }
    }

    if (notSubscribed.length === 0) {
        await ctx.reply("✅ Ajoyib! Siz botdan foydalanishingiz mumkin 🎉");
    } else {
        const buttons = SHOW_CHANNELS.map(ch => [Markup.button.url(ch.name, ch.url)]);
        buttons.push([Markup.button.callback("✅ Tekshirish", "check_membership")]);
        await ctx.reply("❌ Siz hali kanallarga obuna bo'lmagansiz.", Markup.inlineKeyboard(buttons));
    }
    await ctx.answerCbQuery();
});

// ─────────────────────────────────────────────
// ADMIN: VIDEO FILE ID OLISH
// ─────────────────────────────────────────────

bot.on("video", async (ctx) => {
    const userId = ctx.from.id;

    // Admin reklama uchun video yuborayotgan bo'lsa
    if (userId === ADMIN_ID && userStates[userId] === "waiting_for_adv_media") {
        const fileId = ctx.message.video.file_id;
        const caption = ctx.message.caption || "";
        advData[userId] = { type: "video", fileId, caption };
        userStates[userId] = "waiting_for_adv_confirm";

        return ctx.reply(
            `📹 Video qabul qilindi!\n\n❓ Ushbu reklamani barcha foydalanuvchilarga yuborishni tasdiqlaysizmi?`,
            Markup.inlineKeyboard([
                [Markup.button.callback("✅ Ha, yuborish", "confirm_adv")],
                [Markup.button.callback("❌ Bekor qilish", "cancel_adv_text")]
            ])
        );
    }

    // Aks holda: kino bazasi uchun file_id olish
    if (userId === ADMIN_ID) {
        const fileId = ctx.message.video.file_id;
        return ctx.reply(
            `✅ Video qabul qilindi!\n\n📁 File ID:\n<code>${fileId}</code>`,
            { parse_mode: "HTML" }
        );
    }

    return ctx.reply("❌ Ushbu bo'lim faqat adminlar uchun.");
});

// ─────────────────────────────────────────────
// ADMIN: RASM REKLAMA
// ─────────────────────────────────────────────

bot.on("photo", async (ctx) => {
    const userId = ctx.from.id;
    if (userId !== ADMIN_ID) return;

    if (userStates[userId] === "waiting_for_adv_media") {
        const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        const caption = ctx.message.caption || "";
        advData[userId] = { type: "photo", fileId, caption };
        userStates[userId] = "waiting_for_adv_confirm";

        return ctx.reply(
            `🖼 Rasm qabul qilindi!\n\n❓ Ushbu reklamani barcha foydalanuvchilarga yuborishni tasdiqlaysizmi?`,
            Markup.inlineKeyboard([
                [Markup.button.callback("✅ Ha, yuborish", "confirm_adv")],
                [Markup.button.callback("❌ Bekor qilish", "cancel_adv_text")]
            ])
        );
    }
});

// ─────────────────────────────────────────────
// ADMIN: ANIMATION (GIF) REKLAMA
// ─────────────────────────────────────────────

bot.on("animation", async (ctx) => {
    const userId = ctx.from.id;
    if (userId !== ADMIN_ID) return;

    if (userStates[userId] === "waiting_for_adv_media") {
        const fileId = ctx.message.animation.file_id;
        const caption = ctx.message.caption || "";
        advData[userId] = { type: "animation", fileId, caption };
        userStates[userId] = "waiting_for_adv_confirm";

        return ctx.reply(
            `🎞 GIF qabul qilindi!\n\n❓ Ushbu reklamani barcha foydalanuvchilarga yuborishni tasdiqlaysizmi?`,
            Markup.inlineKeyboard([
                [Markup.button.callback("✅ Ha, yuborish", "confirm_adv")],
                [Markup.button.callback("❌ Bekor qilish", "cancel_adv_text")]
            ])
        );
    }
});

// ─────────────────────────────────────────────
// ADMIN TUGMALARI
// ─────────────────────────────────────────────

bot.hears("📢 Reklama yuborish", async (ctx) => {
    const userId = ctx.from.id;
    if (userId !== ADMIN_ID) return ctx.reply("❌ Siz admin emassiz!");

    userStates[userId] = "waiting_for_adv_media";
    await ctx.reply(
        "📢 *Reklama yuborish*\n\nReklama postini yuboring:\n\n• 📝 Matn\n• 🖼 Rasm (caption bilan yoki sutsiz)\n• 📹 Video (caption bilan yoki sutsiz)\n• 🎞 GIF\n\n_HTML teglari ishlaydi: <b>bold</b>, <i>italic</i>, <a href='url'>link</a>_",
        { parse_mode: "Markdown" }
    );
});

bot.hears("👥 Obunachilar soni", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.reply("❌ Siz admin emassiz!");
    const snapshot = await db.collection("users").get();
    await ctx.reply(`📊 Botda jami *${snapshot.size}* ta foydalanuvchi mavjud.`, {
        parse_mode: "Markdown"
    });
});

bot.hears("📜 Kino roʻyxati", async (ctx) => {
    const subscribed = await checkSubscription(ctx);
    if (!subscribed) return;

    const snapshot = await db.collection("films").get();
    if (snapshot.empty) return ctx.reply("❌ Hozircha bazaga hech qanday drama qo'shilmagan.");

    let message = "🎬 *SeoulFlix Drama Ro'yxati*\n";
    snapshot.forEach((doc) => {
        const film = doc.data();
        const views = film.views || 0;
        message += `\n🎬 *${film.title}* — Kod: \`${doc.id}\` | 👁 ${views}`;
    });
    await ctx.reply(message, { parse_mode: "Markdown" });
});

bot.hears("🔍 Kino izlash", async (ctx) => {
    const subscribed = await checkSubscription(ctx);
    if (!subscribed) return;
    ctx.reply("🔎 Drama kodini yuboring yoki nomini yozing 👇");
});

// ─────────────────────────────────────────────
// TEXT HANDLER
// ─────────────────────────────────────────────

bot.on("text", async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text.trim();

    // Klaviatura tugmalarini o'tkazib yuborish
    const keyboardButtons = ["📜 Kino roʻyxati", "🔍 Kino izlash", "📢 Reklama yuborish", "👥 Obunachilar soni"];
    if (keyboardButtons.includes(text)) return;

    // ── ADMIN: matnli reklama qabul qilish ──
    if (userId === ADMIN_ID && userStates[userId] === "waiting_for_adv_media") {
        advData[userId] = { type: "text", text };
        userStates[userId] = "waiting_for_adv_confirm";

        return ctx.reply(
            `📝 Matn qabul qilindi!\n\n"${text}"\n\n❓ Ushbu reklamani barcha foydalanuvchilarga yuborishni tasdiqlaysizmi?`,
            Markup.inlineKeyboard([
                [Markup.button.callback("✅ Ha, yuborish", "confirm_adv")],
                [Markup.button.callback("❌ Bekor qilish", "cancel_adv_text")]
            ])
        );
    }

    // ── Oddiy foydalanuvchi: obuna tekshiruvi ──
    const subscribed = await checkSubscription(ctx);
    if (!subscribed) return;

    // ── Kino kodi bilan qidiruv ──
    const filmDoc = await db.collection("films").doc(text).get();
    if (filmDoc.exists) {
        const film = filmDoc.data();
        try {
            await incrementViewCount(text);
            const updatedViews = (film.views || 0) + 1;

            let caption = "";
            if (film.title) caption += `🎬 *Nomi:* ${film.title}\n`;
            if (film.episode) caption += `🎞️ *Qism:* ${film.episode}\n`;
            if (film.year) caption += `🗓️ *Yil:* ${film.year}\n`;
            if (film.translator) caption += `🎧 *Tarjima:* ${film.translator}\n`;
            if (film.language) caption += `🌐 *Til:* ${film.language}\n`;
            if (film.genre) caption += `📄 *Janr:* ${film.genre}\n`;
            if (film.description) caption += `\n📕 *Tavsifi:*\n${film.description}\n`;
            caption += `\n👁 *Ko'rilgan:* ${updatedViews} marta`;

            await ctx.replyWithVideo(film.video_link, {
                caption,
                parse_mode: "Markdown",
                protect_content: true
            });
        } catch (err) {
            console.error("Video yuborishda xatolik:", err.message);
            await ctx.reply("❌ Video yuborishda xatolik yuz berdi.");
        }
        return;
    }

    // ── Topilmasa so'rov yuborish ──
    await db.collection("requests").add({
        title: text,
        requestedAt: admin.firestore.Timestamp.now(),
    });
    await ctx.reply("⏳ Ushbu drama hozircha bazada mavjud emas.\n\n📌 So'rovingiz adminlarga yuborildi!");
    try {
        await bot.telegram.sendMessage(
            ADMIN_CHAT_ID,
            `📌 *Yangi drama so'rovi!*\n\n🎬 ${text}`,
            { parse_mode: "Markdown" }
        );
    } catch (err) {
        console.error("Admin chatga yuborishda xatolik:", err);
    }
});

// ─────────────────────────────────────────────
// CALLBACK: REKLAMA TASDIQLASH / BEKOR QILISH
// ─────────────────────────────────────────────

bot.action("confirm_adv", async (ctx) => {
    const userId = ctx.from.id;

    if (userId !== ADMIN_ID || userStates[userId] !== "waiting_for_adv_confirm") {
        return ctx.answerCbQuery("❌ Ruxsat yo'q yoki amal muddati o'tgan.");
    }

    await ctx.answerCbQuery("⏳ Reklama yuborilmoqda...");
    await ctx.reply("⏳ Reklama yuborilmoqda, iltimos kuting...");

    const adv = advData[userId];
    delete userStates[userId];
    delete advData[userId];

    await sendAdvToAll(ctx, adv);
});

bot.action("cancel_adv_text", async (ctx) => {
    const userId = ctx.from.id;
    if (userId !== ADMIN_ID) return ctx.answerCbQuery("❌ Ruxsat yo'q.");

    await ctx.answerCbQuery("Bekor qilindi.");
    await ctx.reply("❌ Reklama yuborish bekor qilindi.");
    delete userStates[userId];
    delete advData[userId];
});

// ─────────────────────────────────────────────
// XATOLARNI USHLASH
// ─────────────────────────────────────────────

bot.catch(async (err, ctx) => {
    console.error("BOT ERROR:", err);
    if (err.response?.error_code === 403) {
        const id = ctx?.from?.id;
        if (id) {
            await db.collection("users").doc(id.toString()).delete().catch(() => { });
        }
    }
});

bot.launch();
console.log("🚀 SeoulFlix Bot ishga tushdi!");