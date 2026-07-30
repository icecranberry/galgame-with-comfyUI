export const EXPLICIT_ADULT_PATTERN = /(?:\b(?:nsfw|nude|naked|sex|sexual|after sex|fucked silly|orgasm|ahegao|in heat|penis|testicle|erection|flaccid|foreskin|precum|futanari|cock|dick|pussy|vagina|vaginal|clitoris|labia|anus|anal|fellatio|blowjob|deepthroat|irrumatio|masturbat\w*|fingering|vibrator|dildo|handjob|footjob|paizuri|titjob|cum|bukkake|ejaculat\w*|semen|bondage|bdsm|rape|crotchless|no panties|bottomless|topless|nipple|areola|pubic hair|cameltoe|groping|grope|moan(?:ing)?|ass grab|butt grab|grabbing breasts?)\b|色情|性爱|性交|裸体|全裸|事后|发情|高潮|阿黑颜|阴部|阴唇|阴蒂|阴茎|睾丸|龟头|阴道|肛门|肛交|口交|深喉|自慰|手淫|跳蛋|假阳具|射精|精液|颜射|内射|束缚|调教|强奸|扶她|无内裤|露乳|乳头|乳晕|软牛子|抓着屁股|抓着乳房|呻吟)/i;

export function containsExplicitAdultContent(value) {
  return EXPLICIT_ADULT_PATTERN.test(String(value || '').replace(/[_-]+/g, ' '));
}
