/* voicePhrases.js — 四隻動物對手的固定唸稿(烤製 scripts/gen-voice.mjs 與 runtime js/voice.js 共用)。
 *
 * ★ 人聲鐵律(skill baked-voice-commentary):一律預烤 mp3 神經人聲(msedge-tts),絕不用 Web Speech 機器聲;缺檔 = 不唸。
 * ★ 只放「實際會唸」的固定句。走子太頻繁不唸;think 每三手唸一次、flip 每三次唸一次(opponent.js)。
 * ★ 事件(暗棋版):think 想棋 / flip 牠翻到自己的子 / capture 牠吃你的子 / wow 你吃牠的子 / win 牠贏 / lose 你贏 / chat1~3 等你太久的閒聊。
 * ★ 檔名 = <animal>-<event>.mp3(gen-voice 照這張表烤、sw.js 的清單照目錄重生、browser-check 對賬 VOICE_FILES)。
 * ★ 一隻一種嗓音(與 gomoku3d / 3D-Xiangqi 同一組):兔=曉雨更高更快 / 貓=曉臻拉高 / 熊=雲哲壓低 / 貓頭鷹=雲哲慢一點(老師傅)。
 */
export const VOICES = {
  rabbit: { voice: 'zh-TW-HsiaoYuNeural',   pitch: '+40%', rate: '+14%' },
  cat:    { voice: 'zh-TW-HsiaoChenNeural', pitch: '+25%', rate: '+8%' },
  bear:   { voice: 'zh-TW-YunJheNeural',    pitch: '-18%', rate: '-6%' },
  owl:    { voice: 'zh-TW-YunJheNeural',    pitch: '-4%',  rate: '-14%' },
};

export const LINES = {
  rabbit: { think: '嗯…翻哪一顆呢',     flip: '翻到什麼呢~?',   capture: '吃掉了!',       wow: '哇!被吃了!',     win: '耶~我贏了!',    lose: '哇…你好厲害!',   chat1: '耶~該你了!',     chat2: '快快快~',         chat3: '翻一顆看看嘛?' },
  cat:    { think: '喵…讓我想一下',     flip: '喵~翻到什麼?',   capture: '喵!吃掉了!',     wow: '喵嗚!被吃了',     win: '喵~我贏了!',    lose: '喵嗚…你贏了',     chat1: '喵~輪到你了',     chat2: '快點走啦~',       chat3: '想好了沒呀?' },
  bear:   { think: '吼…我想想',         flip: '翻開看看~',       capture: '吼!吃掉了!',     wow: '嗚!被吃了',       win: '吼~我贏了!',    lose: '嗚…你好厲害',     chat1: '吼~輪到你囉',     chat2: '慢慢想,不急',     chat3: '要翻哪一顆呢?' },
  owl:    { think: '嗯…讓老夫想想',     flip: '翻開便知分曉',    capture: '老夫收下了',     wow: '好棋!有兩下子',   win: '呵呵,老夫贏了', lose: '後生可畏啊!',     chat1: '該你了,小朋友',   chat2: '不急,想清楚再走', chat3: '翻子也要看時機喔' },
};
/** 閒聊事件名(每隻都有同一組) */
export const CHAT_EVENTS = Object.keys(LINES.cat).filter((k) => k.startsWith('chat'));
/** 所有應該存在的檔名(烤製對賬 / smoke 對賬用) */
export const VOICE_FILES = Object.entries(LINES).flatMap(([animal, ev]) => Object.keys(ev).map((event) => `${animal}-${event}.mp3`));
