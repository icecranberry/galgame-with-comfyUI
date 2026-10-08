# NEXT · 现在从哪里继续

> 状态权威。范围定义在 `docs/本地补丁-总设计案.md`；本文件记录**事实、证据**与**下一道门**。
> 结构化块由 TavernWeave 进度画板读取。

## 当前续接点

- **正在做**：看板已建立，等待驾驶员确认首版范围。
- **下一道门**：驾驶员确认范围 —— 确认后把总设计案范围块的 `baseline.confirmed` 置 `true`、
>   登记 `reference`（确认依据），再 `source-plan` + `sync-sources` 同步。
- **本轮不做**：二相乐园示例地图的多层嵌套重组（`珠星集团总部大楼` 等）。

## 已知风险

1. `邻舍-local/` 工具箱**未跟踪且未进 `.gitignore`**：更新流程的 stash 只带 `SOURCE_PATHS` 白名单、
   `git clean` 只作用于 `agent-core/public`，所以不会覆盖它；但反过来它也**不在快照保护范围内**。
2. 新功能的浏览器验收与驾驶员验收尚未系统登记，多数验收门仍是 `pending`。
3. 环境事实（多实例、SMB/NAS、端口等）散落在 `.workbuddy/memory/`，本文件不复述，排查时先读那里。

## 状态块（工具读取；勿改格式）

<!-- tw-progress-state:begin -->
```json
{
  "schema": "tavernweave/progress-state/v1",
  "revision": 3,
  "projectId": "linshe-local-patch",
  "designRevision": 1,
  "baselineId": "scope-1",
  "handoff": {
    "currentStep": "已完成 automated 检查与 browser 浏览器验收两轮，结果已回写看板",
    "nextGate": "驾驶员验收（driver）：确认这些功能是否符合预期",
    "openRisks": [
      "邻舍-local 工具箱未跟踪且未进 .gitignore：更新流程不覆盖它，但也不会进快照",
      "门户态帖（payload_json）此前一条都没生成过 —— 两层生成已由一次真实出刊验证，但仍需你在界面上实际出一期确认观感",
      "二相乐园示例地图已导入，「珠星集团总部大楼」等原有嵌套尚未重组为多层结构"
    ],
    "feedbackRefs": []
  },
  "items": [
    {
      "id": "map-page",
      "activity": "doing",
      "summary": "两段式生成世界地图骨架（大地区/子地区/场景/POI），层级不限深、可手动增删改、支持复制为模板。",
      "checkpoints": [
        {
          "id": "backend",
          "implemented": true,
          "evidence": [
            "agent-core/src/services/worldMapService.js",
            "agent-core/src/routes/worldMap.js",
            "agent-core/src/db/index.js"
          ],
          "gates": [
            {
              "kind": "automated",
              "status": "passed",
              "evidence": [
                "docs/验证记录/2026-10-04-本地补丁-自动检查.md"
              ]
            },
            {
              "kind": "browser",
              "status": "passed",
              "evidence": [
                "docs/验证记录/2026-10-04-本地补丁-浏览器验收-第2轮.md",
                "docs/验证记录/截图/地图页-缩进树与详情.png",
                "docs/验证记录/截图/外观分层-身体与五态.png",
                "docs/验证记录/截图/网络页-分类与批量操作.png",
                "docs/验证记录/截图/归档-日程页分类栏.png"
              ]
            },
            {
              "kind": "driver",
              "status": "pending",
              "evidence": []
            }
          ]
        },
        {
          "id": "frontend",
          "implemented": true,
          "evidence": [
            "web-ui/src/views/WorldMapView.vue",
            "web-ui/src/components/NavBar.vue",
            "web-ui/src/main.js",
            "web-ui/src/api/index.js"
          ],
          "gates": [
            {
              "kind": "browser",
              "status": "passed",
              "evidence": [
                "docs/验证记录/2026-10-04-本地补丁-浏览器验收-第2轮.md",
                "docs/验证记录/截图/地图页-缩进树与详情.png",
                "docs/验证记录/截图/外观分层-身体与五态.png",
                "docs/验证记录/截图/网络页-分类与批量操作.png",
                "docs/验证记录/截图/归档-日程页分类栏.png"
              ]
            },
            {
              "kind": "driver",
              "status": "pending",
              "evidence": []
            }
          ]
        },
        {
          "id": "export",
          "implemented": true,
          "evidence": [
            "agent-core/src/services/worldMapService.js",
            "docs/验证记录/2026-10-04-本地补丁-自动检查.md"
          ],
          "gates": [
            {
              "kind": "automated",
              "status": "passed",
              "evidence": [
                "docs/验证记录/2026-10-04-本地补丁-自动检查.md"
              ]
            },
            {
              "kind": "driver",
              "status": "pending",
              "evidence": []
            }
          ]
        },
        {
          "id": "sample-data",
          "implemented": true,
          "evidence": [
            ".workbuddy/memory/2026-10-04.md"
          ],
          "gates": [
            {
              "kind": "driver",
              "status": "pending",
              "evidence": []
            }
          ]
        }
      ]
    },
    {
      "id": "appearance-layers",
      "activity": "doing",
      "summary": "外观拆为「身体（五套共用）+ 每套的衣服」，五态含裸体；洗浴/私密场景只用身体，睡眠硬规则优先。",
      "checkpoints": [
        {
          "id": "scenes",
          "implemented": true,
          "evidence": [
            "agent-core/src/services/outfitScene.js",
            "docs/验证记录/2026-10-04-本地补丁-自动检查.md"
          ],
          "gates": [
            {
              "kind": "automated",
              "status": "passed",
              "evidence": [
                "docs/验证记录/2026-10-04-本地补丁-自动检查.md"
              ]
            },
            {
              "kind": "driver",
              "status": "pending",
              "evidence": []
            }
          ]
        },
        {
          "id": "body",
          "implemented": true,
          "evidence": [
            "agent-core/src/services/outfitScene.js",
            "agent-core/src/db/index.js",
            "agent-core/src/routes/characters.js",
            "docs/验证记录/2026-10-04-本地补丁-自动检查.md"
          ],
          "gates": [
            {
              "kind": "automated",
              "status": "passed",
              "evidence": [
                "docs/验证记录/2026-10-04-本地补丁-自动检查.md"
              ]
            },
            {
              "kind": "driver",
              "status": "pending",
              "evidence": []
            }
          ]
        },
        {
          "id": "anotate",
          "implemented": true,
          "evidence": [
            "agent-core/src/services/outfitScene.js",
            "agent-core/src/services/scheduleGenerator.js",
            ".workbuddy/memory/2026-10-04.md"
          ],
          "gates": [
            {
              "kind": "automated",
              "status": "passed",
              "evidence": [
                "docs/验证记录/2026-10-04-本地补丁-检查记录-第2轮.md"
              ]
            },
            {
              "kind": "driver",
              "status": "pending",
              "evidence": []
            }
          ]
        },
        {
          "id": "ui",
          "implemented": true,
          "evidence": [
            "web-ui/src/components/CharacterDetailModal.vue",
            "web-ui/src/api/index.js"
          ],
          "gates": [
            {
              "kind": "browser",
              "status": "passed",
              "evidence": [
                "docs/验证记录/2026-10-04-本地补丁-浏览器验收-第2轮.md",
                "docs/验证记录/截图/地图页-缩进树与详情.png",
                "docs/验证记录/截图/外观分层-身体与五态.png",
                "docs/验证记录/截图/网络页-分类与批量操作.png",
                "docs/验证记录/截图/归档-日程页分类栏.png"
              ]
            },
            {
              "kind": "driver",
              "status": "pending",
              "evidence": []
            }
          ]
        },
        {
          "id": "migrate",
          "implemented": true,
          "evidence": [
            ".workbuddy/memory/2026-10-04.md"
          ],
          "gates": [
            {
              "kind": "driver",
              "status": "pending",
              "evidence": []
            }
          ]
        }
      ]
    },
    {
      "id": "prompt-quality",
      "activity": "doing",
      "summary": "抑制世界观例句被当 few-shot 复读、把意象画错的问题；生图规则改为身体/服装状态直白描写。",
      "checkpoints": [
        {
          "id": "world-trim",
          "implemented": true,
          "evidence": [
            "agent-core/src/db/worldRepository.js",
            "agent-core/src/services/momentForms.js",
            "agent-core/src/builtinRules.js"
          ],
          "gates": [
            {
              "kind": "automated",
              "status": "passed",
              "evidence": [
                "docs/验证记录/2026-10-04-本地补丁-检查记录-第2轮.md"
              ]
            },
            {
              "kind": "driver",
              "status": "pending",
              "evidence": []
            }
          ]
        },
        {
          "id": "image-rule",
          "implemented": true,
          "evidence": [
            "agent-core/src/builtinRules.js"
          ],
          "gates": [
            {
              "kind": "driver",
              "status": "pending",
              "evidence": []
            }
          ]
        }
      ]
    },
    {
      "id": "network-page",
      "activity": "doing",
      "summary": "数字报刊改两层生成（门户先出、正文按需）、分类判定前后端对齐、顶栏布局收敛。",
      "checkpoints": [
        {
          "id": "two-pass",
          "implemented": true,
          "evidence": [
            "agent-core/src/services/mediaService.js"
          ],
          "gates": [
            {
              "kind": "automated",
              "status": "passed",
              "evidence": [
                "docs/验证记录/2026-10-04-本地补丁-检查记录-第2轮.md"
              ]
            },
            {
              "kind": "driver",
              "status": "pending",
              "evidence": []
            }
          ]
        },
        {
          "id": "classify",
          "implemented": true,
          "evidence": [
            "web-ui/src/views/MediaView.vue",
            "agent-core/src/services/mediaService.js"
          ],
          "gates": [
            {
              "kind": "browser",
              "status": "passed",
              "evidence": [
                "docs/验证记录/2026-10-04-本地补丁-浏览器验收-第2轮.md",
                "docs/验证记录/截图/地图页-缩进树与详情.png",
                "docs/验证记录/截图/外观分层-身体与五态.png",
                "docs/验证记录/截图/网络页-分类与批量操作.png",
                "docs/验证记录/截图/归档-日程页分类栏.png"
              ]
            },
            {
              "kind": "driver",
              "status": "pending",
              "evidence": []
            }
          ]
        },
        {
          "id": "layout",
          "implemented": true,
          "evidence": [
            "web-ui/src/views/MediaView.vue"
          ],
          "gates": [
            {
              "kind": "browser",
              "status": "passed",
              "evidence": [
                "docs/验证记录/2026-10-04-本地补丁-浏览器验收-第2轮.md",
                "docs/验证记录/截图/地图页-缩进树与详情.png",
                "docs/验证记录/截图/外观分层-身体与五态.png",
                "docs/验证记录/截图/网络页-分类与批量操作.png",
                "docs/验证记录/截图/归档-日程页分类栏.png",
                "docs/验证记录/截图/网络页-批量操作靠右.png"
              ]
            },
            {
              "kind": "driver",
              "status": "pending",
              "evidence": []
            }
          ]
        }
      ]
    },
    {
      "id": "archive-tokens",
      "activity": "todo",
      "summary": "归档作为独立拦截层（不覆盖四个细分开关），并统一界面上的归档态表现。",
      "checkpoints": [
        {
          "id": "layer",
          "implemented": true,
          "evidence": [
            "agent-core/src/services/scheduleManager.js",
            "agent-core/src/services/momentScheduler.js",
            ".workbuddy/memory/2026-10-04.md"
          ],
          "gates": [
            {
              "kind": "automated",
              "status": "passed",
              "evidence": [
                "docs/验证记录/2026-10-04-本地补丁-检查记录-第2轮.md"
              ]
            },
            {
              "kind": "driver",
              "status": "pending",
              "evidence": []
            }
          ]
        },
        {
          "id": "ui",
          "implemented": true,
          "evidence": [
            "web-ui/src/views/TavernView.vue",
            "web-ui/src/views/ScheduleView.vue"
          ],
          "gates": [
            {
              "kind": "browser",
              "status": "passed",
              "evidence": [
                "docs/验证记录/2026-10-04-本地补丁-浏览器验收-第2轮.md",
                "docs/验证记录/截图/地图页-缩进树与详情.png",
                "docs/验证记录/截图/外观分层-身体与五态.png",
                "docs/验证记录/截图/网络页-分类与批量操作.png",
                "docs/验证记录/截图/归档-日程页分类栏.png"
              ]
            },
            {
              "kind": "driver",
              "status": "pending",
              "evidence": []
            }
          ]
        }
      ]
    },
    {
      "id": "local-patch-ops",
      "activity": "doing",
      "summary": "本地改动提交在 local 分支、更新走 rebase 重放；工具箱与操作宪法保证改动不丢。",
      "checkpoints": [
        {
          "id": "toolbox",
          "implemented": true,
          "evidence": [
            "邻舍-local/AGENTS.md",
            "邻舍-local/tools/lib.mjs",
            "邻舍-local/项目地图.md"
          ],
          "gates": [
            {
              "kind": "driver",
              "status": "pending",
              "evidence": []
            }
          ]
        },
        {
          "id": "authority",
          "implemented": true,
          "evidence": [
            "docs/本地补丁-总设计案.md",
            "docs/NEXT.md"
          ],
          "gates": [
            {
              "kind": "driver",
              "status": "pending",
              "evidence": []
            }
          ]
        }
      ]
    }
  ]
}
```
<!-- tw-progress-state:end -->
