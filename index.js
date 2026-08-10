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
const filmDrafts = {};

const FILM_OPTIONAL_STEPS = [
    { key: "episode", label: "🎞️ Nechchi qismligini yuboring (masalan: 16 qism):" },
    { key: "year", label: "🗓️ Chiqarilgan yilini yuboring (masalan: 2024):" },
    { key: "translator", label: "🎧 Tarjimon nomini yuboring:" },
    { key: "language", label: "🌐 Tilini yuboring (masalan: O'zbekcha):" },
    { key: "genre", label: "📄 Janrini yuboring (masalan: Drama, Romantika):" },
    { key: "description", label: "📕 Tavsifini yuboring:" },
];

async function askFilmStep(ctx, index) {
    const userId = ctx.from.id;
    if (index >= FILM_OPTIONAL_STEPS.length) {
        userStates[userId] = "waiting_for_film_video";
        return ctx.reply(
            "🎥 Endi kino videosini yuboring (video fayl sifatida):",
            Markup.inlineKeyboard([[Markup.button.callback("❌ Bekor qilish", "film_cancel")]])
        );
    }
    const step = FILM_OPTIONAL_STEPS[index];
    userStates[userId] = `waiting_for_film_${step.key}`;
    await ctx.reply(
        step.label,
        Markup.inlineKeyboard([
            [Markup.button.callback("⏭ Otkazib yuborish", "film_skip")],
            [Markup.button.callback("❌ Bekor qilish", "film_cancel")],
        ])
    );
}

let CHECK_CHANNELS = [];
let SHOW_CHANNELS = [];
let VIP_USERNAMES = new Set();

async function loadVipUsers() {
    const snapshot = await db.collection("vipUsers").get();
    VIP_USERNAMES = new Set(snapshot.docs.map(doc => doc.id));
}

async function loadChannels() {
    const snapshot = await db.collection("channels").get();
    CHECK_CHANNELS = snapshot.docs.map(doc => doc.data().channelId);
    SHOW_CHANNELS = snapshot.docs.map(doc => ({ name: doc.data().name, url: doc.data().url }));
}

async function seedChannelsIfEmpty() {
    const snapshot = await db.collection("channels").get();
    if (snapshot.empty) {
        const defaults = [
            { id: "asaxi_uz", channelId: "@asaxi_uz", name: "Asaxi tv", url: "https://t.me/asaxi_uz" },
            { id: "seoulflixorg", channelId: "@seoulflixorg", name: "SX", url: "https://t.me/seoulflixorg" },
        ];
        for (const ch of defaults) {
            await db.collection("channels").doc(ch.id).set({
                channelId: ch.channelId,
                name: ch.name,
                url: ch.url,
            });
        }
    }
}

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
        keyboard.push(["📡 Majburiy kanallar", "🎬 Drama qo'shish"]);
        keyboard.push(["⭐ Yuklab olish ruxsati"]);
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

    // Admin yangi drama qo'shayotganda video yuborsa
    if (userId === ADMIN_ID && userStates[userId] === "waiting_for_film_video") {
        const fileId = ctx.message.video.file_id;
        const draft = filmDrafts[userId] || {};
        const filmData = {
            title: draft.title || "",
            episode: draft.episode || "",
            year: draft.year || "",
            translator: draft.translator || "",
            language: draft.language || "",
            genre: draft.genre || "",
            description: draft.description || "",
            video_link: fileId,
            views: 0,
        };
        await db.collection("films").doc(draft.code).set(filmData);
        delete userStates[userId];
        delete filmDrafts[userId];
        return ctx.reply(
            `✅ Drama muvaffaqiyatli qo'shildi!\n\n🎬 *${filmData.title}*\n🔑 Kod: \`${draft.code}\``,
            { parse_mode: "Markdown" }
        );
    }

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

bot.hears("📡 Majburiy kanallar", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.reply("❌ Siz admin emassiz!");
    await ctx.reply(
        "📡 Majburiy obuna kanallarini boshqarish",
        Markup.inlineKeyboard([
            [Markup.button.callback("📋 Ro'yxat", "channels_list")],
            [Markup.button.callback("➕ Kanal qo'shish", "channels_add")],
            [Markup.button.callback("🗑 Kanal o'chirish", "channels_remove_menu")],
        ])
    );
});

bot.action("channels_list", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("❌ Ruxsat yo'q.");
    await ctx.answerCbQuery();
    if (CHECK_CHANNELS.length === 0) return ctx.reply("📭 Hozircha majburiy kanallar yo'q.");
    let msg = "📋 *Majburiy kanallar ro'yxati:*\n";
    CHECK_CHANNELS.forEach((id, i) => {
        const show = SHOW_CHANNELS[i];
        msg += `\n${i + 1}. ${show?.name || id} — \`${id}\``;
    });
    await ctx.reply(msg, { parse_mode: "Markdown" });
});

bot.action("channels_add", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("❌ Ruxsat yo'q.");
    await ctx.answerCbQuery();
    userStates[ctx.from.id] = "waiting_for_channel_add";
    await ctx.reply(
        "➕ *Yangi kanal qo'shish*\n\nKanalning username'ini yuboring (masalan: @kanal_nomi).\n\n⚠️ Botni avval o'sha kanalga *admin* qilib qo'shing, aks holda obuna tekshiruvi ishlamaydi.",
        { parse_mode: "Markdown" }
    );
});

bot.action("channels_remove_menu", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("❌ Ruxsat yo'q.");
    await ctx.answerCbQuery();
    const snapshot = await db.collection("channels").get();
    if (snapshot.empty) return ctx.reply("📭 Hozircha majburiy kanallar yo'q.");
    const buttons = snapshot.docs.map(doc => {
        const data = doc.data();
        return [Markup.button.callback(`🗑 ${data.name || data.channelId}`, `remove_channel:${doc.id}`)];
    });
    await ctx.reply("O'chirmoqchi bo'lgan kanalni tanlang:", Markup.inlineKeyboard(buttons));
});

bot.action(/^remove_channel:(.+)$/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("❌ Ruxsat yo'q.");
    const docId = ctx.match[1];
    await db.collection("channels").doc(docId).delete();
    await loadChannels();
    await ctx.answerCbQuery("✅ O'chirildi.");
    await ctx.reply("✅ Kanal o'chirildi.");
});

bot.hears("⭐ Yuklab olish ruxsati", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.reply("❌ Siz admin emassiz!");
    await ctx.reply(
        "⭐ Videoni himoyasiz (yuklab olish/forward qilish mumkin) holatda oladigan foydalanuvchilar",
        Markup.inlineKeyboard([
            [Markup.button.callback("📋 Ro'yxat", "vip_list")],
            [Markup.button.callback("➕ Foydalanuvchi qo'shish", "vip_add")],
            [Markup.button.callback("🗑 Foydalanuvchi o'chirish", "vip_remove_menu")],
        ])
    );
});

bot.action("vip_list", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("❌ Ruxsat yo'q.");
    await ctx.answerCbQuery();
    if (VIP_USERNAMES.size === 0) return ctx.reply("📭 Hozircha ruxsat berilgan foydalanuvchilar yo'q.");
    const list = [...VIP_USERNAMES].map((u, i) => `${i + 1}. @${u}`).join("\n");
    await ctx.reply(`⭐ *Ruxsat berilgan foydalanuvchilar:*\n\n${list}`, { parse_mode: "Markdown" });
});

bot.action("vip_add", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("❌ Ruxsat yo'q.");
    await ctx.answerCbQuery();
    userStates[ctx.from.id] = "waiting_for_vip_add";
    await ctx.reply("➕ Foydalanuvchi username'ini yuboring (masalan: @username):");
});

bot.action("vip_remove_menu", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("❌ Ruxsat yo'q.");
    await ctx.answerCbQuery();
    if (VIP_USERNAMES.size === 0) return ctx.reply("📭 Hozircha ruxsat berilgan foydalanuvchilar yo'q.");
    const buttons = [...VIP_USERNAMES].map(u => [Markup.button.callback(`🗑 @${u}`, `remove_vip:${u}`)]);
    await ctx.reply("O'chirmoqchi bo'lgan foydalanuvchini tanlang:", Markup.inlineKeyboard(buttons));
});

bot.action(/^remove_vip:(.+)$/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("❌ Ruxsat yo'q.");
    const uname = ctx.match[1];
    await db.collection("vipUsers").doc(uname).delete();
    await loadVipUsers();
    await ctx.answerCbQuery("✅ O'chirildi.");
    await ctx.reply(`✅ @${uname} ro'yxatdan o'chirildi.`);
});

bot.hears("🎬 Drama qo'shish", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.reply("❌ Siz admin emassiz!");
    userStates[ctx.from.id] = "waiting_for_film_code";
    filmDrafts[ctx.from.id] = {};
    await ctx.reply(
        "🎬 *Yangi drama qo'shish*\n\nAvval kino kodini yuboring (masalan: 0001). Foydalanuvchilar shu kod orqali kinoni topadi.",
        { parse_mode: "Markdown" }
    );
});

bot.action("film_skip", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("❌ Ruxsat yo'q.");
    const state = userStates[ctx.from.id];
    await ctx.answerCbQuery();
    if (!state || !state.startsWith("waiting_for_film_")) return;
    const key = state.replace("waiting_for_film_", "");
    const idx = FILM_OPTIONAL_STEPS.findIndex(s => s.key === key);
    if (idx === -1) return;
    await askFilmStep(ctx, idx + 1);
});

bot.action("film_cancel", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("❌ Ruxsat yo'q.");
    delete userStates[ctx.from.id];
    delete filmDrafts[ctx.from.id];
    await ctx.answerCbQuery("Bekor qilindi.");
    await ctx.reply("❌ Drama qo'shish bekor qilindi.");
});

bot.action("film_overwrite_yes", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("❌ Ruxsat yo'q.");
    await ctx.answerCbQuery();
    userStates[ctx.from.id] = "waiting_for_film_title";
    await ctx.reply(
        "🎬 Endi drama nomini yuboring:",
        Markup.inlineKeyboard([[Markup.button.callback("❌ Bekor qilish", "film_cancel")]])
    );
});

bot.action("film_overwrite_no", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("❌ Ruxsat yo'q.");
    await ctx.answerCbQuery();
    userStates[ctx.from.id] = "waiting_for_film_code";
    delete filmDrafts[ctx.from.id];
    await ctx.reply("🔁 Yangi kino kodini yuboring:");
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
    const keyboardButtons = ["📜 Kino roʻyxati", "🔍 Kino izlash", "📢 Reklama yuborish", "👥 Obunachilar soni", "📡 Majburiy kanallar", "🎬 Drama qo'shish", "⭐ Yuklab olish ruxsati"];
    if (keyboardButtons.includes(text)) return;

    // ── ADMIN: yuklab olish ruxsati uchun foydalanuvchi qo'shish ──
    if (userId === ADMIN_ID && userStates[userId] === "waiting_for_vip_add") {
        const username = text.trim();
        if (!username.startsWith("@")) {
            return ctx.reply("❌ Username @ bilan boshlanishi kerak. Masalan: @username");
        }
        const docId = username.replace("@", "").toLowerCase();
        await db.collection("vipUsers").doc(docId).set({
            username: docId,
            addedAt: admin.firestore.Timestamp.now(),
        });
        await loadVipUsers();
        delete userStates[userId];
        return ctx.reply(`✅ @${docId} endi videoni himoyasiz (yuklab olish/forward qilish mumkin) holatda oladi.`);
    }

    // ── ADMIN: yangi drama qo'shish — kino kodi ──
    if (userId === ADMIN_ID && userStates[userId] === "waiting_for_film_code") {
        const code = text;
        if (code.includes("/")) {
            return ctx.reply("❌ Kodda \"/\" belgisi bo'lishi mumkin emas. Boshqa kod yuboring:");
        }
        const existing = await db.collection("films").doc(code).get();
        filmDrafts[userId] = { code };
        if (existing.exists) {
            return ctx.reply(
                `⚠️ "${code}" kodli drama allaqachon mavjud. Ustidan yozilsinmi?`,
                Markup.inlineKeyboard([
                    [Markup.button.callback("✅ Ustidan yozish", "film_overwrite_yes")],
                    [Markup.button.callback("🔁 Boshqa kod kiritish", "film_overwrite_no")],
                    [Markup.button.callback("❌ Bekor qilish", "film_cancel")],
                ])
            );
        }
        userStates[userId] = "waiting_for_film_title";
        return ctx.reply(
            "🎬 Endi drama nomini yuboring:",
            Markup.inlineKeyboard([[Markup.button.callback("❌ Bekor qilish", "film_cancel")]])
        );
    }

    // ── ADMIN: yangi drama qo'shish — nomi ──
    if (userId === ADMIN_ID && userStates[userId] === "waiting_for_film_title") {
        filmDrafts[userId].title = text;
        return askFilmStep(ctx, 0);
    }

    // ── ADMIN: yangi drama qo'shish — ixtiyoriy maydonlar ──
    if (userId === ADMIN_ID && userStates[userId] && userStates[userId].startsWith("waiting_for_film_")) {
        const key = userStates[userId].replace("waiting_for_film_", "");
        if (key === "video") {
            return ctx.reply("❗️ Iltimos, video fayl sifatida yuboring (matn emas).");
        }
        const idx = FILM_OPTIONAL_STEPS.findIndex(s => s.key === key);
        if (idx !== -1) {
            filmDrafts[userId][key] = text;
            return askFilmStep(ctx, idx + 1);
        }
    }

    // ── ADMIN: yangi majburiy kanal qo'shish ──
    if (userId === ADMIN_ID && userStates[userId] === "waiting_for_channel_add") {
        const username = text.trim();
        if (!username.startsWith("@")) {
            return ctx.reply("❌ Username @ bilan boshlanishi kerak. Masalan: @kanal_nomi");
        }
        try {
            const chat = await bot.telegram.getChat(username);
            const me = await bot.telegram.getMe();
            const member = await bot.telegram.getChatMember(username, me.id);
            if (!["administrator", "creator"].includes(member.status)) {
                return ctx.reply("❌ Bot bu kanalda admin emas. Avval botni kanalga admin qilib qo'shing, so'ng qaytadan urinib ko'ring.");
            }
            const docId = username.replace("@", "");
            await db.collection("channels").doc(docId).set({
                channelId: username,
                name: chat.title || username,
                url: `https://t.me/${docId}`,
            });
            await loadChannels();
            delete userStates[userId];
            return ctx.reply(`✅ Kanal qo'shildi: ${chat.title || username}`);
        } catch (err) {
            console.error("Kanal qo'shishda xatolik:", err.message);
            return ctx.reply("❌ Kanal topilmadi yoki botga ruxsat yo'q. Username to'g'riligini va bot kanalga qo'shilganini tekshiring.");
        }
    }

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

            const requesterUsername = (ctx.from.username || "").toLowerCase();
            const isVip = VIP_USERNAMES.has(requesterUsername);

            await ctx.replyWithVideo(film.video_link, {
                caption,
                parse_mode: "Markdown",
                protect_content: !isVip
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

(async () => {
    await seedChannelsIfEmpty();
    await loadChannels();
    await loadVipUsers();
    await bot.launch();
    console.log("🚀 SeoulFlix Bot ishga tushdi!");
})();