/**
 * Linshe 组件必须显式 import —— 全仓护栏。
 *
 * ── 为什么需要这道护栏 ─────────────────────────────────────
 * 本项目的 Linshe 基础组件（`src/components/ui/*.vue`）是**局部 import**，
 * `main.js` 里**没有** `app.component()` 全局注册。
 *
 * 于是漏 import 时 Vue **不报错**：它把 `<linshe-modal>` 当成"未知自定义元素"
 * 原样渲染成裸标签 —— 没有输入框、没有 footer、点不动。
 * 静态检查（lint / build）全绿，只有真机打开才看得出来。
 *
 * 实测踩过（2026-10-07）：`AppearanceTraitPicker.vue` 用了
 * `<linshe-modal>` / `<linshe-button>` / `<linshe-input>` 三个组件却一个都没导入，
 * 整个弹窗实际是空的。是我做绘图页时用 headless Edge 打开才抓到的。
 *
 * 本测试把"用了就必须 import"变成启动即报，杜绝这类静默失效。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_SRC = path.resolve(__dirname, '../../web-ui/src');
const UI_DIR = path.join(WEB_SRC, 'components/ui');

/** 可用的 Linshe 组件：文件名（PascalCase）→ 标签名（kebab-case） */
function availableComponents() {
  const out = [];
  for (const f of fs.readdirSync(UI_DIR)) {
    if (!f.endsWith('.vue')) continue;
    const name = f.replace(/\.vue$/, '');           // LinsheModal
    const kebab = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase(); // linshe-modal
    out.push({ name, kebab, file: `components/ui/${f}` });
  }
  return out;
}

/** 递归收集 web-ui/src 下所有 vue 文件 */
function allVueFiles(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) allVueFiles(p, acc);
    else if (e.isFile() && e.name.endsWith('.vue')) acc.push(p);
  }
  return acc;
}

const COMPONENTS = availableComponents();
const VUE_FILES = allVueFiles(WEB_SRC);

test('★ 护栏自检：至少能识别出 Linshe 组件，且扫描到了 vue 文件', () => {
  assert.ok(COMPONENTS.length >= 5, `ui/ 下只识别到 ${COMPONENTS.length} 个组件，扫描路径可能不对`);
  assert.ok(VUE_FILES.length >= 30, `只扫到 ${VUE_FILES.length} 个 vue 文件，扫描路径可能不对`);
});

test('★★ 凡是用到 <linshe-*> 的组件，都必须显式 import 对应实现', () => {
  const offenders = [];

  for (const file of VUE_FILES) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(WEB_SRC, file).replace(/\\/g, '/');

    // 只扫模板里的标签用法（<linshe-xxx），不看注释里的说明文字
    const template = src.match(/<template>[\s\S]*?<\/template>/)?.[0] || '';
    const used = new Set(
      [...template.matchAll(/<(linshe-[a-z0-9-]+)[\s/>]/g)].map(m => m[1])
    );
    if (!used.size) continue;

    for (const kebab of used) {
      const comp = COMPONENTS.find(c => c.kebab === kebab);
      if (!comp) continue;   // 不是 ui/ 里的组件（可能是别处定义的）
      // 必须 import 该组件（PascalCase 名）
      const re = new RegExp(`import\\s+${comp.name}\\s+from\\s+['"][^'"]*${comp.name}\\.vue['"]`);
      if (!re.test(src)) {
        offenders.push(`${rel} 使用了 <${kebab}> 但没有 import ${comp.name}`);
      }
    }
  }

  assert.deepEqual(
    offenders, [],
    '以下组件漏 import（会被 Vue 当成未知元素原样渲染，静默失效）：\n' + offenders.join('\n')
  );
});

test('★ 绘图页与标签选择器的组件依赖完整（本次事故点的定点回归）', () => {
  const picker = fs.readFileSync(path.join(WEB_SRC, 'components/AppearanceTraitPicker.vue'), 'utf8');
  for (const n of ['LinsheModal', 'LinsheButton', 'LinsheInput']) {
    assert.match(picker, new RegExp(`import\\s+${n}\\s+from`), `AppearanceTraitPicker 必须 import ${n}`);
  }
  const draw = fs.readFileSync(path.join(WEB_SRC, 'views/DrawView.vue'), 'utf8');
  for (const n of ['LinsheModal', 'LinsheButton', 'LinsheInput', 'LinsheAutoTextarea']) {
    assert.match(draw, new RegExp(`import\\s+${n}\\s+from`), `DrawView 必须 import ${n}`);
  }
});