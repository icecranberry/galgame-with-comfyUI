import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';
import { containsExplicitAdultContent } from './imagePromptKnowledgePolicy.js';

const ALL_SCENES = ['chat', 'moments', 'events', 'schedule', 'mailbox', 'avatar', 'gift', 'proactive', 'standalone'];
const SOURCE_PATH = fileURLToPath(new URL('./data/imagePromptTags.yaml', import.meta.url));
const MAX_CHUNK_SIZE = 20;
const MAX_CHUNK_CONTENT_LENGTH = 1600;
const MAX_TAG_LENGTH = 240;
const MAX_TAG_PARTS = 28;

const SKIPPED_SECTIONS = new Set(['反向提示词']);
const SKIPPED_GROUPS = new Set(['人物/年龄', '人物/二次元角色']);
const MINOR_PATTERN = /(?:\b(?:child|children|underage|minor|toddler|kindergartener|kindergarten|preteen|teenager|adolescent|schoolgirl|schoolboy|young boy|young girl|little girl|little boy|little_girl|little_boy|mesugaki|loli|shota)\b|未成年|幼童|幼儿园|儿童|小孩|小学生|中学生|初中生|高中生|青少年|萝莉|正太|雌小鬼)/i;
const MODEL_DIRECTIVE_PATTERN = /(?:<\s*lora:|\bembedding\b|\b(?:BadDream|badhandv4|BadNegAnatomyV1|AS-YoungV2-Neg|AS-Adult-Neg)\b)/i;
const INVALID_ONLY_PATTERN = /^[\s+_.,:;|/\\()[\]{}-]+$/;
const BLOCKED_EXACT_TAGS = new Set(['fundoshi']);
const LOW_QUALITY_POSITIVE_TAGS = new Set(['lowres']);
const TAG_CORRECTIONS = new Map([
  ['collarbonea', 'collarbone'],
  ['sign', 'sigh'],
  ['smartphones', 'smartphone'],
  ['a_sushi_roll', 'sushi_roll'],
]);
const LABEL_CORRECTIONS = new Map([
  ['collarbone', '锁骨'],
  ['eyewear', '眼镜'],
  ['sigh', '叹气'],
  ['tile_floor', '瓷砖地板'],
  ['bedroom', '卧室'],
  ['smartphone', '智能手机'],
  ['sushi_roll', '寿司卷'],
]);

const TOP_LEVEL_CATEGORY = {
  人物: 'character_vocabulary',
  服饰: 'clothing_vocabulary',
  表情动作: 'expression_pose_vocabulary',
  体位: 'adult_pose_vocabulary',
  画面: 'visual_style_vocabulary',
  环境: 'environment_vocabulary',
  场景: 'scene_vocabulary',
  物品: 'object_vocabulary',
  镜头: 'camera_vocabulary',
};

const TOPIC_ALIASES = {
  '人物/对象': '人物关系与对象',
  '人物/身份': '职业与身份',
  '人物/皮肤': '身体与皮肤',
  '人物/身材': '身体与皮肤',
  '人物/脸型': '身体与皮肤',
  '人物/肩部': '身体与皮肤',
  '人物/胸部': '身体与皮肤',
  '人物/腰部': '身体与皮肤',
  '人物/腹部': '身体与皮肤',
  '人物/指甲': '身体与皮肤',
  '人物/头发': '头发与耳朵',
  '人物/耳朵': '头发与耳朵',
  '人物/翅膀': '非人特征',
  '人物/面部': '面部细节',
  '人物/眉毛': '面部细节',
  '人物/眼睛': '面部细节',
  '人物/瞳孔': '面部细节',
  '人物/鼻子': '面部细节',
  '人物/嘴巴（纯嘴巴补充）': '面部细节',
  '人物/牙齿': '面部细节',
  '人物/舌头': '面部细节',
  '服饰/正装': '服装款式',
  '服饰/风格': '服装款式',
  '服饰/少女套装': '服装款式',
  '服饰/泳装': '贴身与泳装',
  '服饰/色气衣服': '贴身与泳装',
  '服饰/内衣': '贴身与泳装',
  '服饰/上衣': '上装与外套',
  '服饰/外套': '上装与外套',
  '服饰/手臂': '上装与外套',
  '服饰/和上衣互动': '服装状态与互动',
  '服饰/与裙子互动': '服装状态与互动',
  '服饰/与裤子互动': '服装状态与互动',
  '服饰/与袜子互动': '服装状态与互动',
  '服饰/裙子': '下装与腿部服饰',
  '服饰/裤子': '下装与腿部服饰',
  '服饰/袜子': '下装与腿部服饰',
  '服饰/鞋子': '下装与腿部服饰',
  '服饰/鞋底': '下装与腿部服饰',
  '服饰/腰部': '服装配件',
  '服饰/其他小饰品': '服装配件',
  '服饰/围巾': '服装配件',
  '服饰/眼镜': '服装配件',
  '服饰/面具': '服装配件',
  '服饰/手': '服装配件',
  '服饰/手套': '服装配件',
  '服饰/耳饰': '服装配件',
  '服饰/头饰': '头部与首饰',
  '服饰/帽子': '头部与首饰',
  '服饰/发饰': '头部与首饰',
  '服饰/小装饰': '头部与首饰',
  '服饰/首饰': '头部与首饰',
  '服饰/材质': '材质纹理与装饰',
  '服饰/装饰': '材质纹理与装饰',
  '服饰/花纹': '材质纹理与装饰',
  '服饰/领口': '材质纹理与装饰',
  '服饰/盔甲': '特殊服装',
  '服饰/其他': '特殊服装',
  '表情动作/笑': '正向表情',
  '表情动作/哭': '负向表情',
  '表情动作/不开心': '负向表情',
  '表情动作/蔑视': '负向表情',
  '表情动作/生气': '负向表情',
  '表情动作/其他表情': '复合表情',
  '表情动作/表情符号': '表情符号',
  '表情动作/姿势 & 身体位置': '基础姿态',
  '表情动作/日常 & 动态动作': '日常动作',
  '表情动作/手部姿势 & 手臂位置': '手臂与手势',
  '表情动作/手指 & 手势动作': '手臂与手势',
  '表情动作/手部动作(拿着某物)': '手部物件交互',
  '表情动作/手部动作(放在某地)': '手部接触动作',
  '表情动作/手部动作(抓着某物)': '手部接触动作',
  '表情动作/基础腿部动作（包含腿与脚）': '腿部姿态',
  '表情动作/色气腿部动作': '腿部姿态',
  '画面/画质': '画质与媒介',
  '画面/艺术风格': '艺术风格',
  '画面/艺术类型': '艺术风格',
  '画面/艺术派系': '艺术风格',
  '画面/艺术家风格': '艺术风格',
  '画面/写实': '画质与媒介',
  '画面/素描': '画质与媒介',
  '画面/画笔': '画质与媒介',
  '画面/光照': '光照',
  '画面/颜色': '颜色',
  '画面/背景': '背景效果',
  '环境/季节': '时间季节与天气',
  '环境/天气': '时间季节与天气',
  '环境/大自然': '自然环境',
  '环境/水': '自然环境',
  '环境/天空': '天空与云层',
  '环境/云': '天空与云层',
  '环境/氛围': '节日与氛围',
  '场景/室外': '室外场景',
  '场景/城市': '城市场景',
  '场景/室内场景（高度细节向）': '室内场景',
  '场景/地板': '室内陈设',
  '场景/家具': '室内陈设',
  '场景/床上用品': '室内陈设',
  '场景/浴室': '浴室场景',
  '物品/学习用品': '日常物品',
  '物品/数码设备': '日常物品',
  '物品/餐具': '日常物品',
  '物品/其它物品': '日常物品',
  '物品/乐器': '乐器',
  '物品/武器': '武器',
  '物品/食物': '食物',
  '物品/动物': '动物',
  '物品/植物': '植物',
  '镜头/镜头类型': '景别',
  '镜头/特写 & 焦点镜头': '景别与焦点',
  '镜头/其他构图': '构图角度',
  '镜头/镜头角度（视角 & 拍摄方向强化版）': '构图角度',
  '镜头/效果': '镜头效果',
  '镜头/主角视线 & 头部动作（眼神 & 注视方向）': '视线与头部方向',
};

const SECTION_SLUGS = {
  人物: 'character',
  服饰: 'clothing',
  表情动作: 'expression-pose',
  体位: 'adult-pose',
  画面: 'visual',
  环境: 'environment',
  场景: 'scene',
  物品: 'object',
  镜头: 'camera',
};

const TOPIC_SLUGS = {
  '人物关系与对象': 'subject', '人数与性别': 'count-gender', '成人身体与对象': 'adult-subject', '职业与身份': 'identity', '身体与皮肤': 'body', '头发与耳朵': 'hair', '非人特征': 'nonhuman', '面部细节': 'face',
  '服装款式': 'outfit', '贴身与泳装': 'intimate-wear', '上装与外套': 'upperwear', '服装状态与互动': 'clothing-state', '下装与腿部服饰': 'lowerwear', '服装配件': 'accessory', '头部与首饰': 'jewelry', '材质纹理与装饰': 'material', '特殊服装': 'special-wear',
  '正向表情': 'positive-expression', '负向表情': 'negative-expression', '复合表情': 'complex-expression', '表情符号': 'expression-symbol', '基础姿态': 'base-pose', '日常动作': 'daily-action', '手臂与手势': 'hand-gesture', '手部物件交互': 'holding', '手部接触动作': 'touching', '腿部姿态': 'leg-pose',
  '画质与媒介': 'quality-medium', '艺术风格': 'art-style', '光照': 'lighting', '颜色': 'color', '背景效果': 'background',
  '时间季节与天气': 'weather', '自然环境': 'nature', '天空与云层': 'sky', '节日与氛围': 'atmosphere',
  '室外场景': 'outdoor', '城市场景': 'city', '室内场景': 'indoor', '室内陈设': 'interior', '浴室场景': 'bathroom',
  '日常物品': 'daily-object', '乐器': 'instrument', '武器': 'weapon', '食物': 'food', '动物': 'animal', '植物': 'plant',
  '景别': 'shot', '景别与焦点': 'focus', '构图角度': 'angle', '镜头效果': 'camera-effect', '视线与头部方向': 'gaze',
};

const ADULT_BUCKETS = [
  ['口部互动', /fellatio|blowjob|deepthroat|gokkun|oral|mouth|tongue|口交|深喉|吃精|舔/i],
  ['肛门互动', /anal|anus|肛|ass.?fuck|butt.?plug/i],
  ['自慰与玩具', /masturbat|fingering|schlick|vibrator|dildo|toy|自慰|手淫|跳蛋|假阳具/i],
  ['胸部互动', /breast|nipple|paizuri|titjob|胸|乳|奶/i],
  ['足部互动', /footjob|feet|foot|脚交|足交|踩踏/i],
  ['束缚与控制', /bondage|bound|restrain|rope|handcuff|collar|leash|束缚|捆绑|手铐|项圈/i],
  ['体液与事后', /cum|after sex|bukkake|ejaculat|semen|aftercare|事后|射精|精液/i],
  ['排泄相关', /pee|urine|piss|toilet|小便|尿|排泄/i],
  ['插入与性交', /sex|penetrat|missionary|doggy|cowgirl|piston|阴茎|插入|性交|后入|骑乘/i],
  ['亲密接触', /kiss|hug|embrace|sleeping embraced|亲吻|拥抱|贴贴/i],
];

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeTag(value) {
  const normalized = normalizeText(value)
    .toLowerCase()
    .replace(/\s*,\s*/g, ', ')
    .replace(/(?:,\s*)+$/g, '')
    .replace(/_{2,}/g, '_');
  return TAG_CORRECTIONS.get(normalized) || normalized;
}

function normalizeLabel(tag, value) {
  return LABEL_CORRECTIONS.get(tag) || normalizeText(value);
}

function adultTopic(text) {
  for (const [name, pattern] of ADULT_BUCKETS) {
    if (pattern.test(text)) return name;
  }
  return '其他成人互动';
}

const COUNT_GENDER_PATTERN = /^(?:[1-9](?:girl|boy)s?|solo|multiple_(?:girls|boys)|girl|boy|female|male|hetero|yuri|yaoi)(?:\b|$)/i;
const ADULT_SUBJECT_PATTERN = /(?:penis|testicle|erection|foreskin|precum|futanari|pussy|vagina|clitoris|labia|anus|乳|胸|阴茎|睾丸|包茎|前列腺液|扶她)/i;

function topicFor(section, group, text) {
  if (section === '人物' && group === '对象') {
    if (COUNT_GENDER_PATTERN.test(text)) return '人数与性别';
    if (ADULT_SUBJECT_PATTERN.test(text)) return '成人身体与对象';
  }
  if (section === '体位' || group === '亲密 & 性爱互动') return adultTopic(text);
  return TOPIC_ALIASES[`${section}/${group}`] || group;
}

function slugFor(section, topic) {
  if (topic.startsWith('成人·')) {
    const baseTopic = topic.slice(3);
    return `adult-explicit-${TOPIC_SLUGS[baseTopic] || createHash('sha1').update(`${section}/${topic}`).digest('hex').slice(0, 8)}`;
  }
  const known = TOPIC_SLUGS[topic];
  if (known) return known;
  const adultIndex = ADULT_BUCKETS.findIndex(([name]) => name === topic);
  if (adultIndex >= 0) return `adult-${adultIndex + 1}`;
  if (topic === '其他成人互动') return 'adult-other';
  return createHash('sha1').update(`${section}/${topic}`).digest('hex').slice(0, 8);
}

function shouldSkipTag(section, group, tag, label) {
  const combined = `${tag} ${label}`;
  if (SKIPPED_SECTIONS.has(section) || SKIPPED_GROUPS.has(`${section}/${group}`)) return 'section';
  if (!tag || INVALID_ONLY_PATTERN.test(tag)) return 'invalid';
  if (tag.length > MAX_TAG_LENGTH || tag.split(',').length > MAX_TAG_PARTS) return 'oversized';
  if (MINOR_PATTERN.test(combined)) return 'minor';
  if (MODEL_DIRECTIVE_PATTERN.test(combined)) return 'model_directive';
  if (BLOCKED_EXACT_TAGS.has(tag.toLowerCase()) || LOW_QUALITY_POSITIVE_TAGS.has(tag.toLowerCase())) return 'low_quality';
  return null;
}

function estimateChunkContentLength(entries) {
  const sourceGroups = [...new Set(entries.map(entry => entry.group))];
  const menuLength = entries.reduce((total, entry, index) => (
    total + (entry.label || entry.tag).length + entry.tag.length + (index === 0 ? 3 : 4)
  ), 0);
  return 44 + sourceGroups.join('、').length + menuLength;
}

function splitBalanced(entries) {
  const chunks = [];
  let current = [];

  for (const entry of entries) {
    const candidate = [...current, entry];
    if (current.length > 0 && (
      candidate.length > MAX_CHUNK_SIZE
      || estimateChunkContentLength(candidate) > MAX_CHUNK_CONTENT_LENGTH
    )) {
      chunks.push(current);
      current = [entry];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) chunks.push(current);

  const tail = chunks.at(-1);
  const previous = chunks.at(-2);
  while (tail && previous && tail.length < 12 && previous.length > 12) {
    const moved = previous.at(-1);
    const candidate = [moved, ...tail];
    if (estimateChunkContentLength(candidate) > MAX_CHUNK_CONTENT_LENGTH) break;
    previous.pop();
    tail.unshift(moved);
  }

  return chunks;
}

function makeKnowledgeItem(section, category, topic, entries, chunkIndex) {
  const sourceGroups = [...new Set(entries.map(entry => entry.group))];
  const menu = entries.map(entry => `${entry.label || entry.tag} → ${entry.tag}`).join('；');
  const searchTerms = [section, topic, ...sourceGroups, ...entries.flatMap(entry => [entry.label, entry.tag])]
    .filter(Boolean)
    .join(' ')
    .slice(0, 4000);
  const sectionSlug = SECTION_SLUGS[section] || createHash('sha1').update(section).digest('hex').slice(0, 8);
  const sequence = String(chunkIndex + 1).padStart(3, '0');
  return {
    knowledgeId: `ipk.lib.${sectionSlug}.${slugFor(section, topic)}.${sequence}`,
    category,
    title: `${section} · ${topic}`,
    searchTerms,
    scenes: ALL_SCENES,
    isDefault: false,
    priority: category.startsWith('adult_') ? 42 : 55,
    executableTags: entries.map(entry => ({ tag: entry.tag, label: entry.label, group: entry.group })),
    content: `标签词汇菜单（来自 ${sourceGroups.join('、')}；按当前画面语义选择少量匹配项，不要整组堆叠）：${menu}`,
  };
}

export function buildImagePromptTagKnowledge(rawData) {
  const buckets = new Map();
  const seenTags = new Set();
  const skipped = { section: 0, invalid: 0, oversized: 0, minor: 0, model_directive: 0, low_quality: 0, duplicate: 0 };
  let sourceTags = 0;

  for (const sectionData of Array.isArray(rawData) ? rawData : []) {
    const section = normalizeText(sectionData?.name);
    const baseCategory = TOP_LEVEL_CATEGORY[section];
    for (const groupData of sectionData?.groups || []) {
      const group = normalizeText(groupData?.name);
      for (const [rawTag, rawLabel] of Object.entries(groupData?.tags || {})) {
        sourceTags += 1;
        const tag = normalizeTag(rawTag);
        const label = normalizeLabel(tag, rawLabel);
        const reason = shouldSkipTag(section, group, tag, label);
        if (!baseCategory || reason) {
          skipped[reason || 'section'] += 1;
          continue;
        }
        const dedupeKey = tag.toLowerCase();
        if (seenTags.has(dedupeKey)) {
          skipped.duplicate += 1;
          continue;
        }
        seenTags.add(dedupeKey);
        const baseTopic = topicFor(section, group, `${tag} ${label}`);
        const isAdultPose = section === '体位' || group === '亲密 & 性爱互动';
        const isExplicitAdult = containsExplicitAdultContent(`${tag} ${label}`);
        const topic = !isAdultPose && isExplicitAdult && !baseTopic.startsWith('成人')
          ? `成人·${baseTopic}`
          : baseTopic;
        const category = isAdultPose
          ? 'adult_pose_vocabulary'
          : section === '人物' && baseTopic === '成人身体与对象'
            ? 'adult_anatomy_vocabulary'
            : isExplicitAdult
              ? `adult_${baseCategory}`
              : baseCategory;
        const bucketKey = `${section}\u0000${category}\u0000${topic}`;
        if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
        buckets.get(bucketKey).push({ tag, label, group });
      }
    }
  }

  const knowledge = [];
  for (const [bucketKey, entries] of buckets) {
    const [section, category, topic] = bucketKey.split('\u0000');
    splitBalanced(entries).forEach((chunk, chunkIndex) => {
      knowledge.push(makeKnowledgeItem(section, category, topic, chunk, chunkIndex));
    });
  }

  return {
    knowledge,
    stats: {
      sourceTags,
      retainedTags: seenTags.size,
      knowledgeItems: knowledge.length,
      skipped,
    },
  };
}

const sourceBuffer = fs.readFileSync(SOURCE_PATH);
const parsedSource = yamlLoad(sourceBuffer.toString('utf8'));
const built = buildImagePromptTagKnowledge(parsedSource);

export const IMAGE_PROMPT_TAG_KNOWLEDGE = built.knowledge;
export const IMAGE_PROMPT_TAG_KNOWLEDGE_STATS = built.stats;
export const IMAGE_PROMPT_TAG_SOURCE_SHA256 = createHash('sha256').update(sourceBuffer).digest('hex');
