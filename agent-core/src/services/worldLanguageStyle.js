import { getActiveWorldSetting, isWorldSettingHidden } from '../db/worldRepository.js';

/** 只在正文表达规则的原位追加，不改变历史、输出协议或未配置时的字节。 */
export function appendWorldLanguageStyle(original) {
  if (isWorldSettingHidden()) return original;
  const style = getActiveWorldSetting()?.language_style?.trim();
  if (!style) return original;
  return `${original}\n\n<additional_writing_style>\n以下为追加的语言风格：\n${style}\n</additional_writing_style>`;
}
