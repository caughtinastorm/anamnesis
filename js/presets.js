/**
 * Preloaded Starter Decks Module
 * 
 * Provides canonical, high-yield starter collections.
 * Specifically: JLPT N5 Kanji Deck (104 characters) strictly designed
 * for kanji recognition without spoiling readings on the front face.
 */

import { generateUUID } from "./utils.js";
import { createDefaultFSRSStats } from "../fsrs.js";
import * as db from "../db.js";
import { loadCardsFromDB } from "./cards.js";
import { showToast } from "./ui.js";
import { setActiveDeckSelection } from "./dashboard.js";
import { state } from "./state.js";

/**
 * Full Canonical JLPT N5 Kanji Dataset (104 characters)
 * Front: strictly the Kanji character
 * Sub: empty (keeps front face distraction-free)
 * Back: Primary English meaning + Kun'yomi & On'yomi readings
 * Description: Radical, stroke count, mnemonic story, and real compound words
 */
export const JLPT_N5_KANJI_DECK = [
  // --- NUMBERS & COUNTERS ---
  {
    front: "一",
    back: "One<br><strong>Kun:</strong> ひと, ひと・つ<br><strong>On:</strong> イチ, イツ",
    description: "<strong>Radical:</strong> 一 (one) • 1 stroke<br><strong>Mnemonic:</strong> A single horizontal line representing the number one.<br><br><strong>Examples:</strong><br>• 一つ (ひとつ) — One thing<br>• 一人 (ひとり) — One person<br>• 一月 (いちがつ) — January"
  },
  {
    front: "二",
    back: "Two<br><strong>Kun:</strong> ふた, ふた・つ<br><strong>On:</strong> ニ, ジ",
    description: "<strong>Radical:</strong> 二 (two) • 2 strokes<br><strong>Mnemonic:</strong> Two horizontal parallel lines representing the number two.<br><br><strong>Examples:</strong><br>• 二つ (ふたつ) — Two things<br>• 二人 (ふたり) — Two people<br>• 二月 (にがつ) — February"
  },
  {
    front: "三",
    back: "Three<br><strong>Kun:</strong> み, みっ・つ<br><strong>On:</strong> サン",
    description: "<strong>Radical:</strong> 一 (one) • 3 strokes<br><strong>Mnemonic:</strong> Three horizontal lines stacked representing the number three.<br><br><strong>Examples:</strong><br>• 三つ (みっつ) — Three things<br>• 三人 (さんにん) — Three people<br>• 三日月 (みかづき) — Crescent moon"
  },
  {
    front: "四",
    back: "Four<br><strong>Kun:</strong> よ, よっ・つ, よん<br><strong>On:</strong> シ",
    description: "<strong>Radical:</strong> 囗 (enclosure) • 5 strokes<br><strong>Mnemonic:</strong> Four curtains hanging inside a window frame.<br><br><strong>Examples:</strong><br>• 四つ (よっつ) — Four things<br>• 四人 (よにん) — Four people<br>• 四月 (しがつ) — April"
  },
  {
    front: "五",
    back: "Five<br><strong>Kun:</strong> いつ, いつ・つ<br><strong>On:</strong> ゴ",
    description: "<strong>Radical:</strong> 二 (two) • 4 strokes<br><strong>Mnemonic:</strong> An hourglass shape or five tally points connected together.<br><br><strong>Examples:</strong><br>• 五つ (いつつ) — Five things<br>• 五人 (ごにん) — Five people<br>• 五月 (ごがつ) — May"
  },
  {
    front: "六",
    back: "Six<br><strong>Kun:</strong> む, むっ・つ, むい<br><strong>On:</strong> ロク",
    description: "<strong>Radical:</strong> 八 (eight) • 4 strokes<br><strong>Mnemonic:</strong> A person with arms and legs out, celebrating the number six.<br><br><strong>Examples:</strong><br>• 六つ (むっつ) — Six things<br>• 六人 (ろくにん) — Six people<br>• 六日 (むいか) — 6th day of the month"
  },
  {
    front: "七",
    back: "Seven<br><strong>Kun:</strong> なな, なな・つ, なの<br><strong>On:</strong> シチ",
    description: "<strong>Radical:</strong> 一 (one) • 2 strokes<br><strong>Mnemonic:</strong> An upside-down 7 cut with a horizontal stroke.<br><br><strong>Examples:</strong><br>• 七つ (ななつ) — Seven things<br>• 七人 (しちにん / ななにん) — Seven people<br>• 七日 (なのか) — 7th day of the month"
  },
  {
    front: "八",
    back: "Eight<br><strong>Kun:</strong> や, やっ・つ, よう<br><strong>On:</strong> ハチ",
    description: "<strong>Radical:</strong> 八 (eight) • 2 strokes<br><strong>Mnemonic:</strong> Two lines opening outward, widening at the base.<br><br><strong>Examples:</strong><br>• 八つ (やっつ) — Eight things<br>• 八日 (ようか) — 8th day of the month<br>• 八百屋 (やおや) — Greengrocer"
  },
  {
    front: "九",
    back: "Nine<br><strong>Kun:</strong> ここの, ここの・つ<br><strong>On:</strong> キュウ, ク",
    description: "<strong>Radical:</strong> 乙 (second) • 2 strokes<br><strong>Mnemonic:</strong> An athlete bending an arm for the 9th inning.<br><br><strong>Examples:</strong><br>• 九つ (ここのつ) — Nine things<br>• 九人 (きゅうにん) — Nine people<br>• 九月 (くがつ) — September"
  },
  {
    front: "十",
    back: "Ten<br><strong>Kun:</strong> とお, と<br><strong>On:</strong> ジュウ, ジッ",
    description: "<strong>Radical:</strong> 十 (ten) • 2 strokes<br><strong>Mnemonic:</strong> A cross (+) tying two hands together (10 fingers).<br><br><strong>Examples:</strong><br>• 十 (とお) — Ten things<br>• 十人 (じゅうにん) — Ten people<br>• 十月 (じゅうがつ) — October"
  },
  {
    front: "百",
    back: "Hundred<br><strong>Kun:</strong> もも<br><strong>On:</strong> ヒャク, ビャク, ピャク",
    description: "<strong>Radical:</strong> 白 (white) • 6 strokes<br><strong>Mnemonic:</strong> One (一) above white (白) = 100 years of age bringing white hair.<br><br><strong>Examples:</strong><br>• 百 (ひゃく) — 100<br>• 三百 (さんびゃく) — 300<br>• 百貨店 (ひゃっかてん) — Department store"
  },
  {
    front: "千",
    back: "Thousand<br><strong>Kun:</strong> ち<br><strong>On:</strong> セン, ゼン",
    description: "<strong>Radical:</strong> 十 (ten) • 3 strokes<br><strong>Mnemonic:</strong> A person (亻) with a slash across ten (十) making 1,000.<br><br><strong>Examples:</strong><br>• 千 (せん) — 1,000<br>• 三千 (さんぜん) — 3,000<br>• 千葉 (ちば) — Chiba"
  },
  {
    front: "万",
    back: "Ten Thousand<br><strong>Kun:</strong> よろず<br><strong>On:</strong> マン, バン",
    description: "<strong>Radical:</strong> 一 (one) • 3 strokes<br><strong>Mnemonic:</strong> One (一) blade with a wide sweeping reach of 10,000.<br><br><strong>Examples:</strong><br>• 一万 (いちまん) — 10,000<br>• 万国 (ばんこく) — All nations<br>• 万歳 (ばんざい) — Hurrah (10,000 years of life)"
  },
  {
    front: "円",
    back: "Yen, Circle, Round<br><strong>Kun:</strong> まる・い<br><strong>On:</strong> エン",
    description: "<strong>Radical:</strong> 冂 (border) • 4 strokes<br><strong>Mnemonic:</strong> A coin sitting inside an open wallet or cash register.<br><br><strong>Examples:</strong><br>• 百円 (ひゃくえん) — 100 yen<br>• 円い (まるい) — Round<br>• 円高 (えんだか) — Strong yen"
  },
  {
    front: "年",
    back: "Year, Age<br><strong>Kun:</strong> とし<br><strong>On:</strong> ネン",
    description: "<strong>Radical:</strong> 干 (dry) • 6 strokes<br><strong>Mnemonic:</strong> A farmer carrying the annual grain harvest on his back.<br><br><strong>Examples:</strong><br>• 今年 (ことし) — This year<br>• 去年 (きょねん) — Last year<br>• 来年 (らいねん) — Next year"
  },
  {
    front: "何",
    back: "What, Which<br><strong>Kun:</strong> なに, なん<br><strong>On:</strong> カ",
    description: "<strong>Radical:</strong> 亻 (person) • 7 strokes<br><strong>Mnemonic:</strong> A person (亻) carrying something unusual asking: 'What is that?'<br><br><strong>Examples:</strong><br>• 何 (なに / なん) — What<br>• 何時 (なんじ) — What time<br>• 何人 (なんにん) — How many people"
  },

  // --- TIME & CALENDAR ---
  {
    front: "日",
    back: "Day, Sun, Japan<br><strong>Kun:</strong> ひ, -び, -か<br><strong>On:</strong> ニチ, ジツ",
    description: "<strong>Radical:</strong> 日 (sun) • 4 strokes<br><strong>Mnemonic:</strong> The sun with its radiant core in the center.<br><br><strong>Examples:</strong><br>• 日本 (にほん) — Japan<br>• 日曜日 (にちようび) — Sunday<br>• 今日 (きょう) — Today"
  },
  {
    front: "月",
    back: "Month, Moon<br><strong>Kun:</strong> つき<br><strong>On:</strong> ゲツ, ガツ",
    description: "<strong>Radical:</strong> 月 (moon) • 4 strokes<br><strong>Mnemonic:</strong> A crescent moon veiled by two passing night clouds.<br><br><strong>Examples:</strong><br>• 月曜日 (げつようび) — Monday<br>• 今月 (こんげつ) — This month<br>• 一月 (いちがつ) — January"
  },
  {
    front: "火",
    back: "Fire<br><strong>Kun:</strong> ひ, -び, ほ-<br><strong>On:</strong> カ",
    description: "<strong>Radical:</strong> 火 (fire) • 4 strokes<br><strong>Mnemonic:</strong> Sparks and flames leaping upwards into the sky.<br><br><strong>Examples:</strong><br>• 火曜日 (かようび) — Tuesday<br>• 火事 (かじ) — A fire<br>• 花火 (はなび) — Fireworks"
  },
  {
    front: "水",
    back: "Water<br><strong>Kun:</strong> みず<br><strong>On:</strong> スイ",
    description: "<strong>Radical:</strong> 水 (water) • 4 strokes<br><strong>Mnemonic:</strong> A central cascading waterfall with water splashing to both sides.<br><br><strong>Examples:</strong><br>• 水 (みず) — Water<br>• 水曜日 (すいようび) — Wednesday<br>• 水泳 (すいえい) — Swimming"
  },
  {
    front: "木",
    back: "Tree, Wood<br><strong>Kun:</strong> き, こ-<br><strong>On:</strong> モク, ボク",
    description: "<strong>Radical:</strong> 木 (tree) • 4 strokes<br><strong>Mnemonic:</strong> A tree with branches reaching up and roots branching down.<br><br><strong>Examples:</strong><br>• 木 (き) — Tree<br>• 木曜日 (もくようび) — Thursday<br>• 木造 (もくぞう) — Wooden"
  },
  {
    front: "金",
    back: "Gold, Money, Metal<br><strong>Kun:</strong> かね, かな-<br><strong>On:</strong> キン, コン",
    description: "<strong>Radical:</strong> 金 (metal) • 8 strokes<br><strong>Mnemonic:</strong> Gold nuggets resting underground beneath a shelter roof.<br><br><strong>Examples:</strong><br>• お金 (おかね) — Money<br>• 金曜日 (きんようび) — Friday<br>• 料金 (りょうきん) — Fee / Charge"
  },
  {
    front: "土",
    back: "Earth, Soil, Ground<br><strong>Kun:</strong> つち<br><strong>On:</strong> ド, ト",
    description: "<strong>Radical:</strong> 土 (earth) • 3 strokes<br><strong>Mnemonic:</strong> A sprout growing upwards out of the flat ground.<br><br><strong>Examples:</strong><br>• 土 (つち) — Soil / Earth<br>• 土曜日 (どようび) — Saturday<br>• 土地 (とち) — Land / Plot"
  },
  {
    front: "今",
    back: "Now, Present<br><strong>Kun:</strong> いま<br><strong>On:</strong> コン, キン",
    description: "<strong>Radical:</strong> 人 (person) • 4 strokes<br><strong>Mnemonic:</strong> A roof gathering the fleeting moment of the present time.<br><br><strong>Examples:</strong><br>• 今 (いま) — Now<br>• 今日 (きょう) — Today<br>• 今週 (こんしゅう) — This week"
  },
  {
    front: "時",
    back: "Time, Hour<br><strong>Kun:</strong> とき, -どき<br><strong>On:</strong> ジ",
    description: "<strong>Radical:</strong> 日 (sun) • 10 strokes<br><strong>Mnemonic:</strong> Tracking the sun (日) at the temple (寺) to tell the hour.<br><br><strong>Examples:</strong><br>• 時間 (じかん) — Time / Hours<br>• 一時 (いちじ) — 1 o'clock<br>• 時々 (ときどき) — Sometimes"
  },
  {
    front: "分",
    back: "Minute, Part, Understand<br><strong>Kun:</strong> わ・かる, わ・ける<br><strong>On:</strong> ブン, フン, ブ",
    description: "<strong>Radical:</strong> 刀 (knife) • 4 strokes<br><strong>Mnemonic:</strong> A knife (刀) dividing (八) an hour into minutes.<br><br><strong>Examples:</strong><br>• 五分 (ごふん) — 5 minutes<br>• 分かる (わかる) — To understand<br>• 自分 (じぶん) — Oneself"
  },
  {
    front: "半",
    back: "Half, Middle<br><strong>Kun:</strong> なか・ば<br><strong>On:</strong> ハン",
    description: "<strong>Radical:</strong> 十 (ten) • 5 strokes<br><strong>Mnemonic:</strong> Cutting an object straight down the middle into two halves.<br><br><strong>Examples:</strong><br>• 半分 (はんぶん) — Half<br>• 二時半 (にじはん) — 2:30<br>• 半年 (はんとし) — Half a year"
  },
  {
    front: "毎",
    back: "Every<br><strong>Kun:</strong> ごと<br><strong>On:</strong> マイ",
    description: "<strong>Radical:</strong> 毋 (mother) • 6 strokes<br><strong>Mnemonic:</strong> A devoted mother (母) attending to her child every single day.<br><br><strong>Examples:</strong><br>• 毎日 (まいにち) — Every day<br>• 毎週 (まいしゅう) — Every week<br>• 毎年 (まいとし) — Every year"
  },

  // --- TIME RELATIONS & SEQUENCE ---
  {
    front: "午",
    back: "Noon, Sign of the Horse<br><strong>Kun:</strong> うま<br><strong>On:</strong> ゴ",
    description: "<strong>Radical:</strong> 十 (ten) • 4 strokes<br><strong>Mnemonic:</strong> A sundial marker pointing straight up at noon.<br><br><strong>Examples:</strong><br>• 午前 (ごぜん) — Morning / A.M.<br>• 午後 (ごご) — Afternoon / P.M.<br>• 正午 (しょうご) — High noon"
  },
  {
    front: "前",
    back: "Before, Front, In Advance<br><strong>Kun:</strong> まえ<br><strong>On:</strong> ゼン",
    description: "<strong>Radical:</strong> 刀 (knife) • 9 strokes<br><strong>Mnemonic:</strong> Stepping forward with legs ahead, trimming the path with a blade.<br><br><strong>Examples:</strong><br>• 前 (まえ) — Front / Before<br>• 午前 (ごぜん) — A.M.<br>• 名前 (なまえ) — Name"
  },
  {
    front: "後",
    back: "After, Behind, Later<br><strong>Kun:</strong> のち, うし・ろ, あと<br><strong>On:</strong> ゴ, コウ",
    description: "<strong>Radical:</strong> 彳 (step) • 9 strokes<br><strong>Mnemonic:</strong> Walking slowly (彳) while silk threads (幺) drag behind.<br><br><strong>Examples:</strong><br>• 後ろ (うしろ) — Behind / Back<br>• 午後 (ごご) — P.M.<br>• 後で (あとで) — Later"
  },
  {
    front: "週",
    back: "Week<br><strong>Kun:</strong> (none)<br><strong>On:</strong> シュウ",
    description: "<strong>Radical:</strong> 辶 (road) • 11 strokes<br><strong>Mnemonic:</strong> Travelling (辶) around a complete lap (周) of 7 days.<br><br><strong>Examples:</strong><br>• 今週 (こんしゅう) — This week<br>• 来週 (らいしゅう) — Next week<br>• 週末 (しゅうまつ) — Weekend"
  },
  {
    front: "間",
    back: "Interval, Between, Space<br><strong>Kun:</strong> あいだ, ま<br><strong>On:</strong> カン, ケン",
    description: "<strong>Radical:</strong> 門 (gate) • 12 strokes<br><strong>Mnemonic:</strong> Sunlight (日) glowing through the gap between closed gates (門).<br><br><strong>Examples:</strong><br>• 間 (あいだ) — Between / Interval<br>• 時間 (じかん) — Time<br>• 一週間 (いっしゅうかん) — One week"
  },
  {
    front: "先",
    back: "Previous, Ahead, Future<br><strong>Kun:</strong> さき<br><strong>On:</strong> セン",
    description: "<strong>Radical:</strong> 儿 (legs) • 6 strokes<br><strong>Mnemonic:</strong> Someone running ahead on quick legs (儿) into the lead.<br><br><strong>Examples:</strong><br>• 先生 (せんせい) — Teacher<br>• 先週 (せんしゅう) — Last week<br>• 先 (さき) — Ahead / Tip"
  },

  // --- PEOPLE & FAMILY ---
  {
    front: "人",
    back: "Person, Human<br><strong>Kun:</strong> ひと<br><strong>On:</strong> ジン, ニン",
    description: "<strong>Radical:</strong> 人 (person) • 2 strokes<br><strong>Mnemonic:</strong> A human standing firmly on two supporting legs.<br><br><strong>Examples:</strong><br>• 人 (ひと) — Person<br>• 日本人 (にほんじん) — Japanese person<br>• 三人 (さんにん) — Three people"
  },
  {
    front: "男",
    back: "Man, Male<br><strong>Kun:</strong> おとこ<br><strong>On:</strong> ダン, ナン",
    description: "<strong>Radical:</strong> 田 (rice field) • 7 strokes<br><strong>Mnemonic:</strong> Physical power (力) exerted in the rice fields (田).<br><br><strong>Examples:</strong><br>• 男 (おとこ) — Man<br>• 男の子 (おとこのこ) — Boy<br>• 男性 (だんせい) — Male / Man"
  },
  {
    front: "女",
    back: "Woman, Female<br><strong>Kun:</strong> おんな, め<br><strong>On:</strong> ジョ, ニョ",
    description: "<strong>Radical:</strong> 女 (woman) • 3 strokes<br><strong>Mnemonic:</strong> A woman seated gracefully with arms crossed gently.<br><br><strong>Examples:</strong><br>• 女 (おんな) — Woman<br>• 女の子 (おんなのこ) — Girl<br>• 女性 (じょせい) — Female / Woman"
  },
  {
    front: "子",
    back: "Child<br><strong>Kun:</strong> こ<br><strong>On:</strong> シ, ス",
    description: "<strong>Radical:</strong> 子 (child) • 3 strokes<br><strong>Mnemonic:</strong> A baby in swaddling clothes waving its arms.<br><br><strong>Examples:</strong><br>• 子供 (こども) — Child<br>• 男の子 (おとこのこ) — Boy<br>• 女の子 (おんなのこ) — Girl"
  },
  {
    front: "父",
    back: "Father<br><strong>Kun:</strong> ちち, とう<br><strong>On:</strong> フ",
    description: "<strong>Radical:</strong> 父 (father) • 4 strokes<br><strong>Mnemonic:</strong> The head of the family holding two crossed rods of guidance.<br><br><strong>Examples:</strong><br>• 父 (ちち) — (My) father<br>• お父さん (おとうさん) — Father<br>• 父親 (ちちおや) — Father"
  },
  {
    front: "母",
    back: "Mother<br><strong>Kun:</strong> はは, かあ<br><strong>On:</strong> ボ",
    description: "<strong>Radical:</strong> 毋 (mother) • 5 strokes<br><strong>Mnemonic:</strong> A mother embracing her child, with two dots of nourishment.<br><br><strong>Examples:</strong><br>• 母 (はは) — (My) mother<br>• お母さん (おかあさん) — Mother<br>• 母親 (ははおや) — Mother"
  },
  {
    front: "友",
    back: "Friend<br><strong>Kun:</strong> とも<br><strong>On:</strong> ユウ",
    description: "<strong>Radical:</strong> 又 (again/hand) • 4 strokes<br><strong>Mnemonic:</strong> Two right hands joining together in fellowship.<br><br><strong>Examples:</strong><br>• 友達 (ともだち) — Friend<br>• 友人 (ゆうじん) — Friend<br>• 親友 (しんゆう) — Best friend"
  },
  {
    front: "生",
    back: "Life, Birth, Student<br><strong>Kun:</strong> う・まれる, い・きる, なま<br><strong>On:</strong> セイ, ショウ",
    description: "<strong>Radical:</strong> 生 (life) • 5 strokes<br><strong>Mnemonic:</strong> A vibrant plant sprout bursting upwards into life.<br><br><strong>Examples:</strong><br>• 先生 (せんせい) — Teacher<br>• 学生 (がくせい) — Student<br>• 生まれる (うまれる) — To be born"
  },

  // --- BODY PARTS ---
  {
    front: "目",
    back: "Eye<br><strong>Kun:</strong> め<br><strong>On:</strong> モク, ボク",
    description: "<strong>Radical:</strong> 目 (eye) • 5 strokes<br><strong>Mnemonic:</strong> An eye rotated vertically with pupil lines inside.<br><br><strong>Examples:</strong><br>• 目 (め) — Eye<br>• 一日目 (いちにちめ) — First day<br>• 目的 (もくてき) — Purpose / Goal"
  },
  {
    front: "耳",
    back: "Ear<br><strong>Kun:</strong> みみ<br><strong>On:</strong> ジ",
    description: "<strong>Radical:</strong> 耳 (ear) • 6 strokes<br><strong>Mnemonic:</strong> The outer curves and ear canal capturing sound.<br><br><strong>Examples:</strong><br>• 耳 (みみ) — Ear<br>• 初耳 (はつみみ) — First time hearing something"
  },
  {
    front: "口",
    back: "Mouth, Opening<br><strong>Kun:</strong> くち, ぐち<br><strong>On:</strong> コウ, ク",
    description: "<strong>Radical:</strong> 口 (mouth) • 3 strokes<br><strong>Mnemonic:</strong> An open square mouth.<br><br><strong>Examples:</strong><br>• 口 (くち) — Mouth<br>• 入口 (いりぐち) — Entrance<br>• 出口 (でぐち) — Exit"
  },
  {
    front: "手",
    back: "Hand<br><strong>Kun:</strong> て<br><strong>On:</strong> シュ",
    description: "<strong>Radical:</strong> 手 (hand) • 4 strokes<br><strong>Mnemonic:</strong> An open hand showing four fingers and the palm.<br><br><strong>Examples:</strong><br>• 手 (て) — Hand<br>• 上手 (じょうず) — Skillful<br>• 下手 (へた) — Unskillful"
  },
  {
    front: "足",
    back: "Foot, Leg, Sufficient<br><strong>Kun:</strong> あし, た・りる<br><strong>On:</strong> ソク",
    description: "<strong>Radical:</strong> 足 (foot) • 7 strokes<br><strong>Mnemonic:</strong> Knee (口) over a calf and grounded foot (止).<br><br><strong>Examples:</strong><br>• 足 (あし) — Foot / Leg<br>• 足りる (たりる) — To be sufficient<br>• 一足 (いっそく) — One pair of shoes"
  },

  // --- DIRECTIONS & POSITIONS ---
  {
    front: "上",
    back: "Up, Above, Upper<br><strong>Kun:</strong> うえ, あ・がる, のぼ・る<br><strong>On:</strong> ジョウ",
    description: "<strong>Radical:</strong> 一 (one) • 3 strokes<br><strong>Mnemonic:</strong> A vertical stem pointing upwards above the baseline.<br><br><strong>Examples:</strong><br>• 上 (うえ) — Above / Up<br>• 上手 (じょうず) — Good at<br>• 上がる (あがる) — To go up"
  },
  {
    front: "下",
    back: "Down, Below, Under<br><strong>Kun:</strong> した, さ・がる, くだ・る<br><strong>On:</strong> カ, ゲ",
    description: "<strong>Radical:</strong> 一 (one) • 3 strokes<br><strong>Mnemonic:</strong> A vertical stem pointing downwards below the baseline.<br><br><strong>Examples:</strong><br>• 下 (した) — Below / Under<br>• 下手 (へた) — Poor at<br>• 下がる (さがる) — To go down"
  },
  {
    front: "左",
    back: "Left<br><strong>Kun:</strong> ひだり<br><strong>On:</strong> サ",
    description: "<strong>Radical:</strong> 工 (work) • 5 strokes<br><strong>Mnemonic:</strong> The left hand holding a measuring tool (工).<br><br><strong>Examples:</strong><br>• 左 (ひだり) — Left<br>• 左手 (ひだりて) — Left hand<br>• 左側 (ひだりがわ) — Left side"
  },
  {
    front: "右",
    back: "Right<br><strong>Kun:</strong> みぎ<br><strong>On:</strong> ウ, ユウ",
    description: "<strong>Radical:</strong> 口 (mouth) • 5 strokes<br><strong>Mnemonic:</strong> The right hand bringing food up to the mouth (口).<br><br><strong>Examples:</strong><br>• 右 (みぎ) — Right<br>• 右手 (みぎて) — Right hand<br>• 左右 (さゆう) — Left and right"
  },
  {
    front: "中",
    back: "Inside, Middle, Center<br><strong>Kun:</strong> なか<br><strong>On:</strong> チュウ",
    description: "<strong>Radical:</strong> 丨 (line) • 4 strokes<br><strong>Mnemonic:</strong> An arrow piercing right through the bullseye center of a target.<br><br><strong>Examples:</strong><br>• 中 (なか) — Inside / Middle<br>• 一日中 (いちにちじゅう) — All day long<br>• 中国 (ちゅうごく) — China"
  },
  {
    front: "北",
    back: "North<br><strong>Kun:</strong> きた<br><strong>On:</strong> ホク",
    description: "<strong>Radical:</strong> 匕 (spoon) • 5 strokes<br><strong>Mnemonic:</strong> Two people huddled back-to-back freezing in the icy north wind.<br><br><strong>Examples:</strong><br>• 北 (きた) — North<br>• 北口 (きたぐち) — North exit<br>• 北海道 (ほっかいどう) — Hokkaido"
  },
  {
    front: "南",
    back: "South<br><strong>Kun:</strong> みなみ<br><strong>On:</strong> ナン",
    description: "<strong>Radical:</strong> 十 (ten) • 9 strokes<br><strong>Mnemonic:</strong> Lush greenery thriving in the warm southern warmth.<br><br><strong>Examples:</strong><br>• 南 (みなみ) — South<br>• 南口 (みなみぐち) — South exit<br>• 南極 (なんきょく) — South Pole"
  },
  {
    front: "東",
    back: "East<br><strong>Kun:</strong> ひがし<br><strong>On:</strong> トウ",
    description: "<strong>Radical:</strong> 木 (tree) • 8 strokes<br><strong>Mnemonic:</strong> The morning sun (日) rising behind the branches of a tree (木).<br><br><strong>Examples:</strong><br>• 東 (ひがし) — East<br>• 東京 (とうきょう) — Tokyo<br>• 東口 (ひがしぐち) — East exit"
  },
  {
    front: "西",
    back: "West<br><strong>Kun:</strong> にし<br><strong>On:</strong> セイ, サイ",
    description: "<strong>Radical:</strong> 襾 (cover) • 6 strokes<br><strong>Mnemonic:</strong> A bird resting in its nest at sunset in the west.<br><br><strong>Examples:</strong><br>• 西 (にし) — West<br>• 西口 (にしぐち) — West exit<br>• 東西 (とうざい) — East and west"
  },
  {
    front: "外",
    back: "Outside, Foreign<br><strong>Kun:</strong> そと, ほか, はず・す<br><strong>On:</strong> ガイ, ゲ",
    description: "<strong>Radical:</strong> 夕 (evening) • 5 strokes<br><strong>Mnemonic:</strong> Casting divining sticks (卜) outside in the evening (夕).<br><br><strong>Examples:</strong><br>• 外 (そと) — Outside<br>• 外国 (がいこく) — Foreign country<br>• 外国人 (がいこくじん) — Foreigner"
  },

  // --- NATURE & ENVIRONMENT ---
  {
    front: "山",
    back: "Mountain<br><strong>Kun:</strong> やま<br><strong>On:</strong> サン, ザン",
    description: "<strong>Radical:</strong> 山 (mountain) • 3 strokes<br><strong>Mnemonic:</strong> Three peaks of a mountain range towering upwards.<br><br><strong>Examples:</strong><br>• 山 (やま) — Mountain<br>• 富士山 (ふじさん) — Mt. Fuji<br>• 火山 (かざん) — Volcano"
  },
  {
    front: "川",
    back: "River, Stream<br><strong>Kun:</strong> かわ, がわ<br><strong>On:</strong> セン",
    description: "<strong>Radical:</strong> 川 (river) • 3 strokes<br><strong>Mnemonic:</strong> Three winding currents of water running between riverbanks.<br><br><strong>Examples:</strong><br>• 川 (かわ) — River<br>• 小川 (おがわ) — Brook / Stream<br>• 川岸 (かわぎし) — Riverbank"
  },
  {
    front: "天",
    back: "Heaven, Sky<br><strong>Kun:</strong> あまつ<br><strong>On:</strong> テン",
    description: "<strong>Radical:</strong> 大 (big) • 4 strokes<br><strong>Mnemonic:</strong> A person (大) stretching under the high dome of heaven.<br><br><strong>Examples:</strong><br>• 天気 (てんき) — Weather<br>• 天才 (てんさい) — Genius<br>• 天国 (てんごく) — Heaven"
  },
  {
    front: "気",
    back: "Spirit, Energy, Mind, Air<br><strong>Kun:</strong> (none)<br><strong>On:</strong> キ, ケ",
    description: "<strong>Radical:</strong> 气 (steam) • 6 strokes<br><strong>Mnemonic:</strong> Steam and vapor rising up, representing vital life energy (Ki).<br><br><strong>Examples:</strong><br>• 元気 (げんき) — Healthy / Energetic<br>• 電気 (でんき) — Electricity<br>• 天気 (てんき) — Weather"
  },
  {
    front: "雨",
    back: "Rain<br><strong>Kun:</strong> あめ, あま-<br><strong>On:</strong> ウ",
    description: "<strong>Radical:</strong> 雨 (rain) • 8 strokes<br><strong>Mnemonic:</strong> Rain droplets pouring from clouds down past a windowpane.<br><br><strong>Examples:</strong><br>• 雨 (あめ) — Rain<br>• 大雨 (おおあめ) — Heavy rain<br>• 雨天 (うてん) — Rainy weather"
  },
  {
    front: "空",
    back: "Sky, Empty<br><strong>Kun:</strong> そら, あ・く, から<br><strong>On:</strong> クウ",
    description: "<strong>Radical:</strong> 穴 (cave) • 8 strokes<br><strong>Mnemonic:</strong> Looking out from a dark cave (穴) into the expansive open sky.<br><br><strong>Examples:</strong><br>• 空 (そら) — Sky<br>• 空気 (くうき) — Air / Atmosphere<br>• 空港 (くうこう) — Airport"
  },
  {
    front: "花",
    back: "Flower<br><strong>Kun:</strong> はな<br><strong>On:</strong> カ",
    description: "<strong>Radical:</strong> 艹 (grass) • 7 strokes<br><strong>Mnemonic:</strong> Plants (艹) transforming (化) into colorful blossoms.<br><br><strong>Examples:</strong><br>• 花 (はな) — Flower<br>• 花火 (はなび) — Fireworks<br>• 花見 (はなみ) — Cherry blossom viewing"
  },
  {
    front: "白",
    back: "White<br><strong>Kun:</strong> しろ, しろ・い<br><strong>On:</strong> ハク, ビャク",
    description: "<strong>Radical:</strong> 白 (white) • 5 strokes<br><strong>Mnemonic:</strong> A clear ray of bright white sunlight.<br><br><strong>Examples:</strong><br>• 白い (しろい) — White<br>• 面白い (おもしろい) — Interesting / Fun<br>• 白鳥 (はくちょう) — Swan"
  },
  {
    front: "魚",
    back: "Fish<br><strong>Kun:</strong> さかな, うお<br><strong>On:</strong> ギョ",
    description: "<strong>Radical:</strong> 魚 (fish) • 11 strokes<br><strong>Mnemonic:</strong> A fish head (ク), scaled body (田), and tail fins (灬).<br><br><strong>Examples:</strong><br>• 魚 (さかな) — Fish<br>• 金魚 (きんぎょ) — Goldfish<br>• 魚屋 (さかなや) — Fishmonger"
  },

  // --- ACTIONS & VERBS ---
  {
    front: "行",
    back: "Go, Act, Conduct<br><strong>Kun:</strong> い・く, ゆ・く, おこな・う<br><strong>On:</strong> コウ, ギョウ",
    description: "<strong>Radical:</strong> 行 (go) • 6 strokes<br><strong>Mnemonic:</strong> A bustling four-way intersection where pedestrians go.<br><br><strong>Examples:</strong><br>• 行く (いく) — To go<br>• 旅行 (りょこう) — Travel<br>• 銀行 (ぎんこう) — Bank"
  },
  {
    front: "来",
    back: "Come, Next<br><strong>Kun:</strong> く・る, きた・る<br><strong>On:</strong> ライ",
    description: "<strong>Radical:</strong> 木 (tree) • 7 strokes<br><strong>Mnemonic:</strong> Ripe grain ears arriving on the stalk for harvest.<br><br><strong>Examples:</strong><br>• 来る (くる) — To come<br>• 来年 (らいねん) — Next year<br>• 来週 (らいしゅう) — Next week"
  },
  {
    front: "出",
    back: "Exit, Leave, Take Out<br><strong>Kun:</strong> で・る, だ・す<br><strong>On:</strong> シュツ, スイ",
    description: "<strong>Radical:</strong> 凵 (box) • 5 strokes<br><strong>Mnemonic:</strong> Two plant shoots bursting up and exiting from the ground.<br><br><strong>Examples:</strong><br>• 出る (でる) — To leave / To exit<br>• 出口 (でぐち) — Exit<br>• 出す (だす) — To take out / Mail"
  },
  {
    front: "入",
    back: "Enter, Insert<br><strong>Kun:</strong> はい・る, い・れる<br><strong>On:</strong> ニュウ",
    description: "<strong>Radical:</strong> 入 (enter) • 2 strokes<br><strong>Mnemonic:</strong> An arrow pointing inward through an entranceway.<br><br><strong>Examples:</strong><br>• 入る (はいる) — To enter<br>• 入口 (いりぐち) — Entrance<br>• 入れる (いれる) — To put in"
  },
  {
    front: "食",
    back: "Eat, Food<br><strong>Kun:</strong> た・べる, く・う<br><strong>On:</strong> ショク",
    description: "<strong>Radical:</strong> 食 (food) • 9 strokes<br><strong>Mnemonic:</strong> Gathering under a roof (亼) to eat good (良) food.<br><br><strong>Examples:</strong><br>• 食べる (たべる) — To eat<br>• 食事 (しょくじ) — Meal<br>• 食べ物 (たべもの) — Food"
  },
  {
    front: "飲",
    back: "Drink<br><strong>Kun:</strong> の・む<br><strong>On:</strong> イン",
    description: "<strong>Radical:</strong> 食 (food) • 12 strokes<br><strong>Mnemonic:</strong> Opening your mouth wide (欠) to drink liquid nourishment (飠).<br><br><strong>Examples:</strong><br>• 飲む (のむ) — To drink<br>• 飲み物 (のみもの) — Beverage<br>• 飲食店 (いんしょくてん) — Restaurant"
  },
  {
    front: "見",
    back: "See, Look, Show<br><strong>Kun:</strong> み・る, み・える, み・せる<br><strong>On:</strong> ケン",
    description: "<strong>Radical:</strong> 見 (see) • 7 strokes<br><strong>Mnemonic:</strong> A giant observant eye (目) walking forward on two legs (儿).<br><br><strong>Examples:</strong><br>• 見る (みる) — To see / watch<br>• 見せる (みせる) — To show<br>• 意見 (いけん) — Opinion"
  },
  {
    front: "聞",
    back: "Hear, Listen, Ask<br><strong>Kun:</strong> き・く, き・こえる<br><strong>On:</strong> ブン, モン",
    description: "<strong>Radical:</strong> 耳 (ear) • 14 strokes<br><strong>Mnemonic:</strong> Pressing your ear (耳) against the wooden door gates (門) to listen.<br><br><strong>Examples:</strong><br>• 聞く (きく) — To hear / listen / ask<br>• 聞こえる (きこえる) — To be audible<br>• 新聞 (しんぶん) — Newspaper"
  },
  {
    front: "読",
    back: "Read<br><strong>Kun:</strong> よ・む<br><strong>On:</strong> ドク, トク",
    description: "<strong>Radical:</strong> 言 (word) • 14 strokes<br><strong>Mnemonic:</strong> Reciting spoken words (言) from a book bought at market (売).<br><br><strong>Examples:</strong><br>• 読む (よむ) — To read<br>• 読書 (どくしょ) — Reading books"
  },
  {
    front: "書",
    back: "Write, Book<br><strong>Kun:</strong> か・く<br><strong>On:</strong> ショ",
    description: "<strong>Radical:</strong> 曰 (say) • 10 strokes<br><strong>Mnemonic:</strong> A hand wielding a calligraphy pen (聿) writing on parchment (日).<br><br><strong>Examples:</strong><br>• 書く (かく) — To write<br>• 辞書 (じしょ) — Dictionary<br>• 図書館 (としょかん) — Library"
  },
  {
    front: "話",
    back: "Speak, Talk, Story<br><strong>Kun:</strong> はな・す, はなし<br><strong>On:</strong> ワ",
    description: "<strong>Radical:</strong> 言 (word) • 13 strokes<br><strong>Mnemonic:</strong> Shaping words (言) with the movement of your tongue (舌).<br><br><strong>Examples:</strong><br>• 話す (はなす) — To speak / talk<br>• 話 (はなし) — Story / Conversation<br>• 電話 (でんわ) — Telephone"
  },
  {
    front: "買",
    back: "Buy<br><strong>Kun:</strong> か・う<br><strong>On:</strong> バイ",
    description: "<strong>Radical:</strong> 貝 (shell/money) • 12 strokes<br><strong>Mnemonic:</strong> Bringing money shells (貝) to exchange for goods.<br><br><strong>Examples:</strong><br>• 買う (かう) — To buy<br>• 買い物 (かいもの) — Shopping<br>• 売買 (ばいばい) — Buying and selling"
  },
  {
    front: "会",
    back: "Meet, Association<br><strong>Kun:</strong> あ・う<br><strong>On:</strong> カイ, エ",
    description: "<strong>Radical:</strong> 人 (person) • 6 strokes<br><strong>Mnemonic:</strong> People congregating under a common roof to converse.<br><br><strong>Examples:</strong><br>• 会う (あう) — To meet<br>• 会社 (かいしゃ) — Company<br>• 会話 (かいわ) — Conversation"
  },
  {
    front: "休",
    back: "Rest, Day Off<br><strong>Kun:</strong> やす・む, やす・まる<br><strong>On:</strong> キュウ",
    description: "<strong>Radical:</strong> 亻 (person) • 6 strokes<br><strong>Mnemonic:</strong> A person (亻) relaxing comfortably against a tree (木).<br><br><strong>Examples:</strong><br>• 休む (やすむ) — To rest<br>• 休み (やすみ) — Break / Holiday<br>• 休日 (きゅうじつ) — Day off"
  },
  {
    front: "言",
    back: "Say, Word<br><strong>Kun:</strong> い・う, こと<br><strong>On:</strong> ゲン, ゴン",
    description: "<strong>Radical:</strong> 言 (word) • 7 strokes<br><strong>Mnemonic:</strong> Vowels and speech waves flowing outward from an open mouth (口).<br><br><strong>Examples:</strong><br>• 言う (いう) — To say<br>• 言葉 (ことば) — Word / Language<br>• 方言 (ほうげん) — Dialect"
  },
  {
    front: "立",
    back: "Stand, Establish<br><strong>Kun:</strong> た・つ, た・てる<br><strong>On:</strong> リツ",
    description: "<strong>Radical:</strong> 立 (stand) • 5 strokes<br><strong>Mnemonic:</strong> A person standing tall and upright on the earth.<br><br><strong>Examples:</strong><br>• 立つ (たつ) — To stand<br>• 国立 (こくりつ) — National<br>• 立派 (りっぱ) — Splendid / Fine"
  },

  // --- SOCIETY, PLACES & OBJECTS ---
  {
    front: "本",
    back: "Book, Origin, Main<br><strong>Kun:</strong> もと<br><strong>On:</strong> ホン",
    description: "<strong>Radical:</strong> 木 (tree) • 5 strokes<br><strong>Mnemonic:</strong> A line marking the roots/origin of a tree, source of book paper.<br><br><strong>Examples:</strong><br>• 本 (ほん) — Book<br>• 日本 (にほん) — Japan<br>• 本当 (ほんとう) — Really / Truth"
  },
  {
    front: "学",
    back: "Study, Learning, School<br><strong>Kun:</strong> まな・ぶ<br><strong>On:</strong> ガク",
    description: "<strong>Radical:</strong> 子 (child) • 8 strokes<br><strong>Mnemonic:</strong> A child (子) under a roof acquiring enlightenment.<br><br><strong>Examples:</strong><br>• 学生 (がくせい) — Student<br>• 大学 (だいがく) — University<br>• 学校 (がっこう) — School"
  },
  {
    front: "校",
    back: "School, Exam<br><strong>Kun:</strong> (none)<br><strong>On:</strong> コウ",
    description: "<strong>Radical:</strong> 木 (tree) • 10 strokes<br><strong>Mnemonic:</strong> A wooden hall (木) where students exchange (交) thoughts.<br><br><strong>Examples:</strong><br>• 学校 (がっこう) — School<br>• 高校 (こうこう) — High school<br>• 小学校 (しょうがっこう) — Elementary school"
  },
  {
    front: "名",
    back: "Name, Reputation<br><strong>Kun:</strong> な<br><strong>On:</strong> メイ, ミョウ",
    description: "<strong>Radical:</strong> 口 (mouth) • 6 strokes<br><strong>Mnemonic:</strong> Calling your name aloud (口) in the dim evening (夕).<br><br><strong>Examples:</strong><br>• 名前 (なまえ) — Name<br>• 有名 (ゆうめい) — Famous<br>• 名刺 (めいし) — Business card"
  },
  {
    front: "語",
    back: "Language, Word, Tell<br><strong>Kun:</strong> かた・る<br><strong>On:</strong> ゴ",
    description: "<strong>Radical:</strong> 言 (word) • 14 strokes<br><strong>Mnemonic:</strong> Words (言) spoken by the speaker (吾) to share language.<br><br><strong>Examples:</strong><br>• 日本語 (にほんご) — Japanese language<br>• 英語 (えいご) — English<br>• 単語 (たんご) — Vocabulary"
  },
  {
    front: "国",
    back: "Country, Nation<br><strong>Kun:</strong> くに<br><strong>On:</strong> コク",
    description: "<strong>Radical:</strong> 囗 (border) • 8 strokes<br><strong>Mnemonic:</strong> A precious jewel (玉) protected within sovereign borders (囗).<br><br><strong>Examples:</strong><br>• 国 (くに) — Country<br>• 外国 (がいこく) — Foreign country<br>• 中国 (ちゅうごく) — China"
  },
  {
    front: "道",
    back: "Road, Way, Street, Path<br><strong>Kun:</strong> みち<br><strong>On:</strong> ドウ, トウ",
    description: "<strong>Radical:</strong> 辶 (movement) • 12 strokes<br><strong>Mnemonic:</strong> Marching forward (辶) keeping your head (首) on the true way.<br><br><strong>Examples:</strong><br>• 道 (みち) — Road / Way<br>• 水道 (すいどう) — Water service<br>• 茶道 (さどう) — Tea ceremony"
  },
  {
    front: "駅",
    back: "Train Station<br><strong>Kun:</strong> (none)<br><strong>On:</strong> エキ",
    description: "<strong>Radical:</strong> 馬 (horse) • 14 strokes<br><strong>Mnemonic:</strong> Where travel horses (馬) were once changed at relay posts.<br><br><strong>Examples:</strong><br>• 駅 (えき) — Station<br>• 駅前 (えきまえ) — In front of the station<br>• 駅員 (えきいん) — Station attendant"
  },
  {
    front: "社",
    back: "Company, Shrine, Society<br><strong>Kun:</strong> やしろ<br><strong>On:</strong> シャ",
    description: "<strong>Radical:</strong> 礻 (altar) • 7 strokes<br><strong>Mnemonic:</strong> A communal altar (礻) raised upon sacred earth (土).<br><br><strong>Examples:</strong><br>• 会社 (かいしゃ) — Company<br>• 神社 (じんじゃ) — Shinto shrine<br>• 社会 (しゃかい) — Society"
  },
  {
    front: "店",
    back: "Shop, Store<br><strong>Kun:</strong> みせ<br><strong>On:</strong> テン",
    description: "<strong>Radical:</strong> 广 (building) • 8 strokes<br><strong>Mnemonic:</strong> Goods placed for sale (占) inside a sheltered building (广).<br><br><strong>Examples:</strong><br>• 店 (みせ) — Shop<br>• 店員 (てんいん) — Shop assistant<br>• 喫茶店 (きっさてん) — Coffee shop"
  },
  {
    front: "員",
    back: "Member, Employee<br><strong>Kun:</strong> (none)<br><strong>On:</strong> イン",
    description: "<strong>Radical:</strong> 口 (mouth) • 10 strokes<br><strong>Mnemonic:</strong> A mouth (口) earning shells / pay (貝) as an organization member.<br><br><strong>Examples:</strong><br>• 会社員 (かいしゃいん) — Company employee<br>• 店員 (てんいん) — Clerk<br>• 全員 (ぜんいん) — Everyone"
  },
  {
    front: "車",
    back: "Car, Vehicle, Wheel<br><strong>Kun:</strong> くるま<br><strong>On:</strong> シャ",
    description: "<strong>Radical:</strong> 車 (cart) • 7 strokes<br><strong>Mnemonic:</strong> A horse-drawn carriage or car viewed from above.<br><br><strong>Examples:</strong><br>• 車 (くるま) — Car<br>• 電車 (でんしゃ) — Electric train<br>• 自動車 (じどうしゃ) — Automobile"
  },
  {
    front: "電",
    back: "Electricity<br><strong>Kun:</strong> (none)<br><strong>On:</strong> デン",
    description: "<strong>Radical:</strong> 雨 (rain) • 13 strokes<br><strong>Mnemonic:</strong> Storm clouds (雨) releasing lightning energy (申) from above.<br><br><strong>Examples:</strong><br>• 電気 (でんき) — Electricity / Light<br>• 電車 (でんしゃ) — Train<br>• 電話 (でんわ) — Telephone"
  },

  // --- SIZE, QUALITY & STATE ---
  {
    front: "大",
    back: "Big, Large<br><strong>Kun:</strong> おお, おお・きい<br><strong>On:</strong> ダイ, タイ",
    description: "<strong>Radical:</strong> 大 (big) • 3 strokes<br><strong>Mnemonic:</strong> A person with arms and legs spread out wide to show greatness.<br><br><strong>Examples:</strong><br>• 大きい (おおきい) — Big<br>• 大学 (だいがく) — University<br>• 大変 (たいへん) — Very / Difficult"
  },
  {
    front: "小",
    back: "Small, Little<br><strong>Kun:</strong> ちい・さい, こ-, お-<br><strong>On:</strong> ショウ",
    description: "<strong>Radical:</strong> 小 (small) • 3 strokes<br><strong>Mnemonic:</strong> A tiny drop split into even smaller specks.<br><br><strong>Examples:</strong><br>• 小さい (ちいさい) — Small<br>• 小学校 (しょうがっこう) — Elementary school<br>• 小川 (おがわ) — Stream"
  },
  {
    front: "高",
    back: "Tall, High, Expensive<br><strong>Kun:</strong> たか・い, たか・まる<br><strong>On:</strong> コウ",
    description: "<strong>Radical:</strong> 高 (tall) • 10 strokes<br><strong>Mnemonic:</strong> A multi-tiered castle tower with an elevated gate.<br><br><strong>Examples:</strong><br>• 高い (たかい) — High / Expensive<br>• 高校 (こうこう) — High school<br>• 円高 (えんだか) — Strong yen"
  },
  {
    front: "安",
    back: "Cheap, Peaceful, Safe<br><strong>Kun:</strong> やす・い<br><strong>On:</strong> アン",
    description: "<strong>Radical:</strong> 女 (woman) • 6 strokes<br><strong>Mnemonic:</strong> A woman (女) resting securely in tranquility under her roof (宀).<br><br><strong>Examples:</strong><br>• 安い (やすい) — Cheap<br>• 安心 (あんしん) — Peace of mind<br>• 安全 (あんぜん) — Safety"
  },
  {
    front: "新",
    back: "New, Fresh<br><strong>Kun:</strong> あたら・しい, あら・た<br><strong>On:</strong> シン",
    description: "<strong>Radical:</strong> 斤 (axe) • 13 strokes<br><strong>Mnemonic:</strong> Felling fresh new timber (木) in the forest using an axe (斤).<br><br><strong>Examples:</strong><br>• 新しい (あたらしい) — New<br>• 新聞 (しんぶん) — Newspaper<br>• 新幹線 (しんかんせん) — Shinkansen"
  },
  {
    front: "古",
    back: "Old, Ancient<br><strong>Kun:</strong> ふる・い, ふる・す<br><strong>On:</strong> コ",
    description: "<strong>Radical:</strong> 口 (mouth) • 5 strokes<br><strong>Mnemonic:</strong> Legends told across ten (十) generations of mouths (口).<br><br><strong>Examples:</strong><br>• 古い (ふるい) — Old<br>• 中古 (ちゅうこ) — Secondhand<br>• 古代 (こだい) — Ancient times"
  },
  {
    front: "長",
    back: "Long, Leader, Senior<br><strong>Kun:</strong> なが・い<br><strong>On:</strong> チョウ",
    description: "<strong>Radical:</strong> 長 (long) • 8 strokes<br><strong>Mnemonic:</strong> An elder with long hair holding a leadership staff.<br><br><strong>Examples:</strong><br>• 長い (ながい) — Long<br>• 社長 (しゃちょう) — Company president<br>• 校長 (こうちょう) — School principal"
  },
  {
    front: "多",
    back: "Many, Much, Frequent<br><strong>Kun:</strong> おお・い<br><strong>On:</strong> タ",
    description: "<strong>Radical:</strong> 夕 (evening) • 6 strokes<br><strong>Mnemonic:</strong> Multiple crescent moons (夕) stacked, counting many nights.<br><br><strong>Examples:</strong><br>• 多い (おおい) — Many / Much<br>• 多分 (たぶん) — Probably<br>• 多少 (たしょう) — More or less"
  },
  {
    front: "少",
    back: "Few, Little<br><strong>Kun:</strong> すく・ない, すこ・し<br><strong>On:</strong> ショウ",
    description: "<strong>Radical:</strong> 小 (small) • 4 strokes<br><strong>Mnemonic:</strong> Small (小) with a slice cut off, leaving very few remaining.<br><br><strong>Examples:</strong><br>• 少し (すこし) — A little<br>• 少ない (すくない) — Few<br>• 少年 (しょうねん) — Boy / Youth"
  }
];

export const STARTER_FOLDER = "Japanese";
export const STARTER_DECK = "JLPT N5 Kanji";

/**
 * Loads the complete JLPT N5 Kanji deck into IndexedDB.
 * Safe and idempotent: Won't create duplicate cards if they already exist.
 * 
 * @param {Object} [options]
 * @param {boolean} [options.notify=true]
 * @returns {Promise<number>} Number of cards inserted
 */
export async function loadN5KanjiDeck({ notify = true } = {}) {
  try {
    const existingCards = await db.getCards();
    const existingKanjiFronts = new Set(
      existingCards
        .filter(c => !c.deleted && (c.folder || "").trim().toLowerCase() === STARTER_FOLDER.toLowerCase())
        .map(c => (c.front || "").trim())
    );

    const now = Date.now();
    const newCards = [];

    for (const item of JLPT_N5_KANJI_DECK) {
      if (!existingKanjiFronts.has(item.front.trim())) {
        newCards.push({
          id: generateUUID(),
          front: item.front,
          sub: undefined,
          back: item.back,
          description: item.description,
          folder: STARTER_FOLDER,
          deck: STARTER_DECK,
          fsrs_stats: createDefaultFSRSStats(),
          last_modified: now
        });
      }
    }

    if (newCards.length > 0) {
      await db.saveCards(newCards);
    }

    await loadCardsFromDB();
    setActiveDeckSelection(`deck:${STARTER_FOLDER} / ${STARTER_DECK}`);

    if (notify) {
      if (newCards.length > 0) {
        showToast(`Loaded ${newCards.length} JLPT N5 Kanji cards!`, "success");
      } else {
        showToast(`JLPT N5 Kanji deck is already up to date (${JLPT_N5_KANJI_DECK.length} cards)`, "info");
      }
    }

    return newCards.length;
  } catch (err) {
    console.error("Failed to load JLPT N5 Kanji deck:", err);
    if (notify) showToast("Failed to load JLPT N5 Kanji deck", "error");
    throw err;
  }
}

/**
 * Check on startup if database is completely empty; if so, seed N5 Kanji deck automatically.
 */
export async function checkAndSeedStarterDecks() {
  try {
    const activeCards = (state.allCards || []).filter(c => !c.deleted);
    if (activeCards.length === 0) {
      const seeded = await loadN5KanjiDeck({ notify: false });
      if (seeded > 0) {
        console.log(`Auto-seeded ${seeded} cards for ${STARTER_DECK}`);
        showToast(`Welcome! Preloaded ${seeded} JLPT N5 Kanji cards`, "success");
      }
    }
  } catch (err) {
    console.warn("Could not check/seed starter decks:", err);
  }
}
