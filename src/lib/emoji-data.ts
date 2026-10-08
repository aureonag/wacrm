// Ready-made emojis for the "emoji library" of every writing box (briefing,
// comments, notes, chat). Curated for day-to-day work — not the whole Unicode
// table — and grouped so people find them without typing.

export interface EmojiCategory {
  key: string;
  /** Emoji used as the tab icon. */
  icon: string;
  emojis: string[];
}

const split = (s: string): string[] => [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s.replace(/\s+/g, ""))].map((x) => x.segment);

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    key: "faces",
    icon: "😀",
    emojis: split(
      "😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😮‍💨 😔 😪 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😲 😳 🥺 😦 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 💀 💩 🤡 👻 🤖",
    ),
  },
  {
    key: "gestures",
    icon: "👍",
    emojis: split(
      "👍 👎 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👋 🤚 🖐️ ✋ 🖖 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💪 🦾 👀 🧠 🫡 🫶 🫰 🙋 🙋‍♂️ 🙋‍♀️ 🤷 🤷‍♂️ 🤷‍♀️ 🙇 🤦 🤦‍♂️ 🤦‍♀️ 💁 🙅 🙆",
    ),
  },
  {
    key: "symbols",
    icon: "✅",
    emojis: split(
      "✅ ❌ ⚠️ ❗ ❓ ‼️ ⁉️ ⭕ 🚫 ✔️ ➕ ➖ ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ 🔁 🔄 💯 🔥 ✨ ⭐ 🌟 💥 💫 🎉 🎊 🏁 🚩 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟥 🟧 🟨 🟩 🟦 🟪 ⏳ ⌛ ⏰ 🕐 📅 📆",
    ),
  },
  {
    key: "hearts",
    icon: "❤️",
    emojis: split("❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 😻 🥰 😍 🤩 😘"),
  },
  {
    key: "work",
    icon: "💼",
    emojis: split(
      "📌 📍 📎 🖇️ 📝 📄 📃 📋 📁 📂 🗂️ 📊 📈 📉 💼 🏢 🏭 🛒 📦 🚚 📞 ☎️ 📱 💻 🖥️ ⌨️ 🖨️ 📧 ✉️ 📨 📩 🔗 🔒 🔓 🔑 🛠️ ⚙️ 🔧 🔍 🔎 💡 📢 📣 🔔 🏷️ 💰 💵 💳 🧾 🧮 🎯 🏆 🥇 🥈 🥉 🚀 🎨 🎬 📷 🎥 🎧 🎤 📹 🗓️ 🗒️ 📚 🧩 🔖",
    ),
  },
  {
    key: "nature",
    icon: "🌿",
    emojis: split(
      "☕ 🍵 🥤 🍺 🍻 🥂 🍷 🍕 🍔 🍟 🌮 🍎 🍌 🍓 🍉 🍰 🎂 🍩 🍫 ☀️ 🌞 🌙 ⭐ ☁️ ⛅ 🌧️ ⚡ ❄️ 🌈 🌸 🌹 🌻 🌿 🍀 🌳 🐶 🐱 🐻 🦁 🐵 🦄 🐝 🦋",
    ),
  },
];
