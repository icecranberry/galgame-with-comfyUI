/**
 * 体位生图参考 —— 结构化数据（**自动生成，勿手改**）
 *
 * 来源：`Z:/docker/.../50-创意库/0-投递箱/邻舍 提示词/体位生图参考.md`（84 条体位的生图描写）。
 * 该文件在 NAS 只进不改库中，**只读**；需要更新时改源文件后重跑
 * `node tools/parse-sex-positions.mjs` 全量重生成本文件。
 *
 * 每条字段：
 *   no/name   编号与中文名（tags 里的中文检索词就用 name）
 *   limit     出镜条件（源文件标题里前置的「（小马限定）/（小车限定）」，已从 name 剥出；空串 = 无限制）
 *   limitOn   该条件落在谁身上：'male'（男方须娇小）/ 'female'（女方须娇小）/ ''（无）
 *   limitTags limitOn 对应的英文提示词标签（进 prompt 作正向约束；无限制时为 []）
 *   frozen    中文「定格」描述（讲清这一格画面定在哪一瞬）
 *   core      核心英文 NSFW 标签（检索用）
 *   male/female  男/女方的英文标签
 *   frame     画幅（原始文本，可能是「A 或 B」）
 *   frames    画幅候选数组（并列项已拆开，出图时随机取一个）
 *   negative  负向标签（该体位专属，用于压制常见畸形）
 *   prompt    英文提示词模板：`[a / b / c]` 是变体组，出图时**每组随机取一个**
 *   conflicts 中文「不可组合」说明（人工参考，不进提示词）
 *   girls/boys/solo  参与者数量（由标签推导，用于挑角色）
 *
 * 生成时间：2026-10-05（共 84 条）
 */

export const SEX_POSITIONS = [
  {
    "no": "002",
    "name": "叠罗汉后入",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方 1 跪趴或趴下、双腿张开；女方 2 趴在她身上、臀部与女方 1 垂直对齐；男方跪或站在二人身后，交替插入两人。",
    "core": [
      "2girls",
      "on all fours",
      "ass",
      "stacked"
    ],
    "male": [
      "1boy",
      "kneeling / standing",
      "penis"
    ],
    "female": [
      "1girl",
      "on all fours / 1girl",
      "lying on person",
      "on stomach"
    ],
    "frame": "cowboy shot",
    "negative": "solo, extra limbs, extra girls, male face",
    "prompt": "the girl 1 is lying on her back with her legs spread; the girl 2 is lying face-down on top of her, their hips vertically aligned; the boy is kneeling behind the two stacked girls, penetrating them alternately, [his hand on the upper girl's ass / on her breasts].",
    "conflicts": "",
    "girls": 2,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "003",
    "name": "双女相贴交",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方 1 仰躺开腿、小穴暴露；女方 2 趴在她身上、两小穴相贴并可扭头看男方；男方位于二人身后。",
    "core": [
      "2girls",
      "tribadism",
      "grinding（原文）"
    ],
    "male": [
      "1boy",
      "standing / kneeling",
      "penis"
    ],
    "female": [
      "1girl",
      "lying",
      "on back / 1girl",
      "lying on person",
      "on stomach"
    ],
    "frame": "cowboy shot",
    "negative": "solo, male face, extra limbs",
    "prompt": "the girl 1 is lying on her back with her legs spread, her pussy exposed; the girl 2 is lying face-down on top of her with her pussy pressed against the girl 1's, her head turned toward the boy; the boy is behind the two of them, thrusting against the point where their pussies meet.",
    "conflicts": "",
    "girls": 2,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "004",
    "name": "双人乳交",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "男方躺或坐、露出阴茎；两位女方分坐他两侧、以乳房相贴把阴茎夹在中间。",
    "core": [
      "2girls",
      "paizuri",
      "breast（原文）"
    ],
    "male": [
      "1boy",
      "lying / sitting",
      "penis"
    ],
    "female": [
      "1girl",
      "sitting / lying",
      "breast"
    ],
    "frame": "upper body 或 close-up",
    "negative": "solo, male face, flat chest, extra limbs",
    "prompt": "the boy is [lying on his back / sitting], his penis held between the pressed-together breasts of the two girls who sit on either side of him, their breasts touching each other; [the two girls are kissing and licking each other / one girl focuses on the paizuri while the other licks his glans], and [his hands are in their hair / on both their clits / fingering both of them].",
    "conflicts": "",
    "girls": 2,
    "boys": 1,
    "solo": false,
    "frames": [
      "upper body",
      "close-up"
    ]
  },
  {
    "no": "005",
    "name": "双人足交",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "男方躺或坐；两位女方分坐他左右，各翘起内侧一只脚、足底相贴，以两足弓间的缝隙夹住阴茎。**每名女方只用一只脚**，另一只脚自然下垂。",
    "core": [
      "2girls",
      "footjob",
      "feet",
      "foot focus"
    ],
    "male": [
      "1boy",
      "lying / sitting",
      "penis"
    ],
    "female": [
      "1girl",
      "sitting",
      "foot up / 1girl",
      "sitting",
      "foot up"
    ],
    "frame": "cowboy shot 或 close-up",
    "negative": "solo, extra feet, extra legs, male face（不要写双脚同时施力，违反原书 note）",
    "prompt": "the boy is [lying on his back / sitting] with the two girls seated on his left and right; each girl lifts one foot and presses her sole against the other girl's sole, the boy's penis caught in the gap between their two arches, while their other feet hang down untouched; [the girls finger themselves as they work / one presses hard with her arch while the other teases precisely with her toes], and [his arms are around their waists / his hands are on both their clits / on both their breasts].",
    "conflicts": "",
    "girls": 2,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot",
      "close-up"
    ]
  },
  {
    "no": "006",
    "name": "骑乘位",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "男方仰躺、露出阴茎；女方面向他跪坐或蹲在他上方，阴茎插入阴道。",
    "core": [
      "girl on top",
      "straddling",
      "vaginal"
    ],
    "male": [
      "1boy",
      "lying",
      "on back",
      "penis"
    ],
    "female": [
      "1girl",
      "sitting on person",
      "facing forward"
    ],
    "frame": "cowboy shot 或 upper body",
    "negative": "male face, muscular male, extra male, multiple views",
    "prompt": "the boy is lying on his back with his penis exposed; the girl is on top of him, facing him, [squatting over his hips / kneeling over his hips / kneeling on the bed edge beside his hips], his penis inside her vagina, [with her back arched, her chest lifted], while [his hands grip her ass / her breasts / clasp her hands / rub her clit].",
    "conflicts": "",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot",
      "upper body"
    ]
  },
  {
    "no": "007",
    "name": "正体贴合式",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方仰卧；男方放弃手臂支撑、胸腹完全贴在她身上，耻骨（阴茎根部）抵住阴户，重心前移。",
    "core": [
      "missionary",
      "lying",
      "on back",
      "hugging",
      "vaginal"
    ],
    "male": [
      "1boy",
      "on top",
      "penis"
    ],
    "female": [
      "1girl",
      "lying",
      "on back"
    ],
    "frame": "upper body 或 close-up",
    "negative": "male face, muscular male, extra space between bodies, standing",
    "prompt": "the girl is lying on her back; the boy is on top of her with his chest and belly pressed flat against hers and his pubic bone pressed against her pussy, [his whole weight on her / propped on his elbows so a gap opens between their upper bodies]; [his arms are wrapped around her back / he holds her face and kisses her / he pins her hands to the pillow], [her legs wrapped around his waist / lying flat / wrapped around his waist] , [her toes curling / her nails leaving marks on his back].",
    "conflicts": "男方手部三项 与「用手肘撑起」互斥（撑手肘意味着手不在她身上）",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "upper body",
      "close-up"
    ]
  },
  {
    "no": "008",
    "name": "单腿站立位",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方单腿站立、一只手扶物维持平衡；男方站在她身后、一手控制她的身体，从后方插入，另一手托住或架起她抬起的那条腿。",
    "core": [
      "standing",
      "leg up",
      "spread legs",
      "arm support（原文组合）"
    ],
    "male": [
      "1boy",
      "standing",
      "penis"
    ],
    "female": [
      "1girl",
      "standing",
      "arm support",
      "leaning against wall"
    ],
    "frame": "cowboy shot",
    "negative": "sitting, lying, legs together, extra legs, male face",
    "prompt": "the boy is standing behind the girl, one hand steadying her, penetrating her from behind while he holds up one of her legs — [kneeling-low and holding her knee with her leg slightly bent / lifting her thigh onto his shoulder and pressing her upper body to the wall / raising her leg straight up into a standing split]; while [his other hand is on her breast / on her head / on her waist], [her supporting foot on tiptoe / flat on the ground], [her other hand braced against the wall / leaning against a post / gripping a table edge], [her head turned to kiss him / her hand between her legs / reaching back to grip his hair].",
    "conflicts": "原书把抬腿高度在 `basics` 与 `options` 各写一遍、两处独立随机必然打架，须合并取一；「搔脚心」与高位架肩／一字马不相容（脚不在他手边）",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "009",
    "name": "正常位",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方平躺仰卧、双腿自然分开或膝盖微弯；男方跪在她两腿之间、上身微微挺直（不完全压在她身上），从正面插入。",
    "core": [
      "missionary",
      "vaginal"
    ],
    "male": [
      "1boy",
      "kneeling",
      "on top",
      "penis"
    ],
    "female": [
      "1girl",
      "lying",
      "on back",
      "legs apart",
      "knees bent（legs apart ＝微分开，spread legs ＝张开，按需替换）"
    ],
    "frame": "cowboy shot",
    "negative": "male face, muscular male, on top, weight down（本位定义是上身挺直不压）",
    "prompt": "the girl is lying on her back with her legs apart and her knees slightly bent; the boy is kneeling between her legs with his upper body held upright rather than lowered onto her, penetrating her from the front, [his hands on both her breasts / one hand on her breast and the other rubbing her clit / rolling her nipples between thumb and finger / gripping her waist], [looking down at her breasts / at her curled toes / straight at her naked body], [her toes curling / her body trembling].",
    "conflicts": "「大拇指研磨阴蒂」与「双手揉乳」「夹乳头」「双手握腰」三项互斥；「女方腰部扭动」与「双手握腰控制节奏」互斥",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "010",
    "name": "火车便当",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "男方站立、双手托住女方臀瓣或大腿根部、承担她全部体重；女方像无尾熊一样挂在他身上，双腿盘腰、双臂固定身体，阴茎向上插入。",
    "core": [
      "suspended congress",
      "standing",
      "carrying",
      "vaginal"
    ],
    "male": [
      "1boy",
      "standing",
      "holding up",
      "penis"
    ],
    "female": [
      "1girl",
      "suspended",
      "legs around waist",
      "feet off ground"
    ],
    "frame": "cowboy shot 或 full body",
    "negative": "standing on ground, feet on ground, from above, male face",
    "prompt": "the boy is standing, supporting the girl's whole weight with [his hands under her ass / her thighs], his penis pushed up into her; the girl is hanging on him koala-style with her legs locked around his waist and her arms [around his neck / in his hair / gripping his shoulders], her feet off the ground, [in place / with her back braced against a wall].",
    "conflicts": "「抵墙借力」与「抱着她四处走动」互斥（原书两项同池）",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot",
      "full body"
    ]
  },
  {
    "no": "011",
    "name": "种付位",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方仰卧、两腿被向上向后掰过头顶、身体对折成 V 字形，臀瓣向上向外撅起、臀肉向两侧摊开；男方以深蹲姿势在她上方、全身重量下压，从上方压入。",
    "core": [
      "mating press",
      "folded",
      "legs over head",
      "on back",
      "spread legs（原文组合）＋ squatting",
      "weight down"
    ],
    "male": [
      "1boy",
      "squatting",
      "on top",
      "penis"
    ],
    "female": [
      "1girl",
      "lying",
      "on back",
      "ass up"
    ],
    "frame": "cowboy shot 或 full body",
    "negative": "legs apart, legs straight, extra legs, male face",
    "prompt": "the girl is lying on her back, both legs folded up and back over her head so her body is bent into a V, her ass raised high and spread outward, [her ankles pressed against her own ears with her soles up / her ankles crossed behind his neck]; the boy is squatting above her with his whole weight bearing down, penetrating her from above, [holding her legs with his arm / his knee pressed into her shoulder / her wrists pinned above her head / kneading both her breasts].",
    "conflicts": "",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot",
      "full body"
    ]
  },
  {
    "no": "013",
    "name": "口交",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方跪着、坐着或以其他姿势把阴茎含入口中；男方站立、坐着或躺下、露出阴茎。",
    "core": [
      "fellatio"
    ],
    "male": [
      "1boy",
      "standing / sitting / lying",
      "penis"
    ],
    "female": [
      "1girl",
      "kneeling",
      "sucking penis",
      "(penis in mouth:1.5)",
      "one hand on the base"
    ],
    "frame": "close-up 或 upper body（至少两版用更近的）",
    "negative": "male face, muscular male, extra hands, legs, thighs, full body, sitting（后五项用于上半身画幅）",
    "prompt": "the boy is [standing / sitting / lying] with his penis exposed; the girl is [kneeling / sitting] in front of him, [licking along his shaft with her tongue out / sucking on his glans with her lips sealed around it and her tongue working the tip / taking his whole penis into her mouth], [one hand wrapped around the base / both hands cupping and massaging his balls / her hands off him], [his hand on the back of her head / his foot between her legs].",
    "conflicts": "三种含入程度互斥（原书写成先后两步，出图只能定格其一）；女方手部三项互斥",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "close-up",
      "upper body"
    ]
  },
  {
    "no": "014",
    "name": "对面坐位",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "男方坐着（双腿伸直或盘起）；女方坐在他腿上、面向他、双腿环绕他的腰，阴茎插入阴道。",
    "core": [
      "girl on top",
      "straddling",
      "sitting",
      "vaginal"
    ],
    "male": [
      "1boy",
      "sitting",
      "penis"
    ],
    "female": [
      "1girl",
      "sitting on lap",
      "legs around waist"
    ],
    "frame": "cowboy shot",
    "negative": "standing, lying, extra limbs, male face",
    "prompt": "the boy is sitting with [his legs stretched out / his legs crossed], his penis inside her vagina; the girl is sitting on his lap facing him with her legs wrapped around his waist, [her arms around his neck / her head tipped back and her hands braced on his knees / her feet flat on the ground / leaning forward with her breasts pressed to his chest / gripping his shoulders], while [he kisses her / his thumb works her clit / his hand at her throat / his hand pulling her hair back / his hands guiding her hips], [her hands cupping his balls].",
    "conflicts": "「双手按摩睾丸」与「双臂环脖」「前倾压胸」「双手撑膝」互斥；「接吻」与女方「头向后仰」互斥",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "015",
    "name": "六九式",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "男方仰卧；女方反向趴在他身上，头靠近他阴茎、小穴靠近他的头，双方互相口交。",
    "core": [
      "sixty-nine",
      "fellatio",
      "cunnilingus"
    ],
    "male": [
      "1boy",
      "lying",
      "on back",
      "penis",
      "licking"
    ],
    "female": [
      "1girl",
      "on top",
      "reversed",
      "head down",
      "(penis in mouth:1.4)"
    ],
    "frame": "cowboy shot",
    "negative": "male face, extra limbs, standing, solo",
    "prompt": "the boy is lying on his back [licking her clit / licking her pussy lips / pushing his tongue inside her]; the girl is lying face-down on top of him head-to-toe, her pussy over his mouth and his penis in her mouth, [her tongue teasing his tip / her lips sealed around his tip / her hands on his balls / taking him deep], [her fingers in his hair].",
    "conflicts": "",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "016",
    "name": "后入卧位",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方俯卧在平台上、双腿并拢或略分开；男方跪坐在她身后、从后方插入。",
    "core": [
      "lying",
      "on stomach",
      "prone bone",
      "sex"
    ],
    "male": [
      "1boy",
      "kneeling",
      "on top",
      "penis"
    ],
    "female": [
      "1girl",
      "lying",
      "on stomach",
      "knees together"
    ],
    "frame": "cowboy shot",
    "negative": "kneeling, ass up, all fours, male face（跪姿会退化成后入跪位）",
    "prompt": "the girl is lying face-down on the bed with her legs [pressed together and clenched / slightly apart]; the boy is kneeling astride her from behind, penetrating her, [his hands planted on the bed on either side of her / his body lowered onto her back / his hands kneading both her breasts], [her head turned to the side / her face buried in the pillow / her chin propped on her hands].",
    "conflicts": "男方「身体压在她身上」与「手放在她身体两侧支撑」互斥（压上就用不到手撑）",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "017",
    "name": "后入跪位",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方膝盖跪在床上、臀部高高翘起、上半身靠手掌、前臂或肩膀支撑；男方跪在她身后、双腿位于她双腿外侧，从后方插入。",
    "core": [
      "doggystyle",
      "all fours",
      "ass up",
      "sex"
    ],
    "male": [
      "1boy",
      "kneeling",
      "penis"
    ],
    "female": [
      "1girl",
      "kneeling",
      "ass up"
    ],
    "frame": "cowboy shot",
    "negative": "extra hands, extra arms, lying, on back, male face（三只手是这一格最常见的畸形）",
    "prompt": "the girl is on her knees with her ass raised high, [her palms flat on the bed holding her upper body up / her forearms down with her head lowered and her ass raised higher / her shoulder down against the bed with one free hand rubbing her clit]; the boy is kneeling behind her with his legs outside hers, penetrating her from behind, [his hands pulling hers back behind her / his hand at her throat / his hands on her breasts], [her head turned to one side / her face in the pillow], [her free hand propping her chin / spreading her own ass apart].",
    "conflicts": "「手掌平放」「前臂支撑」两组双手全占，不能再「撑下巴」或「掰臀瓣」；只有「肩膀支撑」组还剩一只手（可撑下巴，不可掰臀瓣）",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "018",
    "name": "素股",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方仰卧／侧卧／站立／站立向前弯腰（任取一种），双腿紧紧并拢，用阴唇与大腿的缝隙为阴茎造出通道；男方在她身后，阴茎只在小穴外部磨蹭、不进入小穴或肛门。",
    "core": [
      "intercrural sex",
      "(sumata:1.5)",
      "(thigh_sex:1.5)",
      "(knees together:1.5)",
      "legs together"
    ],
    "male": [
      "1boy",
      "clothed female nude male",
      "(faceless male:2.0)",
      "bald",
      "penis",
      "thighs"
    ],
    "female": [
      "1girl",
      "knees together"
    ],
    "frame": "cowboy shot",
    "negative": "vaginal, spread legs, legs apart, sex, extra male, male face",
    "prompt": "the girl is [lying on her back / lying on her side / standing / standing and leaning forward], her legs pressed tightly together so that her pussy lips and thighs form a channel; the boy is behind her, his erect penis rubbing only against the outside of her pussy without entering her vagina or anus, [his shaft sliding against her pussy and clit / his hand on her breast or clit], [her hand guiding his penis / her ankles crossed to tighten the channel].",
    "conflicts": "",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "019",
    "name": "反向莲花式",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "男方仰卧、双腿自然张开；女方面向他跨坐，但双腿不缠绕腰部而是把膝盖高高竖起，双脚踩在床面或男方身体上。",
    "core": [
      "girl on top",
      "straddling",
      "vaginal"
    ],
    "male": [
      "1boy",
      "lying",
      "on back",
      "legs apart",
      "penis"
    ],
    "female": [
      "1girl",
      "sitting on person",
      "knees up"
    ],
    "frame": "cowboy shot",
    "negative": "legs around waist, legs together, male face, extra legs",
    "prompt": "the boy is lying on his back with his legs apart; the girl is straddling him facing him, not wrapping her legs around his waist but drawing her knees up high with [her feet planted on the bed in an M shape / her feet resting on his shoulders with her thighs against her chest / her feet pressed on his chest], [his hands on her ankles / behind his head / on her waist], [his tongue reaching up to her ankle / her looking down at him with a confident smile].",
    "conflicts": "男方「伸舌舔舐肩上的脚踝」与「脚踩床面」「脚踩胸肌」互斥（脚不在肩上）",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "020",
    "name": "扒挂式",
    "limit": "小马限定",
    "limitOn": "male",
    "limitTags": [
      "petite male",
      "male clearly shorter than the girl",
      "small male body frame"
    ],
    "frozen": "女方双脚站稳、用手托住男方臀部或大腿、支撑他全部重量；男方双臂环她背或抓她双乳，双腿环绕她腰或臀，整个身体挂在她身上、阴茎向上插入。",
    "core": [
      "upright straddle",
      "standing",
      "carrying",
      "vaginal"
    ],
    "male": [
      "1boy",
      "hanging on",
      "legs around waist",
      "penis"
    ],
    "female": [
      "1girl",
      "standing",
      "holding up",
      "arms under thighs"
    ],
    "frame": "cowboy shot 或 full body",
    "negative": "feet on ground, muscular male, male face（需男方明显娇小，不要写出壮硕男体）",
    "prompt": "the girl is standing firmly, holding up the boy's whole weight with her hands under his ass and thighs; the boy is hanging entirely off her body with his legs around her waist and [his arms around her back / his hands on her breasts / one arm around her back while the other rubs her clit], his penis pushed up into her, [her breasts squeezed together around his face / his back pressed against a wall / her arms lifting and lowering him].",
    "conflicts": "「用双臂抬起放下男方」与「用手托住男方臀腿」是同一双手，互斥",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot",
      "full body"
    ]
  },
  {
    "no": "021",
    "name": "高台站立式",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方躺或坐在高台上、腹股沟与男方臀部同高；男方站在台前，双手握她脚踝或把小腿向两侧拉开，从正面插入。",
    "core": [
      "standing",
      "sex",
      "on table / on bed"
    ],
    "male": [
      "1boy",
      "standing",
      "penis"
    ],
    "female": [
      "1girl",
      "leaning back",
      "on table"
    ],
    "frame": "cowboy shot",
    "negative": "from above, lying, on back（她不是躺平，是坐在/倚在台沿）",
    "prompt": "the girl is [lying / sitting] on the edge of a raised surface with her groin level with the boy's hips; the boy is standing in front of the surface penetrating her, [his hands on her ankles / spreading her calves apart into a split / leaning down to kiss her while kneading her breasts], [her legs wrapped around his waist / her legs stretched out to both sides in a full split on the surface / her hands on his ass guiding the rhythm].",
    "conflicts": "男方「握小腿向两侧拉开形成劈叉」与女方「双腿环绕男方腰部」互斥",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "022",
    "name": "垂直打桩式",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方仰卧、臀腰被拉离床面、仅上背与头支撑体重、双腿朝上；男方深蹲或站立在她胯部上方，握住她脚踝／大腿根部／腰把下半身提起，垂直方向插入。",
    "core": [
      "mating press",
      "suspended",
      "inverted",
      "sex",
      "on back"
    ],
    "male": [
      "1boy",
      "squatting / standing",
      "holding legs up",
      "penis"
    ],
    "female": [
      "1girl",
      "lying",
      "on back",
      "lower body lifted",
      "legs straight up"
    ],
    "frame": "cowboy shot",
    "negative": "lying, on bed, ass down, legs apart（臀腰未离床会退化成普通正面位）",
    "prompt": "the girl is lying on her back with her hips and waist pulled up off the bed so only her upper back and head bear her weight, her legs [pointing straight up / resting on his shoulders / cradled in his arms], her body tipped toward upside down; the boy is [squatting / standing] above her hips, gripping [her ankles / her thighs / her waist] to lift her lower body and driving into her from above, [her ankles pulled wide apart / his hand at her throat / her hands clutching the sheets].",
    "conflicts": "「双手抓脚踝向两边拉开」与「单手掐脖」互斥（前者已用掉两只手）",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "023",
    "name": "老汉推车",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方背对男方、上半身在腰部向前弯曲、双手平放在地面上支撑、双脚与地面组成钝角三角形；男方站在她身后、握住她的臀部（可轻拍）或腰，从后方插入。",
    "core": [
      "wheelbarrow",
      "standing",
      "sex",
      "hands on ground",
      "bent over"
    ],
    "male": [
      "1boy",
      "standing",
      "penis"
    ],
    "female": [
      "1girl",
      "bent over",
      "hands on ground",
      "ass up",
      "legs straight"
    ],
    "frame": "full body 或 cowboy shot",
    "negative": "kneeling, lying, all fours（双手离地主体动作失效）",
    "prompt": "the girl is facing away from the boy, bent forward at the waist with both palms flat on the floor and her feet forming an obtuse triangle with the ground; the boy is standing behind her penetrating her from behind, his hands on [her ass, one palm raised to slap it / her waist].",
    "conflicts": "",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "full body",
      "cowboy shot"
    ]
  },
  {
    "no": "024",
    "name": "柱身舔舐",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方像品尝冰淇淋一样从根部到顶部、再从顶部到根部仔细舔舐整根柱身；男方享受被膜拜与清理。",
    "core": [
      "licking penis",
      "tongue out",
      "saliva"
    ],
    "male": [
      "1boy",
      "standing / sitting",
      "penis"
    ],
    "female": [
      "1girl",
      "kneeling",
      "licking"
    ],
    "frame": "close-up",
    "negative": "penis in mouth, deepthroat, male face（本条是舔柱身，不是含入）",
    "prompt": "the boy is [standing / sitting] while the girl kneels before him, licking all the way along his shaft from base to tip [with a long flat tongue / in circles around it / with her mouth wrapped around the shaft and her head bobbing but his glans never entering], [both hands stroking the base / her hand pressing his balls down / one hand on his balls while the other steadies him], [saliva covering him / licking up over his groin].",
    "conflicts": "手部三项互斥（手数）",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "close-up"
    ]
  },
  {
    "no": "025",
    "name": "骑乘乳交",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方仰卧、用双手把乳房从两侧向内推或从顶部向下压，包住男方阴茎；男方跪坐在她胸前、膝盖放在她肋骨两侧，阴茎置于她双乳之间抽插。",
    "core": [
      "paizuri",
      "breast",
      "penis between breasts",
      "girl on bottom"
    ],
    "male": [
      "1boy",
      "kneeling",
      "penis"
    ],
    "female": [
      "1girl",
      "lying",
      "on back",
      "breast hold"
    ],
    "frame": "close-up 或 upper body",
    "negative": "flat chest, male face, one hand on the base（后者是口交手势，用在乳交会画错手）",
    "prompt": "the girl is lying on her back with his penis held between her breasts as she presses them together [from both sides / pressing down from above]; the boy is kneeling astride her chest with his knees on either side of her ribs, thrusting between her breasts, [his hands braced against the headboard or wall / his hand between her legs], [her tongue reaching down to his glans].",
    "conflicts": "男方「扶床头或墙」与「刺激女方下半身」互斥（都要用双手）",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "close-up",
      "upper body"
    ]
  },
  {
    "no": "026",
    "name": "反向贴合式",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "男方平躺仰卧；女方全身放松趴在他身上、胸对胸腹对腹，以膝盖为支点把耻骨紧紧压在他根部。",
    "core": [
      "girl on top",
      "lying on person",
      "hugging",
      "vaginal"
    ],
    "male": [
      "1boy",
      "lying",
      "on back",
      "penis"
    ],
    "female": [
      "1girl",
      "lying on person",
      "on stomach"
    ],
    "frame": "upper body 或 close-up",
    "negative": "sitting on person, standing, space between bodies",
    "prompt": "the boy is lying flat on his back bearing the girl's full weight; the girl is draped over him in total relaxation, chest to chest and belly to belly, [straddling him / with one leg straight and the other bent, lying on her side / gripping one of his thighs between her own], her pubic bone pressed hard against the base of his penis, [his arms around her back / behind his head / on her ass / slipped between their bodies to her clit], [his hand gliding over her back / her long hair falling across his face / her breast flattened against his chest].",
    "conflicts": "男方手部四项互斥（手数）",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "upper body",
      "close-up"
    ]
  },
  {
    "no": "027",
    "name": "双重骑乘",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "男方平躺仰卧，嘴接触女方 1 的小穴、阴茎插入女方 2，双手抓住女方 1 的臀部／双乳／腰部／双手；女方 1 跨坐在他脸上、女方 2 跨坐在他胯部，两人面向对方互动。",
    "core": [
      "2girls",
      "threesome",
      "ffm threesome",
      "facesitting",
      "vaginal（facesitting 见原文组合）"
    ],
    "male": [
      "1boy",
      "lying",
      "on back",
      "penis"
    ],
    "female": [
      "1girl",
      "sitting on face / 1girl",
      "straddling"
    ],
    "frame": "cowboy shot",
    "negative": "solo, extra limbs, male face",
    "prompt": "the boy is lying on his back, his mouth on the girl 1's pussy and his penis inside the girl 2, his hands on the girl 1's [ass / breasts / waist / hands]; the girl 1 is sitting on his face with her back to the girl 2, [leaning forward to kiss the girl 2 and knead her breasts / grinding her hips on his mouth], while the girl 2 straddles his hips facing him, [riding him / grinding her hips in circles].",
    "conflicts": "—（原书另注明：男方不得要求任一方暂时起身，两人同等重要）",
    "girls": 2,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "028",
    "name": "交叉侧入式",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方侧躺在这块高台平面上、下方那条腿沿平面伸直或站到地面上、上方那条腿高高抬起、脚背伸直；男方面向她的侧面，双腿与她的腿交织，从侧方插入。",
    "core": [
      "lying",
      "on side",
      "leg up",
      "sex",
      "from side"
    ],
    "male": [
      "1boy",
      "kneeling / standing",
      "penis"
    ],
    "female": [
      "1girl",
      "lying",
      "on side",
      "leg up"
    ],
    "frame": "cowboy shot",
    "negative": "knees together, legs together, sumata（双腿并拢会退化成素股读法）",
    "prompt": "the girl is lying on her side on a raised surface with her upper leg raised high and her instep extended; the boy is facing her flank with his legs interlaced with hers, penetrating her from the side and holding her raised leg, [their two horizontal positions paired so that they share the same level], [kissing the sole of her foot / licking her toes / her foot resting on his shoulder / his hand on her thigh / his other hand on her clit].",
    "conflicts": "「举向空中」与「把脚搭在肩上」互斥；「亲吻足底／舔脚趾」与「举向空中」不相容",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "029",
    "name": "前后夹击（男方本番）",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方 1 四肢着地居中间位、抬头撅臀；女方 2 在她前方、佩戴双头假阳具（一端入自己阴道、一端入女方 1 嘴中）；男方跪在女方 1 身后，用阴茎插入她的阴道。",
    "core": [
      "2girls",
      "threesome",
      "ffm threesome",
      "double dildo",
      "all fours"
    ],
    "male": [
      "1boy",
      "kneeling",
      "penis"
    ],
    "female": [
      "1girl",
      "all fours / 1girl",
      "standing"
    ],
    "frame": "cowboy shot",
    "negative": "solo, extra limbs, male face",
    "prompt": "the girl 1 is on all fours in the middle with her head up and her ass raised; the girl 2 stands in front of her wearing a double dildo, one end inside her own vagina and the other end in the girl 1's mouth; the boy is kneeling behind the girl 1 penetrating her vagina, [his hands reaching over her to knead the girl 2's breasts / pulling the girl 2's hands for a deeper thrust].",
    "conflicts": "",
    "girls": 2,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "030",
    "name": "前后夹击（男方口交）",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方 1 四肢着地居中间位、抬头撅臀；女方 2 在她后方、佩戴双头假阳具（一端入自己阴道、一端入女方 1 阴道或肛门）；男方跪在女方 1 身前，用阴茎插入她的嘴、用手扶住她的头作为固定。",
    "core": [
      "2girls",
      "threesome",
      "ffm threesome",
      "double dildo",
      "fellatio"
    ],
    "male": [
      "1boy",
      "kneeling",
      "holding head",
      "penis"
    ],
    "female": [
      "1girl",
      "all fours / 1girl",
      "standing"
    ],
    "frame": "cowboy shot",
    "negative": "solo, extra limbs, male face",
    "prompt": "the girl 1 is on all fours in the middle with her head up and her ass raised; the girl 2 stands behind her wearing a double dildo, one end inside her own vagina and the other end in the girl 1's [vagina / anus]; the boy is kneeling in front of the girl 1 with his penis in her mouth and his hand on the back of her head.",
    "conflicts": "",
    "girls": 2,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "031",
    "name": "叠女后入",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方 1 平躺仰卧、双脚微微分开；女方 2 面对面躺在她身上、身体紧密相贴；男方位于堆叠的两人身后，用阴茎插入其中一人的肛门，另拿一个双头龙两头分别插入两人的阴道。",
    "core": [
      "2girls",
      "threesome",
      "ffm threesome",
      "double dildo",
      "anal",
      "stacked",
      "from behind"
    ],
    "male": [
      "1boy",
      "kneeling",
      "penis"
    ],
    "female": [
      "1girl",
      "lying",
      "on back / 1girl",
      "lying on person",
      "on stomach"
    ],
    "frame": "cowboy shot",
    "negative": "solo, extra limbs, male face",
    "prompt": "the girl 1 is lying on her back with her feet slightly apart; the girl 2 is lying face-to-face on top of her with their bodies pressed tight; the boy is behind the stacked pair, penetrating [the girl 1 / the girl 2] anally while a double dildo runs from one girl's vagina into the other's, [their legs crossed / their hips grinding], [their hands on each other's breasts / kissing each other].",
    "conflicts": "女方互动两项互斥（都要用手与嘴）",
    "girls": 2,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "032",
    "name": "摇篮式",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "男方坐或站、双手水平抱着女方（一手支撑她的背部或肩膀、一手托住她弯曲的膝盖）；女方完全被抱着、双腿弯曲并拢、向一侧倾斜，被动地接受插入。",
    "core": [
      "cradle",
      "carrying",
      "holding up",
      "sex"
    ],
    "male": [
      "1boy",
      "sitting / standing",
      "carrying",
      "penis"
    ],
    "female": [
      "1girl",
      "carried",
      "legs bent",
      "leaning to side"
    ],
    "frame": "cowboy shot",
    "negative": "feet on ground, standing, walking（女方双脚着地就不是摇篮式）",
    "prompt": "the boy is [sitting / standing] with both arms holding the girl horizontally, one hand under her back or shoulder and the other under her bent knees; the girl is completely carried, her legs bent and together and tilted to one side, taking him passively, [lowering his head to kiss her neck], [her arms hanging loose / around his neck], [her head against his chest / tipped back].",
    "conflicts": "",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "033",
    "name": "三明治式",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "男方位在两名女方之间（仰卧或侧卧），插入女方 1 的阴道或肛门；女方 1 面向他躺在他身前，女方 2 躺在他身后（最底层）、用胸部磨蹭他的背并用手爱抚。",
    "core": [
      "2girls",
      "threesome",
      "mmf threesome",
      "sandwich",
      "lying"
    ],
    "male": [
      "1boy",
      "lying",
      "on back / on side",
      "penis"
    ],
    "female": [
      "1girl",
      "lying",
      "facing viewer / 1girl",
      "lying behind"
    ],
    "frame": "cowboy shot",
    "negative": "solo, extra limbs, male face",
    "prompt": "the boy is lying [on his back / on his side] between the two girls, penetrating the girl 1's [vagina / anus]; the girl 1 lies facing him in front of him, [guiding him in / lying passive]; the girl 2 lies behind him as the bottom layer, her breasts against his back, one hand on his [back / balls / ass / on the girl 1's breasts].",
    "conflicts": "",
    "girls": 2,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "034",
    "name": "侧躺后入位",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方背对男方侧躺、双腿自然弯曲并拢或上方大腿被抬起架在他腰上；男方侧躺在她身后、身体紧贴她的背，从后方水平插入。",
    "core": [
      "spooning",
      "lying",
      "on side",
      "sex"
    ],
    "male": [
      "1boy",
      "lying",
      "on side",
      "penis"
    ],
    "female": [
      "1girl",
      "lying",
      "on side",
      "back to viewer",
      "legs bent"
    ],
    "frame": "cowboy shot",
    "negative": "face to face, lying, on back, standing（面对背变成面对面会退化成面对面侧卧）",
    "prompt": "the girl is lying on her side with her back to the boy, her legs [bent and together / upper leg lifted onto his hip / gripping one of his legs between them]; the boy is lying on his side behind her with his body against her back, penetrating her horizontally from behind, [one hand under his head and the other around her waist / his hand on her upper thigh / both hands through under her arms to her breasts], [her head on the pillow / on his arm / tipped back against his shoulder].",
    "conflicts": "男方手部三组互斥（手数，后两组都必须用双手）",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "035",
    "name": "颜面骑乘",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方蹲坐在男方脸上、小穴压在他嘴上，身体可前倾或一边揉捏自己的乳房自慰；男方平躺、用舌头舔舐，并用手爱抚她的大腿／臀部／阴道内部。",
    "core": [
      "girl on top",
      "facesitting",
      "cunnilingus"
    ],
    "male": [
      "1boy",
      "lying",
      "on back",
      "licking",
      "tongue out"
    ],
    "female": [
      "1girl",
      "sitting on face",
      "squatting over",
      "looking down"
    ],
    "frame": "cowboy shot",
    "negative": "vaginal, penis, fellatio, extra limbs",
    "prompt": "the girl is squatting over the boy's face with her pussy pressed against his mouth, [leaning forward / kneading her own breasts as she masturbates]; the boy is lying on his back licking her, [his tongue on her clit / on her pussy], his hands on her [thighs / ass / inside her].",
    "conflicts": "",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "036",
    "name": "立式六九",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "男方站直、用肩膀支撑女方的体重，把她整个倒立举起；女方双腿环绕他的脖子或肩膀、头部位于他腹股沟处，为他口交。",
    "core": [
      "upright sixty-nine",
      "inverted",
      "standing",
      "fellatio",
      "cunnilingus"
    ],
    "male": [
      "1boy",
      "standing",
      "holding up",
      "penis"
    ],
    "female": [
      "1girl",
      "upside down",
      "legs around neck",
      "head down",
      "(penis in mouth:1.4)"
    ],
    "frame": "full body",
    "negative": "feet on ground, lying, extra limbs",
    "prompt": "the boy is standing upright supporting the girl's weight on his shoulders as he holds her up upside down; the girl's entire body is inverted with her legs around his [neck / shoulders] and her head at his groin, taking his penis into her mouth, [his tongue on her clit / on her pussy / pushing inside her], [her tongue circling his glans / taking the whole shaft in].",
    "conflicts": "",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "full body"
    ]
  },
  {
    "no": "037",
    "name": "背驮式",
    "limit": "小马限定",
    "limitOn": "male",
    "limitTags": [
      "petite male",
      "male clearly shorter than the girl",
      "small male body frame"
    ],
    "frozen": "女方四肢着地跪着、背部略微拱起背着男方、膝盖分开保持稳定；男方趴在她背上、双脚完全离地、身体紧贴她的背，双手抓她双乳或环她腰固定，阴茎插入她阴道。",
    "core": [
      "piggyback",
      "on back",
      "all fours",
      "sex"
    ],
    "male": [
      "1boy",
      "lying on person",
      "feet off ground",
      "penis"
    ],
    "female": [
      "1girl",
      "all fours",
      "carrying person"
    ],
    "frame": "cowboy shot",
    "negative": "feet on ground, muscular male, male face（需男方明显娇小）",
    "prompt": "the girl is on all fours with her back slightly arched and her knees spread for balance, carrying the boy on her back; the boy lies on top of her with both feet completely off the ground and his body pressed to her back, [his hands on her breasts / his arms around her waist], his penis inside her vagina, [his feet resting on her calves / on her ankles], [kissing and biting her neck and shoulders / reaching a hand down to rub her clit], [swaying gently / lowering onto her forearms / looking back at him].",
    "conflicts": "男方「伸手在下方揉阴蒂」与他撑在她背上的姿势有张力",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "038",
    "name": "亚马逊式",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "男方仰卧、双腿抬起、膝盖拉向胸部或肩膀；女方面向他蹲在他上方、双手撑在床上或他大腿上，主动向下把阴茎插入自己的阴道。",
    "core": [
      "girl on top",
      "amazon position",
      "squatting",
      "vaginal"
    ],
    "male": [
      "1boy",
      "lying",
      "on back",
      "legs up",
      "penis"
    ],
    "female": [
      "1girl",
      "squatting over",
      "looking down"
    ],
    "frame": "cowboy shot",
    "negative": "sitting on person, kneeling, male face（坐在对方身上就变成骑乘位）",
    "prompt": "the boy is lying on his back with both legs raised and his knees pulled toward his chest or shoulders; the girl faces him in a squat above him, lowering herself onto his penis with [her hands on the bed / on his thighs], [her feet flat on either side of his torso / leaning forward so her weight presses his legs down / grabbing his legs and pulling them back / using only her thighs to control the depth in the squat].",
    "conflicts": "「用手抓他的腿」与「双手撑在床上／他大腿上」互斥（手数）",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "039",
    "name": "真空口交",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方面前跪坐或鸭子坐，口部完全包裹阴茎、用嘴唇在柱身周围形成密闭、脸颊因吸力而凹陷，舌头在口内舔舐；男方站、坐或躺，双腿分开。",
    "core": [
      "fellatio",
      "sucking",
      "hollow cheeks",
      "saliva"
    ],
    "male": [
      "1boy",
      "standing / sitting / lying",
      "penis"
    ],
    "female": [
      "1girl",
      "kneeling / wariza",
      "(penis in mouth:1.5)",
      "looking at viewer"
    ],
    "frame": "close-up",
    "negative": "male face, extra hands, open mouth（权重不足会退化成浅含，脸颊也不会凹陷）",
    "prompt": "the girl is [kneeling / sitting in a W shape] in front of the boy, her mouth completely sealed around his penis, her cheeks hollowed by the suction while her tongue works inside; the boy is [standing / sitting / lying] with his legs apart, [his hands at his sides / one hand lightly on the back of her head], her eyes on him throughout.",
    "conflicts": "",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "close-up"
    ]
  },
  {
    "no": "040",
    "name": "双排并列式",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方 1 与女方 2 并排四肢着地；男方跪在两人身后，用阴茎插入女方 1，同时用手指、假阳具、振动棒或跳蛋刺激女方 2 的阴道或肛门。",
    "core": [
      "2girls",
      "threesome",
      "all fours",
      "fingering",
      "sex toys"
    ],
    "male": [
      "1boy",
      "kneeling",
      "penis"
    ],
    "female": [
      "1girl",
      "all fours / 1girl",
      "all fours",
      "ass"
    ],
    "frame": "cowboy shot",
    "negative": "solo, extra limbs, male face",
    "prompt": "the girl 1 and the girl 2 are both on all fours side by side; the boy is kneeling behind them, his penis in the girl 1 while he works the girl 2 with [his fingers / a dildo / a vibrator / a vibrator egg] in her [vagina / anus], [the two girls holding hands / fondling each other / arching their backs and spreading their knees], [looking back at him / looking at each other], [his free hand on both their clits].",
    "conflicts": "男方「伸出空闲的手刺激两女的阴蒂」要求他此时没有在用玩具或手指",
    "girls": 2,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "041",
    "name": "指交",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方跪坐／躺／站在爱抚方面前，挺腰并微微分开双腿；爱抚方用 1 根或 2 根手指刺激她的小穴。",
    "core": [
      "fingering",
      "pussy",
      "disembodied hand",
      "male hand"
    ],
    "male": [
      "只出现手，无男体"
    ],
    "female": [
      "1girl",
      "solo",
      "spread legs",
      "pussy juice"
    ],
    "frame": "close-up",
    "negative": "extra hands, extra arms, penis, male body, muscular male",
    "prompt": "the girl is [kneeling / lying / standing] in front of the one touching her, her back arched and her legs slightly apart; a single disembodied male hand works her with [one finger / two fingers] — [pushing inside and curling upward / stroking her clit with small presses and rubs, or pressing steadily with the palm / with the fingertips], [his other hand holding her / on her breast], [her clothes left on with his hand slipped inside her panties].",
    "conflicts": "「手指伸入阴道按压 G 点」与「手掌根部按压阴蒂」互斥",
    "girls": 1,
    "boys": 0,
    "solo": true,
    "frames": [
      "close-up"
    ]
  },
  {
    "no": "043",
    "name": "骑乘双插",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方跨坐在仰卧的男方 1 身上、双膝分开跪在他腰侧、上身前倾使胸部接近他面部，阴道被男方 1 从下方垂直向上插入、肛门被站在身后的男方 2 从后方水平插入。",
    "core": [
      "double penetration",
      "threesome",
      "mmf threesome",
      "girl on top",
      "vaginal",
      "anal"
    ],
    "male": [
      "1boy",
      "lying",
      "on back / 1boy",
      "standing",
      "penis"
    ],
    "female": [
      "1girl",
      "straddling",
      "kneeling",
      "ass"
    ],
    "frame": "cowboy shot",
    "negative": "solo, extra limbs, male face",
    "prompt": "the girl is straddling the boy 1 who lies on his back, her knees apart on either side of his waist and her upper body leaning forward so her chest is near his face, his penis in her vagina and the boy 2's penis in her anus from behind, the boy 2 [standing behind her / in a lunge behind her / kneeling behind her / squatting behind her ass], [the boy 1's hands on her breasts / ass / throat / around her / spreading her ass], [the boy 2's hands on her breasts / ass / throat / waist / around her / spreading her ass / holding her hands], [her own hands braced on his chest / on the bed / on his shoulders / pulled back behind her].",
    "conflicts": "各人手部选项互斥（手数）；女方双手五项互斥",
    "girls": 1,
    "boys": 2,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "044",
    "name": "跨骑双插",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方侧卧面向男方 1（上腿被抬起或搭在他身上）；男方 1 侧卧面向她、从侧前方插入阴道；男方 2 跨骑在两人上方、双腿分开跨在男方 1 躯干两侧，从上方插入肛门。",
    "core": [
      "double penetration",
      "threesome",
      "lying",
      "on side",
      "vaginal",
      "anal"
    ],
    "male": [
      "1boy",
      "lying",
      "on side / 1boy",
      "straddling",
      "penis"
    ],
    "female": [
      "1girl",
      "lying",
      "on side",
      "leg up"
    ],
    "frame": "cowboy shot",
    "negative": "solo, extra limbs, male face",
    "prompt": "the girl is lying on her side facing the boy 1 with her upper leg lifted or resting on him, his penis in her vagina from the side; the boy 2 is straddling the two of them from above with his legs on either side of the boy 1's torso, his penis in her anus from above, [the boy 1's hands on her breasts / throat / leg / around her waist], [the boy 2's hands on her breasts / ass / hair / throat / leg].",
    "conflicts": "各人手部选项互斥（手数）",
    "girls": 1,
    "boys": 2,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "045",
    "name": "打桩式双插",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方仰卧、双腿向上折叠至肩膀或头部两侧、臀部离地上翘，阴道与肛门朝上完全暴露；男方 1 与男方 2 面对面蹲在她上方，分别垂直向下插入阴道与肛门。",
    "core": [
      "double penetration",
      "threesome",
      "mating press",
      "folded",
      "suspended"
    ],
    "male": [
      "1boy",
      "squatting / 1boy",
      "squatting",
      "facing viewer",
      "penis"
    ],
    "female": [
      "1girl",
      "lying",
      "on back",
      "legs over shoulder",
      "ass up"
    ],
    "frame": "cowboy shot",
    "negative": "solo, extra limbs, male face, legs apart",
    "prompt": "the girl is lying on her back with both legs folded up over her shoulders or beside her head and her ass raised so her vagina and anus both face straight up; the boy 1 and the boy 2 are squatting face to face above her, driving vertically down into her vagina and anus respectively, [the boy 1 braced with a hand back on her thigh / balancing on his legs alone], [his hands slapping / kneading her ass], [the boy 2's hands slapping / kneading her ass], [her hands gripping the surface / her arms hanging at her sides].",
    "conflicts": "",
    "girls": 1,
    "boys": 2,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "046",
    "name": "站立悬空双插",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方完全悬空、双脚离地、全身重量由两名男性支撑、身体夹在两人之间靠在后方男性身上；男方 1 站立面向她从前方斜上插入阴道，男方 2 站在她身后从后方斜上插入肛门。",
    "core": [
      "double penetration",
      "threesome",
      "suspended",
      "standing",
      "carrying"
    ],
    "male": [
      "1boy",
      "standing",
      "holding up / 1boy",
      "standing",
      "penis"
    ],
    "female": [
      "1girl",
      "suspended",
      "feet off ground",
      "arms around neck"
    ],
    "frame": "cowboy shot",
    "negative": "feet on ground, standing on ground, solo, male face",
    "prompt": "the girl is hanging completely off the ground, both feet in the air, her whole weight carried by the two men as her body leans back against the man behind her; the boy 1 stands facing her driving up into her vagina from the front and the boy 2 stands behind her driving up into her anus, [the boy 1 taking the main lift / the boy 2 taking the main lift / both lifting together], [lifting under her ass / hooking her thighs], [his hands on her breasts / at her throat / spreading her ass], [her legs held wide open / hanging controlled / held apart].",
    "conflicts": "托举方与执行控制动作的一方不能是同一人（双手已被托举占用）",
    "girls": 1,
    "boys": 2,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "047",
    "name": "侧卧三明治双插",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方侧卧被前后夹在两个男性之间，正面靠近男方 1、后背靠近男方 2；男方 1 从前方插入阴道，男方 2 从后方插入肛门。",
    "core": [
      "double penetration",
      "threesome",
      "lying",
      "on side",
      "vaginal",
      "anal"
    ],
    "male": [
      "1boy",
      "lying",
      "on side / 1boy",
      "lying",
      "on side",
      "penis"
    ],
    "female": [
      "1girl",
      "lying",
      "on side",
      "sandwiched"
    ],
    "frame": "cowboy shot",
    "negative": "solo, extra limbs, male face",
    "prompt": "the girl is lying on her side sandwiched between the two men, her front toward the boy 1 and her back toward the boy 2, his penis in her vagina from the front and the other's in her anus from behind, both of them horizontal, [the boy 1's hands on her breasts / ass / leg / thigh / throat / around her waist], [the boy 2's hands on her breasts / ass / waist / hair / throat / around her], [her own hands trapped between the bodies / gripping the sheets].",
    "conflicts": "各人手部选项互斥（手数）；女方双手两项互斥",
    "girls": 1,
    "boys": 2,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "048",
    "name": "悬吊后背式",
    "limit": "小车限定",
    "limitOn": "female",
    "limitTags": [
      "petite girl",
      "girl clearly shorter than the man",
      "small female body frame"
    ],
    "frozen": "男方站立、双手托住女方的腰部或臀部把她抱起，从背面插入她的小穴或肛门；女方被完全抱离地面、背对男性、上半身前倾。",
    "core": [
      "suspended",
      "standing",
      "carrying",
      "sex"
    ],
    "male": [
      "1boy",
      "standing",
      "holding up",
      "penis"
    ],
    "female": [
      "1girl",
      "suspended",
      "feet off ground",
      "back to viewer"
    ],
    "frame": "cowboy shot",
    "negative": "feet on ground, muscular female, male face",
    "prompt": "the boy is standing, lifting the girl fully off the ground with his hands on [her waist / her ass] and penetrating her from behind; the girl is suspended with her upper body leaning forward and her back to him, [one of his hands spanking her ass / on her clit / his chest pressed to her back], [her arms and legs hanging limp / reaching back to grip his forearm or shoulder].",
    "conflicts": "「胸部紧贴女方背部」与「手在下方刺激阴蒂」有张力",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "049",
    "name": "站立怀抱式",
    "limit": "小车限定",
    "limitOn": "female",
    "limitTags": [
      "petite girl",
      "girl clearly shorter than the man",
      "small female body frame"
    ],
    "frozen": "男方站立、双手托住女方的腰部或臀部把她抱起，从正面插入她的小穴或肛门；女方被完全抱离地面、面向他、双腿环绕他腰间或放松垂下。",
    "core": [
      "suspended congress",
      "standing",
      "carrying",
      "vaginal"
    ],
    "male": [
      "1boy",
      "standing",
      "holding up",
      "penis"
    ],
    "female": [
      "1girl",
      "suspended",
      "feet off ground",
      "legs around waist"
    ],
    "frame": "cowboy shot",
    "negative": "feet on ground, muscular female, male face",
    "prompt": "the boy is standing, lifting the girl fully off the ground with his hands on [her waist / her ass] and penetrating her from the front; the girl is suspended facing him with her [legs wrapped around his waist / legs hanging loose], [reaching back to grip his forearm / her arms around his neck / her hands on his shoulders].",
    "conflicts": "",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "050",
    "name": "床上背面骑乘",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方背对男方跨坐在他腰腹处、双膝跪在床面、用腿部力量支撑身体；男方平躺仰卧、双腿自然伸直或屈起膝盖。",
    "core": [
      "reverse cowgirl",
      "girl on top",
      "straddling",
      "vaginal",
      "ass"
    ],
    "male": [
      "1boy",
      "lying",
      "on back",
      "penis"
    ],
    "female": [
      "1girl",
      "sitting on person",
      "back to viewer",
      "kneeling",
      "ass"
    ],
    "frame": "cowboy shot 或 from behind",
    "negative": "reclining, lying, on back, facing forward（原书明标\"严禁不合理的后仰\"）",
    "prompt": "the girl is sitting on the boy's lap with her back to him, kneeling on the bed and supporting herself with her legs, [leaning forward with her hands on his shins and her ass raised high / sitting upright with her hands hanging or reaching back to his knees / twisted to one side with her cheek on the bed]; the boy is lying on his back with his legs [straight / knees bent], [his hands on her ass / on her waist / behind his head], [spreading her ass to watch / slapping her ass / reaching around to rub her clit / gripping her waist to help her down].",
    "conflicts": "「双腿环绕腰间」与「双腿放松垂下」互斥",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot",
      "from behind"
    ]
  },
  {
    "no": "051",
    "name": "面对面侧卧",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "双方侧躺面对面；男方一条腿自然伸入女方双腿之间作为支点、呈水平插入，双手拥抱她背部或抚摸臀部；女方双腿与他双腿交缠成剪刀状，或上方大腿挂在他腰上，或双腿微弯让他的大腿卡在中间。",
    "core": [
      "lying",
      "on side",
      "face to face",
      "vaginal",
      "hugging"
    ],
    "male": [
      "1boy",
      "lying",
      "on side",
      "penis"
    ],
    "female": [
      "1girl",
      "lying",
      "on side",
      "facing viewer"
    ],
    "frame": "cowboy shot",
    "negative": "back to viewer, spooning, standing",
    "prompt": "the two of them are lying on their sides facing each other; the boy has one leg slipped between hers as a pivot and penetrates her horizontally, his arms [around her back / on her ass]; her legs [tangled scissor-style with his / upper thigh hooked over his hip / slightly bent so his thigh fits between them], [holding a deep kiss throughout / their fingers laced / his hand tracing down her spine / their foreheads touching].",
    "conflicts": "",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "052",
    "name": "压墙式",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方背部紧贴墙壁、单腿被架起在臂弯或肩上、或双腿盘在男方腰间整个人挂在身上；男方站立把她逼到墙边、单手撑墙或双手掐住她腰部固定，用体重优势把她压在墙上抽插。",
    "core": [
      "standing",
      "against wall",
      "sex",
      "vaginal"
    ],
    "male": [
      "1boy",
      "standing",
      "penis"
    ],
    "female": [
      "1girl",
      "against wall",
      "leaning against wall"
    ],
    "frame": "cowboy shot",
    "negative": "lying, sitting, back to viewer（背部离墙主体动作失效）",
    "prompt": "the girl is pinned with her back against the wall, [one leg lifted into the crook of his arm or onto his shoulder / both legs wrapped around his waist as she hangs on him]; the boy is standing holding her against the wall with [one hand braced on the wall above her / both hands on her waist], penetrating her, [his knee braced under her lifted thigh / his mouth at her ear / her leg hoisted onto his shoulder into a standing split], [her hands gripping his shoulders or hair / both her arms pushing back against the wall].",
    "conflicts": "「双腿盘腰挂在他身上」与「抓住她的一条腿扛在肩上形成一字马」互斥；「单手撑墙」与「双手掐腰」互斥",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "053",
    "name": "坐姿后入",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "男方坐在边缘、双腿自然分开；女方背对他坐在他大腿上、身体向后塌陷完全陷入他怀抱，阴道吞没下方的阴茎；男方双臂从后方环绕她的身体。",
    "core": [
      "sitting",
      "girl on lap",
      "vaginal",
      "hugging",
      "from behind"
    ],
    "male": [
      "1boy",
      "sitting",
      "arms around waist",
      "penis"
    ],
    "female": [
      "1girl",
      "sitting on lap",
      "back to viewer",
      "reclining"
    ],
    "frame": "cowboy shot",
    "negative": "face to face, facing forward, standing",
    "prompt": "the boy is sitting on [the edge of the bed / a chair / a sofa] with his legs apart; the girl sits back between his legs with her back to him, her body sunk back completely into his embrace so her vagina swallows his penis, her feet [on the ground / hooked around his shins / on top of his feet], while [his hands play with her breasts and pinch her nipples / his hands folded low on her belly pressing down / one hand turning her head to kiss while the other reaches down to her clit].",
    "conflicts": "",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "054",
    "name": "手交",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "男方仰卧或坐在床边、露出勃起的阴茎；女方位于他身侧或两腿之间，用手握住阴茎套弄。",
    "core": [
      "handjob",
      "penis"
    ],
    "male": [
      "1boy",
      "lying / sitting",
      "penis"
    ],
    "female": [
      "1girl",
      "sitting",
      "holding penis"
    ],
    "frame": "close-up",
    "negative": "extra hands, extra arms, female masturbation, male face",
    "prompt": "the boy is [lying on his back / sitting on the edge of the bed] with his erect penis exposed; the girl is beside him or between his legs, working it with her hand — [her thumb rubbing his glans / her fingertips on his corona / a twisting stroke as she turns her wrist], while [her other hand cups his balls / teases his nipples / comes up to her own mouth to suck].",
    "conflicts": "女方「用双手交替握住阴茎」与她\"另一只手做别的事\"互斥",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "close-up"
    ]
  },
  {
    "no": "055",
    "name": "乳交",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "男方仰卧、靠坐床头或坐在椅子上；女方跨坐他身上、跪在他双腿之间或趴在他身上，双手用力向内挤压双乳把阴茎夹在乳沟深处。",
    "core": [
      "paizuri",
      "breast",
      "penis between breasts",
      "breast hold"
    ],
    "male": [
      "1boy",
      "lying / sitting",
      "penis"
    ],
    "female": [
      "1girl",
      "(penis between breasts:1.4)"
    ],
    "frame": "upper body 或 close-up",
    "negative": "one hand on the base, flat chest, male face（前者是口交手势，用在乳交会画错手）",
    "prompt": "the boy is [lying on his back / propped against the headboard / sitting on a chair]; the girl is [straddling him / kneeling between his legs / lying on top of him], pressing both breasts together around his shaft so his penis is held deep in her cleavage, [her tongue licking his glans / her lips sucking his glans while her hands squeeze the base / lifting her head to kiss him], [his hands over hers helping her press / his hand on the back of her head].",
    "conflicts": "",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "upper body",
      "close-up"
    ]
  },
  {
    "no": "056",
    "name": "站立后入式",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方双脚着地、上半身向前弯曲、双手撑在前方，臀部高高撅起；男方站在她身后、双手握住她的腰或胯骨、下半身紧贴她臀部，从后方插入。",
    "core": [
      "standing",
      "bent over",
      "sex",
      "vaginal"
    ],
    "male": [
      "1boy",
      "standing",
      "holding waist",
      "penis"
    ],
    "female": [
      "1girl",
      "standing",
      "bent over",
      "ass up"
    ],
    "frame": "cowboy shot",
    "negative": "kneeling, lying, all fours",
    "prompt": "the girl is standing with both feet on the ground, bent forward at the waist with her ass raised high and her hands [braced on a surface in front of her / on her own knees / pushed against the wall / resting on the edge of a basin]; the boy is standing behind her with his hands on her waist or hips and his lower body pressed to her ass, penetrating her from behind, [his weight pressing down on her back and his hands reaching around to her hanging breasts / one hand pulling her hair back so her head lifts / both his hands pinning her shoulder blades], [her heels lifted to meet his height / her hips pushing back / her toes gripping the floor / her knees slightly bent].",
    "conflicts": "「重量压在她背上」与「抓发后拉使她仰头」互斥；「踮起脚尖」与「膝盖微弯」不同时取",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "057",
    "name": "侧向交叉位",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方平躺仰卧、双腿弯曲踩床或自然张开或一条腿被抬起；男方侧卧在她两腿之间、躯干与她呈 90 度垂直交叉（T 字形），从侧面插入阴道。",
    "core": [
      "lying",
      "on side",
      "sex",
      "from side"
    ],
    "male": [
      "1boy",
      "lying",
      "on side",
      "penis"
    ],
    "female": [
      "1girl",
      "lying",
      "on back",
      "legs bent"
    ],
    "frame": "cowboy shot",
    "negative": "face to face, spooning, both lying on side（两人平行躺会退化成面对面侧卧）",
    "prompt": "the girl is lying on her back with her legs [bent and planted on the bed / apart / one lifted by him]; the boy is lying on his side between her legs with his torso crossed at ninety degrees to hers (a T shape), penetrating her from the side, [one hand propping his head while the other rubs her clit / one of her legs hoisted onto his shoulder and pressed toward her head / his hand pressing her belly].",
    "conflicts": "男方「一只手支撑头部」与「把她一条腿扛在肩上」互斥（都要用那只手）",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "058",
    "name": "舔阴",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "男方位于女方两腿之间（站立或跪姿），双手掰开大阴唇、抱住她大腿根部或按压耻骨固定位置，把脸埋进她胯下；女方双腿张开、把私处送向他嘴边。",
    "core": [
      "cunnilingus",
      "pussy",
      "licking"
    ],
    "male": [
      "1boy",
      "kneeling / standing",
      "licking"
    ],
    "female": [
      "1girl",
      "spread legs",
      "pussy juice"
    ],
    "frame": "close-up",
    "negative": "penis, vaginal, fellatio, male face",
    "prompt": "the boy is between the girl's legs — [standing / kneeling] — with his face buried in her crotch and his hands [holding her pussy lips open / wrapped around her thighs / pressing her pubic bone down]; the girl has her legs spread and her pussy offered up to his mouth, her pussy juice visible, [his tongue flicking her clit / his lips sucking it / his tongue pushing inside / his tongue flat and sweeping across her whole vulva], [his fingers inside her as well / his hand on her thigh / on her breast].",
    "conflicts": "男方手部固定类与刺激类他只有两只手，取一两个即可",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "close-up"
    ]
  },
  {
    "no": "059",
    "name": "强制深喉",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "男方站或坐、双手按住女方的后脑勺控制她的头部位置；女方被迫张大嘴、喉咙深处完全敞开。（原书 `description`：无视女方呼吸节奏，强行挺腰抽插喉咙。）",
    "core": [
      "irrumatio",
      "fellatio",
      "deepthroat",
      "tears"
    ],
    "male": [
      "1boy",
      "standing / sitting",
      "holding head",
      "penis"
    ],
    "female": [
      "1girl",
      "kneeling",
      "(penis in mouth:1.8)",
      "tears",
      "drooling"
    ],
    "frame": "close-up",
    "negative": "smile, seductive_smile, closed mouth, male face",
    "prompt": "the boy is [standing / sitting] with both hands pressing the girl's head down and holding it in place; the girl has her mouth forced wide open and her throat completely exposed, taking him as he thrusts, tears welling at her eyes and drool running from the corner of her mouth.",
    "conflicts": "",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "close-up"
    ]
  },
  {
    "no": "060",
    "name": "床上六九式",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "男方平躺仰卧、头枕枕头、双手扶住女方的臀瓣或大腿，用舌头伺候她私处；女方头尾颠倒、完全放松地趴在他身上、胯部压在他脸上、口中含住他的阴茎。",
    "core": [
      "sixty-nine",
      "fellatio",
      "cunnilingus",
      "lying"
    ],
    "male": [
      "1boy",
      "lying",
      "on back",
      "licking",
      "penis"
    ],
    "female": [
      "1girl",
      "on top",
      "reversed",
      "head down",
      "(penis in mouth:1.4)"
    ],
    "frame": "cowboy shot",
    "negative": "standing, male face, extra limbs",
    "prompt": "the boy is lying on his back with his head on a pillow and his hands on the girl's [ass / thighs], his tongue working her pussy; the girl is draped over him head-to-toe in complete relaxation, her hips pressed down onto his face and his penis in her mouth, [his hands kneading her ass / his fingers pushed into her / her fingers in his hair], [taking him deep and swallowing / lifting her head as he finishes / holding him in her mouth until he softens].",
    "conflicts": "射精掌控三项互斥（同一时刻只能一种）",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "061",
    "name": "足交",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "男方仰卧或坐着、露出勃起的阴茎；女方坐在他身侧或对面，伸出双脚夹住或踩踏阴茎。",
    "core": [
      "footjob",
      "feet",
      "soles"
    ],
    "male": [
      "1boy",
      "sitting / lying",
      "penis",
      "cum",
      "ejaculation"
    ],
    "female": [
      "1girl",
      "sitting",
      "leg up"
    ],
    "frame": "cowboy shot",
    "negative": "male body, legs, thighs, full body, muscular male（**不要压男方身体**——那样阴茎会失去来源而浮空）；脚部着装按所选服装决定",
    "prompt": "the boy is [lying on his back / sitting] with his erect penis exposed; the girl is seated at his side or across from him, [wearing black stockings / white stockings / barefoot], catching and pressing his penis with both feet — [her toes pinching and tugging at his glans / both soles pressed together and rubbing / her heel grinding against his tip], [a look of disdain / of shame / blushing], while [he grips her ankle to guide her / holds her calf and kisses the top of her foot / comes across her soles].",
    "conflicts": "",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "062",
    "name": "龟头责弄",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方捧着阴茎、眼神向上看着男方，舌头专注于龟头、冠状沟与系带的刺激。",
    "core": [
      "glans licking",
      "licking penis",
      "tongue out",
      "saliva"
    ],
    "male": [
      "1boy",
      "standing / sitting",
      "penis"
    ],
    "female": [
      "1girl",
      "kneeling",
      "licking",
      "looking at viewer"
    ],
    "frame": "close-up",
    "negative": "penis in mouth, deepthroat, male face（本条只针对龟头）",
    "prompt": "the girl is holding his penis in her hands with her eyes lifted to the boy's face, her tongue working only on [the frenulum, flicking at it / his corona, circling it / his glans, wrapped and rotated], [her cheeks hollowed around just the tip / the sound of her suction audible / nodding with his glans in her mouth], [one hand stroking the shaft / pausing with a string of saliva hanging from her tongue / her nose brushing against his tip].",
    "conflicts": "配合项三项互斥（手数与口部占用）",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "close-up"
    ]
  },
  {
    "no": "063",
    "name": "反向悬空后入",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "男方站立、双臂从背后穿过女方腋下或环抱她腰部或托住她大腿内侧，把她完全抱离地面，阴茎从后方悬空插入；女方背对他、双脚离地、全身重量挂在他身上。",
    "core": [
      "suspended congress",
      "standing",
      "carrying",
      "sex"
    ],
    "male": [
      "1boy",
      "standing",
      "arms around waist",
      "holding up",
      "penis"
    ],
    "female": [
      "1girl",
      "suspended",
      "feet off ground",
      "back to viewer"
    ],
    "frame": "cowboy shot",
    "negative": "feet on ground, standing on ground, male face",
    "prompt": "the boy is standing and lifting the girl completely off the ground with [his arms passed under her arms / around her waist / under her thighs], penetrating her from behind as she hangs in the air, her back to him and her legs [kicking helplessly / hooked back around his waist / hanging and trembling], [her hands gripping a door frame or wall / reaching back around his neck / hanging limp at her sides].",
    "conflicts": "女方手部三项互斥",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "064",
    "name": "含棒饮尿",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "男方站立或坐于椅沿、双腿分开、一手扶住阴茎根部控制方向、一手按住女方后脑固定头部；女方跪于他胯前、仰头张嘴把阴茎含至喉口、双手扶住他大腿根部稳定身形，口腔完全包裹龟头形成密封并配合吞咽。",
    "core": [
      "fellatio",
      "(penis in mouth:1.8)",
      "peeing",
      "drinking"
    ],
    "male": [
      "1boy",
      "standing / sitting",
      "holding head",
      "penis"
    ],
    "female": [
      "1girl",
      "kneeling",
      "arms support"
    ],
    "frame": "close-up",
    "negative": "penis in mouth 权重不足／干燥口腔；smile（本条重点是液体）",
    "prompt": "the boy is [standing / seated at the edge of a chair] with his legs apart, one hand steadying the base of his penis and the other on the back of the girl's head; the girl is kneeling at his crotch with her head tipped back and his penis held at her throat, her mouth sealed around his glans and her hands braced on his thighs, swallowing as he releases — [his fingers pinching her nose shut / the flow slow enough for her to keep up / the flow suddenly heavy], [her tongue working his tip as she swallows / her mouth opened afterward to show it empty].",
    "conflicts": "",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "close-up"
    ]
  },
  {
    "no": "065",
    "name": "锁腿位",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方仰卧、双腿抬起并紧紧缠绕在男方的腰部或下背部、脚踝交叉扣死；男方俯卧在她身上、腰部被死死缠绕，处于无法抽身的状态。",
    "core": [
      "missionary",
      "lying",
      "on back",
      "legs around waist",
      "crossed ankles",
      "hugging"
    ],
    "male": [
      "1boy",
      "on top",
      "penis"
    ],
    "female": [
      "1girl",
      "lying",
      "on back",
      "legs locked"
    ],
    "frame": "upper body",
    "negative": "legs apart, spread legs, male face（双腿分开锁扣就失效）",
    "prompt": "the girl is lying on her back with both legs raised and locked around the boy's [waist / lower back], her ankles crossed and cinched shut; the boy is lying on top of her, his waist trapped by her legs so he cannot pull away, [his fingers laced with hers and pinned to the bed / his hand at her throat / holding her head and kissing her deeply], [her hands gripping the sheets / wrapped around his back / her fingers in his hair].",
    "conflicts": "男方手部三项互斥；女方手部三项互斥",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "upper body"
    ]
  },
  {
    "no": "066",
    "name": "M字开脚位",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方仰卧、双膝弯曲并向身体两侧极限打开、脚跟贴近大腿根部，呈 M 字形；男方跪在她两腿之间，用手压住她的膝盖、大腿内侧或把脚踝推向头部，使她无法合拢。",
    "core": [
      "lying",
      "on back",
      "spread legs",
      "pussy",
      "knees up"
    ],
    "male": [
      "1boy",
      "kneeling",
      "hands on own knees",
      "penis"
    ],
    "female": [
      "1girl",
      "lying",
      "on back",
      "M legs"
    ],
    "frame": "cowboy shot",
    "negative": "knees together, legs together, male face（双腿合拢就不是 M 字开脚）",
    "prompt": "the girl is lying on her back with both knees bent and opened as far to either side as they will go, her heels drawn close to her thighs in an M shape; the boy is kneeling between her legs, [his hands pressing down on her knees / holding her thighs apart / pushing her ankles toward her head] so she cannot close them, [her legs straining to close and being forced open again / her knees pressed almost flat to the bed / her own hands holding her ankles in place], [his glans circling at her entrance / one hand free and moving on her thigh].",
    "conflicts": "男方「压住膝盖」与「松开一只手去玩大腿」互斥（同一时刻）",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "067",
    "name": "莲花位",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "男方盘腿稳坐在床上形成宽大稳固的三角形底座；女方面对面跨坐在他怀里、双腿紧紧盘在他腰后互锁、双臂环抱他脖颈，利用体重让阴道吞没整根阴茎。",
    "core": [
      "lotus position",
      "girl on top",
      "sitting",
      "vaginal",
      "hugging"
    ],
    "male": [
      "1boy",
      "sitting",
      "crossed legs",
      "penis"
    ],
    "female": [
      "1girl",
      "sitting on lap",
      "legs around waist",
      "arms around neck"
    ],
    "frame": "cowboy shot",
    "negative": "standing, kneeling, lying",
    "prompt": "the boy is sitting cross-legged on the bed as a wide stable base; the girl is seated in his lap facing him with her legs locked around his back and her arms around his neck, her weight sinking her down onto his penis until it is fully inside her, [his hands under her ass / his arms locked around her back / his hand on the back of her head], [their foreheads pressed together / a deep kiss / her face buried in his neck].",
    "conflicts": "男方手部三项互斥",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "068",
    "name": "扛腿位",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方仰卧、双腿高高抬起架在男方的肩膀上、臀部随之抬离床面；男方跪在她身前、肩膀扛住她的小腿或膝盖、双手抱住她的腰或臀部。",
    "core": [
      "missionary",
      "legs over shoulder",
      "lying",
      "on back",
      "vaginal"
    ],
    "male": [
      "1boy",
      "kneeling",
      "penis"
    ],
    "female": [
      "1girl",
      "lying",
      "on back",
      "legs up"
    ],
    "frame": "cowboy shot",
    "negative": "legs apart, legs straight, male face（腿未上肩会退化成普通正面位）",
    "prompt": "the girl is lying on her back with both legs raised high onto the boy's shoulders and her ass lifted off the bed; the boy is kneeling in front of her with her calves or knees resting on his shoulders and his hands around her waist or ass, [his hands on her ankles steering her / bending down to kiss her chest and neck], [her toes curling / her hands gripping the sheets / her body trembling].",
    "conflicts": "男方「握脚踝」与「俯身亲吻胸部」互斥（都要用手撑住身体）",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "069",
    "name": "侧卧夹击三插",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方侧卧被男方 1（正面相对，一手穿过她颈下）与男方 2（背后紧贴）前后夹住、上侧腿被男方 1 抬起架于其腰间、头转向或上仰朝向男方 3；男方 3 跪于床头位于她头部上方，自上而下插入她的口腔。",
    "core": [
      "group sex",
      "threesome",
      "triple penetration",
      "lying",
      "on side"
    ],
    "male": [
      "1boy",
      "lying",
      "on side / 1boy",
      "lying",
      "on side / 1boy",
      "kneeling"
    ],
    "female": [
      "1girl",
      "lying",
      "on side",
      "leg up",
      "sandwiched"
    ],
    "frame": "cowboy shot",
    "negative": "solo, extra limbs, male face",
    "prompt": "the girl is lying on her side pinned between the boy 1 facing her and the boy 2 pressed to her back, her upper leg lifted onto the boy 1's hip and her head turned up toward the boy 3 who kneels at the head of the bed over her mouth, all three penetrating her at once, [the boy 1's hand pulling her upper thigh toward him / the boy 2's arm around her waist while his other hand is on her breast or clit / the boy 3's hand on her cheek guiding her], [her hands clutching the boy 1's shoulder / guided onto the base of the boy 3's penis].",
    "conflicts": "男方 2 双手两项互斥（手数）",
    "girls": 1,
    "boys": 3,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "070",
    "name": "站立侧抬腿",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方背部紧贴墙壁、单腿站立、另一条腿向侧面打开并抬起；男方面对她、一只脚踏入她两腿之间，用手托住她抬起那条腿的膝盖窝（屈膝）或握住脚踝高高举起（直腿）。",
    "core": [
      "standing",
      "leg up",
      "arm support",
      "standing split"
    ],
    "male": [
      "1boy",
      "standing",
      "penis"
    ],
    "female": [
      "1girl",
      "against wall",
      "standing",
      "leg up"
    ],
    "frame": "cowboy shot",
    "negative": "legs together, sitting, lying, legs apart（抬腿方向写成向后会退化成单腿站立位）",
    "prompt": "the girl is standing with her back against the wall and one leg raised out to the side, the boy facing her with one foot planted between her legs — [her knee bent with his palm cupped under it / her leg straight and pushed up toward her head as a standing split], [his hand teasing the sole of her foot, only when her knee is bent / his head lowered to kiss her knee, only when her leg is straight], [one side of her pussy spread open around his shaft / her supporting calf trembling / her pussy juice running down toward her ass].",
    "conflicts": "柔韧度与手法错配会配出\"人手够不到那条腿\"；「搔脚心」与直腿一字马不相容",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "071",
    "name": "仰卧承受三插",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方仰卧、肩颈着床作为支撑、腰臀被男方 2 托举悬空、双腿被男方 1 抬起向两侧大张呈 M 形、头部后仰（伸出床沿或在床面上后仰）；男方 1 站或跪立在她双腿之间从正面插入阴道，男方 2 跪于她臀部下方侧后位从下后方插入肛门，男方 3 跪坐于她头部上方自上而下插入口腔。",
    "core": [
      "group sex",
      "threesome",
      "triple penetration",
      "M legs",
      "suspended"
    ],
    "male": [
      "1boy",
      "standing / 1boy",
      "kneeling / 1boy",
      "kneeling"
    ],
    "female": [
      "1girl",
      "lying",
      "on back",
      "head off edge",
      "M legs"
    ],
    "frame": "cowboy shot",
    "negative": "solo, extra limbs, male face",
    "prompt": "the girl is lying on her back with only her shoulders and neck on the bed, her hips and waist lifted clear of it by the boy 2, her legs raised and spread wide in an M by the boy 1, and her head tipped back off the edge, all three holes taken at once, [the boy 1 with her legs over his shoulders pressing her thighs down / the boy 2's thumb circling her ass as he holds her up / the boy 3 cupping her face while he controls the depth, his fingers pinching her nose shut], [her hands gripping the boy 3's thigh / hanging limp at her sides].",
    "conflicts": "",
    "girls": 1,
    "boys": 3,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "072",
    "name": "俯压夹心三插",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方俯趴在仰卧的男方 1 身上、胸腹相贴、双腿分开夹于他腰侧、阴道纳入男方 1 的阴茎；男方 2 以半俯卧姿势覆在她背部、双手撑在她肩侧床面分担重量、从斜上方插入她的肛门；男方 3 跪于床侧或站于床边，从侧向插入她的口腔。",
    "core": [
      "group sex",
      "threesome",
      "triple penetration",
      "lying on person",
      "on stomach",
      "sandwiched"
    ],
    "male": [
      "1boy",
      "lying",
      "on back / 1boy",
      "on top / 1boy",
      "kneeling"
    ],
    "female": [
      "1girl",
      "lying on person",
      "on stomach"
    ],
    "frame": "cowboy shot",
    "negative": "solo, extra limbs, male face, prone bone",
    "prompt": "the girl is lying face-down on the boy 1 who lies beneath her, chest to belly, her legs apart around his waist and his penis inside her; the boy 2 is draped over her back in a half-prone position with his hands braced on the bed beside her shoulders, penetrating her anus from an angle above; the boy 3 kneels at the side of the bed with his penis in her mouth, his mouth turned to one side, [the boy 1's arms passed under hers and hooked over her shoulders pinning her to him / the boy 2's hand pressing the back of her neck / the boy 3's hand on the back of her head].",
    "conflicts": "",
    "girls": 1,
    "boys": 3,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "073",
    "name": "舔蛋",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "男方仰卧或站立、双腿张开把阴囊完全暴露；女方位于他胯下、先用手指轻触作为预告，随后凑近含入单侧睾丸、用舌面轻压推挤或吸吮阴囊的缝合线。",
    "core": [
      "licking testicles",
      "testicles",
      "saliva"
    ],
    "male": [
      "1boy",
      "lying / standing",
      "legs apart",
      "testicles"
    ],
    "female": [
      "1girl",
      "kneeling",
      "licking",
      "looking at viewer"
    ],
    "frame": "close-up",
    "negative": "penis in mouth, vaginal, male face",
    "prompt": "the boy is [lying on his back / standing] with his legs spread and his balls fully exposed; the girl is at his crotch and after touching him lightly with her fingers first, she closes in — [taking one ball into her mouth and rolling it with her tongue / pressing it through the skin with her tongue / sucking lightly at the skin / drawing her tongue along the raphe], and [working his shaft with her hand at the same time / pressing his perineum with a finger / looking up at him from below].",
    "conflicts": "复合动作三项互斥（口部与手部的分工不同）",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "close-up"
    ]
  },
  {
    "no": "074",
    "name": "毒龙",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "男方趴卧（腹部垫枕头翘起臀部）或四肢着地的狗趴式或平躺抱住双腿，把肛门暴露；女方把脸埋入他臀部之间、双手用力掰开他的臀瓣，用舌面舔舐肛门外圈与会阴、再用舌尖描摹褶皱或顶入。",
    "core": [
      "anilingus",
      "ass",
      "saliva"
    ],
    "male": [
      "1boy",
      "all fours / lying",
      "on stomach",
      "ass"
    ],
    "female": [
      "1girl",
      "kneeling",
      "licking",
      "spread ass"
    ],
    "frame": "close-up",
    "negative": "looking at viewer, looking back, blush（她的脸被挡住，加了会画出正面表情）",
    "prompt": "the boy is [on his stomach with a pillow under him raising his hips / on all fours / on his back holding both legs up], his anus fully exposed; the girl has her face buried between his ass cheeks with [both hands spreading his cheeks apart / her hands on his thighs / her hand pressing his lower back], her tongue tracing [the outer ring / his perineum / the cleft], then [circling the wrinkles / pushing in / sealing over the opening and sucking].",
    "conflicts": "女方手部三项互斥（手数）",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "close-up"
    ]
  },
  {
    "no": "075",
    "name": "清洁口交",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方凑近阴茎，先伸出舌头把覆盖在龟头表面的精液卷入口中、舔舐马眼周围，再张嘴把阴茎连根含入用口腔内壁整体「水洗」、或舌面包裹着向下撸动，最后用力吸吮尿道口榨取残精；男方射精结束、阴茎处于敏感状态。",
    "core": [
      "after fellatio",
      "cum in mouth",
      "cum on tongue",
      "saliva"
    ],
    "male": [
      "1boy",
      "standing / sitting",
      "penis"
    ],
    "female": [
      "1girl",
      "kneeling",
      "(penis in mouth:1.4)",
      "looking at viewer"
    ],
    "frame": "close-up",
    "negative": "vaginal, male face, extra hands（落点不加限定，只写 cum 一类结果标签）",
    "prompt": "the girl is leaning in toward the boy's penis after he has finished, [licking the cum off his glans and taking it into her mouth / lapping around his tip], [taking the whole shaft into her mouth and washing it with her cheeks / swallowing him down once / dragging her tongue down the shaft], then [sucking hard at his tip / drawing the last of it out as he twitches], [a thread of fluid at the corner of her mouth / looking up at him].",
    "conflicts": "三步是先后顺序，出图只能定格在其中一步",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "close-up"
    ]
  },
  {
    "no": "076",
    "name": "交叠互锁三插",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方侧卧夹在男方 1（正面相对，一条腿穿入她双腿之间）与男方 2（背后汤匙姿态，一条腿与她及男方 1 的腿交叠）之间、上侧腿被抬起架于男方 1 腰间；男方 3 跪姿停于床头、女方头部枕于他大腿上，他从上方插入她侧仰的口腔。",
    "core": [
      "group sex",
      "threesome",
      "triple penetration",
      "spooning"
    ],
    "male": [
      "1boy",
      "lying",
      "on side / 1boy",
      "lying",
      "on side / 1boy",
      "kneeling"
    ],
    "female": [
      "1girl",
      "lying",
      "on side",
      "leg up",
      "sandwiched"
    ],
    "frame": "cowboy shot",
    "negative": "solo, extra limbs, male face",
    "prompt": "the girl is lying on her side wedged between the boy 1 facing her and the boy 2 spooned against her back, their legs interlaced, her upper leg lifted onto the boy 1's hip; the boy 3 kneels at the head of the bed with her head on his thigh, entering her upturned mouth from above, [the boy 1's hand holding her thigh up while the other kneads her breast / the boy 2's arm around her waist while the other presses her clit / the boy 3's hand on her cheek and ear], [her hands gripping the boy 1's arm and reaching back to the boy 2's arm].",
    "conflicts": "",
    "girls": 1,
    "boys": 3,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "077",
    "name": "人体海绵",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "男方在浴室自然站立、双脚微张、双手自然下垂或背在身后或扶着女方的头；女方全身（胸部、腹部、腋下、大腿）涂满厚重的泡沫，先站姿用胸部／小腹／腋窝蹭洗他上半身，再蹲下或单膝跪地用双乳／大腿／脸颊颈窝蹭洗他下肢，最后从蹲姿缓缓站起、像电梯一样从脚踝一路蹭到脖子。",
    "core": [
      "soap",
      "foam",
      "bathroom",
      "wet（原文）"
    ],
    "male": [
      "1boy",
      "standing",
      "nude",
      "penis"
    ],
    "female": [
      "1girl",
      "soap on body",
      "hugging"
    ],
    "frame": "cowboy shot",
    "negative": "dry skin, clothes, indoor without foam（无泡沫就不是本条目）",
    "prompt": "the boy is standing in a bathroom, feet slightly apart, [his arms at his sides / his hands behind his back / one hand on her head], his whole body relaxed; the girl is covered in thick foam — standing and working [her breasts against his chest / her belly against his back / his arm caught in her armpit] before [squatting down to rub her breasts along his calves / her thighs along his thighs / her cheek and neck against his knees], then sliding her whole body back up from his ankles to his neck.",
    "conflicts": "高度决定接触部位——蹲下时不可能用胸蹭他胸膛",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "078",
    "name": "软足侍奉",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "男方坐在床边或沙发深处或椅子上、身体后仰放松、双腿大开、双脚自然踩在地面；女方双膝跪地或鸭子坐在他双腿之间，双手握住他脚踝提起／托住脚跟把脚搁在自己大腿上／捧起脚掌固定在面前，用舌面舔舐脚底、脚心、脚背肌腱，舌尖钻入趾缝，再含吮脚趾。",
    "core": [
      "foot worship",
      "feet",
      "toes",
      "licking",
      "saliva"
    ],
    "male": [
      "1boy",
      "sitting",
      "legs apart",
      "feet"
    ],
    "female": [
      "1girl",
      "kneeling / wariza",
      "holding foot",
      "licking"
    ],
    "frame": "close-up",
    "negative": "footjob, licking penis, vaginal（本条是女方舔男方的脚，方向与足交相反）",
    "prompt": "the boy is sitting on [the edge of the bed / deep in a sofa / a chair], leaning back with his legs wide apart and his feet on the floor, giving up all control; the girl is [kneeling on both knees / sitting in a W shape] between his legs, [lifting his ankle in both hands / resting his heel on her thigh / holding his sole in front of her face], licking [the sole in long strokes from heel to toes / the hollow of his arch / the tendons of his instep], then [nosing between his toes / spreading them apart / curling her tongue around one], [drawing a single big toe into her mouth], [a thread of saliva running from her mouth to his toes].",
    "conflicts": "含吮三项互斥（口部只能容纳一种）",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "close-up"
    ]
  },
  {
    "no": "079",
    "name": "坐姿背面骑乘式",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "男方坐在平面上、双脚踩实地面稳住重心、双手解放用于爱抚；女方背对他坐在他大腿上、双脚踩在地面或他脚背或勾住椅子腿借力，用大腿与腰部力量控制动作，躯干可前倾、后仰或侧斜。",
    "core": [
      "reverse cowgirl",
      "sitting",
      "girl on lap",
      "vaginal"
    ],
    "male": [
      "1boy",
      "sitting",
      "penis"
    ],
    "female": [
      "1girl",
      "sitting on lap",
      "back to viewer",
      "feet on ground"
    ],
    "frame": "cowboy shot",
    "negative": "standing, facing forward",
    "prompt": "the boy is sitting on [the edge of the bed / a chair / a sofa / a toilet lid] with his feet flat and his hands free; the girl sits on his lap with her back to him, her feet [on the floor / on top of his feet / hooked around the chair legs], [leaning forward with her hands out in front / reclining back against his chest / twisted to one side with one hand back on his thigh], while [his hands come around under her arms to her breasts / grip her hips to help her move / slap her raised ass / reach down to her clit].",
    "conflicts": "男方手部四项互斥（手数）；女方双脚三项互斥",
    "girls": 1,
    "boys": 1,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "080",
    "name": "倒悬打桩三插",
    "limit": "小车限定",
    "limitOn": "female",
    "limitTags": [
      "petite girl",
      "girl clearly shorter than the man",
      "small female body frame"
    ],
    "frozen": "女方全身倒悬于空中（头朝地、双足指天）、双腿被托住或自然分开悬于空中、腰腹被男方托举；男方 1 站立、双手从两侧环抱托住她腰胯把躯体倒提，从正上方垂直向下插入阴道；男方 2 站于他斜后侧、从斜后上方向下插入肛门；男方 3 蹲于她头部正下方，从下方向上送入她的口腔。",
    "core": [
      "group sex",
      "triple penetration",
      "inverted",
      "suspended",
      "mating press"
    ],
    "male": [
      "1boy",
      "standing",
      "holding up / 1boy",
      "standing / 1boy",
      "squatting"
    ],
    "female": [
      "1girl",
      "upside down",
      "suspended",
      "legs apart"
    ],
    "frame": "full body",
    "negative": "solo, extra limbs, standing on ground, male face",
    "prompt": "the girl is hanging upside down in midair, head toward the floor and feet toward the ceiling, her legs held or spread apart, her hips supported — the boy 1 standing and holding her around the waist to tip her over while driving down into her vagina, the boy 2 behind him entering her anus from above and behind, the boy 3 squatting below her head and feeding his penis up into her mouth, [the boy 1's hands moving from her waist to pulling her ankles wide apart / the boy 2's free hand slapping her ass or rubbing her clit / the boy 3 holding her cheeks].",
    "conflicts": "",
    "girls": 1,
    "boys": 3,
    "solo": false,
    "frames": [
      "full body"
    ]
  },
  {
    "no": "081",
    "name": "折腿打桩三插",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方仰卧于平台、背脊紧贴台面、双腿被男方 1 向上托起并向头部方向极限压折使膝窝抵近她耳侧、下体朝天敞开、头部垂出台缘后仰；男方 1 站于平台边缘从正上方垂直向下插入阴道，男方 2 站于侧边从斜上方向下插入肛门，男方 3 站于另一端从上方向下插入她后仰的咽喉。",
    "core": [
      "group sex",
      "triple penetration",
      "mating press",
      "folded",
      "on table"
    ],
    "male": [
      "1boy",
      "standing / 1boy",
      "standing / 1boy",
      "standing"
    ],
    "female": [
      "1girl",
      "lying",
      "on back",
      "legs over head",
      "head off edge"
    ],
    "frame": "cowboy shot",
    "negative": "solo, extra limbs, legs apart, male face",
    "prompt": "the girl is on her back on a raised platform with her spine flat and her head hanging back off the edge, her legs folded up and pressed toward her head until her knees are beside her ears and her crotch faces straight up; the boy 1 stands at the edge driving straight down into her vagina, the boy 2 at her side entering her anus from above and behind, the boy 3 at the other end entering her throat from above, [the boy 1 forcing both legs together and down / apart, the boy 2 slapping her raised ass / the boy 3's hand on her throat], [her hands gripping the platform edge / clutching the boy 3's calf].",
    "conflicts": "",
    "girls": 1,
    "boys": 3,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "083",
    "name": "单穴并列贯穿_阴道",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方跨坐在仰卧的男方 1 身上、上身被他压低；男方 1 双手掐她腰／抓她臀瓣／向上揉她乳房，从下方垂直向上插入阴道；男方 2 跪在男方 1 腿间、身体前倾覆盖在她背上，从后方斜向下把自己的阴茎并排挤入同一个阴道。",
    "core": [
      "double vaginal",
      "double penetration",
      "threesome",
      "girl on top"
    ],
    "male": [
      "1boy",
      "lying",
      "on back / 1boy",
      "kneeling",
      "penis"
    ],
    "female": [
      "1girl",
      "straddling",
      "lean forward"
    ],
    "frame": "close-up 或 cowboy shot",
    "negative": "solo, extra limbs, male face",
    "prompt": "the girl is straddling the boy 1 who lies beneath her with her upper body pressed low; his penis drives up into her vagina while the boy 2 kneels between his legs and drapes himself over her back, forcing his penis in alongside the first one so both fill the same vagina, [the boy 1's hands on her waist / her ass / her breasts], [the boy 2's hands on her shoulder / the back of her neck / her hair].",
    "conflicts": "各人手部三项互斥（手数）",
    "girls": 1,
    "boys": 2,
    "solo": false,
    "frames": [
      "close-up",
      "cowboy shot"
    ]
  },
  {
    "no": "084",
    "name": "叠压肛门双插",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方侧卧被两名男性从后方夹住；男方 1 侧卧在她身后、一手掐她咽喉／揉她乳房／扣她下巴，从后方插入她的肛门；男方 2 从她身后上方压下、身体叠在男方 1 侧面，从斜上方角度挤入已被占据的肛门。",
    "core": [
      "double anal",
      "double penetration",
      "threesome",
      "lying",
      "on side"
    ],
    "male": [
      "1boy",
      "lying",
      "on side / 1boy",
      "on top",
      "penis"
    ],
    "female": [
      "1girl",
      "lying",
      "on side",
      "ass"
    ],
    "frame": "close-up",
    "negative": "solo, extra limbs, vaginal, male face",
    "prompt": "the girl is lying on her side held from behind by two men, the boy 1 lying against her back with [his hand at her throat / on her breast / cupping her chin] and his penis in her anus, and the boy 2 pressing down over him from above and behind to force his penis into the same anus from a higher angle.",
    "conflicts": "各人手部三项互斥（手数）",
    "girls": 1,
    "boys": 2,
    "solo": false,
    "frames": [
      "close-up"
    ]
  },
  {
    "no": "085",
    "name": "站立悬空同穴插",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方完全悬空、双腿被迫大张、双臂环住男方 1 的脖颈、全身重量由插入体内的两根阴茎和男方们的臂力支撑；男方 1 正面站立托住她臀部、从下方插入阴道；男方 2 站在她身后、双手抓她腰或托她大腿根或环抱她腹部，从后方挤入同一个阴道。",
    "core": [
      "double vaginal",
      "double penetration",
      "suspended",
      "standing",
      "carrying"
    ],
    "male": [
      "1boy",
      "standing",
      "holding up / 1boy",
      "standing",
      "penis"
    ],
    "female": [
      "1girl",
      "suspended",
      "feet off ground",
      "legs apart",
      "arms around neck"
    ],
    "frame": "cowboy shot",
    "negative": "feet on ground, standing on ground, solo, male face",
    "prompt": "the girl is completely off the ground with her legs held wide apart and her arms around the boy 1's neck, her whole weight hanging on the two penises inside her and the men's arms; the boy 1 holds her up from the front, his penis in her vagina, while the boy 2 stands behind her forcing his in alongside it — [his hands on her waist / under the tops of her thighs / around her belly], [the boy 1's mouth on her nipple / at her neck / on her ear].",
    "conflicts": "",
    "girls": 1,
    "boys": 2,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "086",
    "name": "折叠打桩同穴",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方仰卧、双腿被折叠至肩膀两侧、臀部高高翘起使单一穴口完全暴露向上；男方 1 蹲在她上方、双脚踩在她腰侧，垂直向下插入阴道或肛门；男方 2 与男方 1 面对面蹲立，同样垂直向下与男方 1 并排插入同一个穴口。",
    "core": [
      "double vaginal",
      "double penetration",
      "mating press",
      "folded"
    ],
    "male": [
      "1boy",
      "squatting / 1boy",
      "squatting",
      "facing viewer",
      "penis"
    ],
    "female": [
      "1girl",
      "lying",
      "on back",
      "legs over shoulder",
      "ass up"
    ],
    "frame": "cowboy shot",
    "negative": "solo, extra limbs, legs apart, male face",
    "prompt": "the girl is on her back with both legs folded up beside her shoulders and her ass raised so a single hole faces straight up; the boy 1 squats above her with his feet on either side of her waist driving straight down into her [vagina / anus], and the boy 2 squats facing him and drives in alongside, both of them in the same hole, [the boy 1's hands slapping her hip / pinching her nipple upward / his fingers in her mouth].",
    "conflicts": "男方 1 手部三项互斥",
    "girls": 1,
    "boys": 2,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  },
  {
    "no": "087",
    "name": "同舔两棒",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方跪在两名男性正前方、面对两根并排贴在一起的阴茎，伸出舌头从双茎底部开始、沿着两根肉棒之间的缝隙一路向上舔至龟头，再张嘴轮流吞吐两个龟头；两名男方站立、肩并肩贴近，各自扶住自己的阴茎。",
    "core": [
      "group sex",
      "multiple penis",
      "fellatio",
      "licking",
      "saliva"
    ],
    "male": [
      "1boy",
      "standing / 1boy",
      "standing（两人并排）"
    ],
    "female": [
      "1girl",
      "kneeling",
      "licking penis",
      "tongue out"
    ],
    "frame": "close-up",
    "negative": "solo, vaginal, extra limbs, male face",
    "prompt": "the girl is kneeling directly in front of the two men as they stand shoulder to shoulder, their two penises pressed together side by side before her face; she runs her tongue up the seam between them from the base to the tips, then takes the two glans into her mouth in turn — [her tongue flat against the sides of both shafts / one in each hand brought together and taken in at once / both held between her tongue and the roof of her mouth], while [each man steadies his own shaft and taps her cheek or tongue with it].",
    "conflicts": "",
    "girls": 1,
    "boys": 2,
    "solo": false,
    "frames": [
      "close-up"
    ]
  },
  {
    "no": "088",
    "name": "轮换舔吸",
    "limit": "",
    "limitOn": "",
    "limitTags": [],
    "frozen": "女方跪在两人中间、头部在两人胯间左右转动轮流含入（左转含入男方 1 深喉吞吐，再右转含入男方 2），双手分别握住暂时空出嘴的那根保持硬度；两名男方分站她左右、胯部朝向她的面颊。",
    "core": [
      "group sex",
      "multiple penis",
      "fellatio",
      "kneeling"
    ],
    "male": [
      "1boy",
      "standing / 1boy",
      "standing（左右各一）"
    ],
    "female": [
      "1girl",
      "kneeling",
      "(penis in mouth:1.4)",
      "holding penis"
    ],
    "frame": "cowboy shot",
    "negative": "solo, extra limbs, vaginal, male face",
    "prompt": "the girl is kneeling between the two men who stand to her left and right with their crotches toward her face; she turns her head from side to side taking one penis and then the other into her mouth, her free hand working whichever one is out of her mouth to keep it hard, [each man's hand on the back of her head pulling her toward him / racing each other], [her tongue shown between turns / both pulled to her mouth at once and licked together].",
    "conflicts": "换边动作互斥（同一时刻只能伺候一根）",
    "girls": 1,
    "boys": 2,
    "solo": false,
    "frames": [
      "cowboy shot"
    ]
  }
];

/** 单条文案：中文名 + 定格（给 LLM 写作品名时做参考） */
export function poseBrief(p) {
  return `${p.name}——${p.frozen}`;
}
